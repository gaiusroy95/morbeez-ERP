import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { RoutesRepository } from './repositories/routes.repository';
import { RoutePartyKind, RouteRecord, RouteStopRecord } from './entities/route.entity';
import { CreateRouteDto, SetRouteStopsDto, UpdateRouteDto } from './dto/create-route.dto';

@Injectable()
export class RoutesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly routes: RoutesRepository,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string): Promise<RouteRecord[]> {
    return this.db.withTenant(tenantId, (client) => this.routes.listWithClient(client));
  }

  async get(tenantId: string, id: string): Promise<RouteRecord> {
    const route = await this.db.withTenant(tenantId, (client) => this.routes.findByIdWithClient(client, id));
    if (!route) throw new NotFoundException('Route not found');
    return route;
  }

  /**
   * For Customers, Orders and Logistics before they store a route: it must
   * be one of this business's own (a foreign key alone would accept another
   * business's id — FK checks don't see row-level security) and in use.
   */
  async assertUsable(tenantId: string, id: string): Promise<RouteRecord> {
    const route = await this.db.withTenant(tenantId, (client) => this.routes.findByIdWithClient(client, id));
    if (!route) throw new BadRequestException('Route not found');
    if (route.status !== 'active') throw new ConflictException(`The route '${route.name}' is archived`);
    return route;
  }

  create(tenantId: string, actorUserId: string, dto: CreateRouteDto): Promise<RouteRecord> {
    const name = cleanName(dto.name);
    return this.db.withTenant(tenantId, async (client) => {
      const existing = await this.routes.findByNameWithClient(client, name);
      if (existing) throw new ConflictException(`There is already a route called '${existing.name}'`);
      const route = await this.routes.createWithClient(client, tenantId, name);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: 'route',
        entityId: route.id,
        after: route as unknown as Record<string, unknown>,
      });
      return route;
    });
  }

  /** Renames a route, or archives / restores it. An archived route keeps its stops but takes no new orders or trips. */
  update(tenantId: string, actorUserId: string, id: string, dto: UpdateRouteDto): Promise<RouteRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.routes.findByIdWithClient(client, id);
      if (!before) throw new NotFoundException('Route not found');
      const name = dto.name === undefined ? undefined : cleanName(dto.name);
      if (name) {
        const clash = await this.routes.findByNameWithClient(client, name);
        if (clash && clash.id !== id) throw new ConflictException(`There is already a route called '${clash.name}'`);
      }
      const after = (await this.routes.updateWithClient(client, id, { name, status: dto.status }))!;
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: 'route',
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }

  async stops(tenantId: string, id: string): Promise<RouteStopRecord[]> {
    await this.get(tenantId, id);
    return this.db.withTenant(tenantId, (client) => this.routes.stopsWithClient(client, id));
  }

  /**
   * The route's customers and farmers, in visiting order — the whole list,
   * each once. A party listed here moves off any other route it was on.
   */
  setStops(tenantId: string, actorUserId: string, id: string, dto: SetRouteStopsDto): Promise<RouteStopRecord[]> {
    const keys = dto.stops.map((s) => `${s.kind}:${s.partyId}`);
    if (new Set(keys).size !== keys.length) throw new BadRequestException('A customer or farmer can be on the route only once');
    return this.db.withTenant(tenantId, async (client) => {
      const route = await this.routes.findByIdWithClient(client, id);
      if (!route) throw new NotFoundException('Route not found');
      for (const kind of ['customer', 'farmer'] as RoutePartyKind[]) {
        const ids = dto.stops.filter((s) => s.kind === kind).map((s) => s.partyId);
        const found = await this.routes.existingPartiesWithClient(client, kind, ids);
        if (ids.some((x) => !found.has(x))) throw new BadRequestException(`${kind === 'customer' ? 'Customer' : 'Farmer'} not found`);
      }
      const before = await this.routes.stopsWithClient(client, id);
      await this.routes.replaceStopsWithClient(client, tenantId, id, dto.stops);
      const after = await this.routes.stopsWithClient(client, id);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: 'route',
        entityId: id,
        before: { stops: before.map((s) => `${s.kind}:${s.partyId}`) },
        after: { stops: after.map((s) => `${s.kind}:${s.partyId}`) },
      });
      return after;
    });
  }

  /**
   * For Customers inside their own transaction: a customer's usual route is
   * the route they're a stop on. Changing it moves them to the end of the
   * new route's stops; null takes them off. Check the route with
   * assertUsable first (outside the transaction).
   */
  async placeWithClient(client: PoolClient, tenantId: string, kind: RoutePartyKind, partyId: string, routeId: string | null): Promise<void> {
    if ((await this.routes.routeOfWithClient(client, kind, partyId)) === routeId) return;
    await this.routes.placeWithClient(client, tenantId, kind, partyId, routeId);
  }
}

function cleanName(name: string): string {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (clean.length < 2) throw new BadRequestException('Give the route a name');
  return clean;
}
