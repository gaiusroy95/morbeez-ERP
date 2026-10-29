import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { FarmersRepository } from './repositories/farmers.repository';
import { FarmerRecord } from './entities/farmer.entity';
import { PaginatedResult } from '../../common/persistence/pagination';
import { CreateFarmerDto } from './dto/create-farmer.dto';
import { UpdateFarmerDto } from './dto/update-farmer.dto';
import { FarmerInsightsRepository } from './repositories/farmer-insights.repository';
import { FarmerCard, FarmerProfile, FarmersBoard, FarmersFilter } from './entities/farmer-insights.entity';

const ENTITY_TYPE = 'farmer';

@Injectable()
export class FarmersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly farmers: FarmersRepository,
    private readonly audit: AuditService,
    private readonly insights: FarmerInsightsRepository,
  ) {}

  // ---- The owner's Farmers list and farmer profile (redesign Phase 5) ----

  /**
   * The Farmers list: each farmer with what they sell most, what was bought
   * from them and what they're still owed (money for finance:read).
   * Filtered (all, active, pending payment), by village or town, and
   * searched by name, mobile, place or product.
   */
  async board(
    tenantId: string,
    query: { filter: FarmersFilter; place: string | null; q: string | null; page: number; pageSize: number },
    canSeeMoney: boolean,
  ): Promise<FarmersBoard> {
    const rows = await this.db.withTenant(tenantId, (client) => this.insights.figuresWithClient(client));
    const cards: FarmerCard[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      place: r.place,
      phone: r.phone,
      routeName: r.route_name,
      status: r.status,
      mainProduct: r.main_product,
      totalPurchases: canSeeMoney ? r.purchases : null,
      owed: canSeeMoney ? r.owed : null,
      advance: canSeeMoney ? r.advance : null,
      lastPickupAt: r.last_pickup_at,
    }));
    const q = query.q?.trim().toLowerCase() ?? '';
    const digits = q.replace(/\D/g, '');
    const place = query.place?.trim().toLowerCase() || null;
    const searched = cards.filter(
      (c) =>
        (!place || (c.place ?? '').trim().toLowerCase() === place) &&
        (!q ||
          c.name.toLowerCase().includes(q) ||
          (c.place ?? '').toLowerCase().includes(q) ||
          (c.mainProduct ?? '').toLowerCase().includes(q) ||
          (digits.length >= 3 && (c.phone ?? '').replace(/\D/g, '').includes(digits))),
    );
    const pending = (c: FarmerCard) => Number(c.owed ?? 0) > 0;
    const shown = searched.filter((c) => (query.filter === 'active' ? c.status === 'active' : query.filter === 'pending' ? pending(c) : true));
    if (query.filter === 'pending') shown.sort((a, b) => Number(b.owed) - Number(a.owed));
    const places = new Map<string, number>();
    for (const c of cards) if (c.place?.trim()) places.set(c.place.trim(), (places.get(c.place.trim()) ?? 0) + 1);
    const start = (query.page - 1) * query.pageSize;
    return {
      filter: query.filter,
      place: query.place ?? null,
      counts: {
        all: searched.length,
        active: searched.filter((c) => c.status === 'active').length,
        pending: canSeeMoney ? searched.filter(pending).length : null,
      },
      places: [...places].map(([p, n]) => ({ place: p, farmers: n })).sort((a, b) => a.place.localeCompare(b.place)),
      total: shown.length,
      page: query.page,
      pageSize: query.pageSize,
      items: shown.slice(start, start + query.pageSize),
    };
  }

  /** Farmer profile: the record and where they are, purchases (procurement:read), and money (finance:read). */
  async profile(tenantId: string, id: string, can: { money: boolean; purchases: boolean }): Promise<FarmerProfile> {
    const farmer = await this.getById(tenantId, id);
    return this.db.withTenant(tenantId, async (client) => {
      const [row] = await this.insights.figuresWithClient(client, id);
      const pin = await this.insights.pinWithClient(client, id);
      let purchases: FarmerProfile['purchases'] = null;
      if (can.purchases) {
        const p = await this.insights.purchasesWithClient(client, id);
        purchases = { count: p.count, open: p.open, lastPickupAt: row?.last_pickup_at ?? null, recent: p.recent, products: await this.insights.productsWithClient(client, id) };
      }
      const money: FarmerProfile['money'] =
        can.money && row
          ? {
              totalPurchases: row.purchases,
              owed: row.owed,
              paid: row.paid,
              advance: row.advance,
              oldestUnpaidAt: row.oldest_unpaid_at,
              lastPaidAt: row.last_paid_at,
              payments: await this.insights.paymentsWithClient(client, id),
            }
          : null;
      return { farmer, routeName: row?.route_name ?? null, pin, purchases, money };
    });
  }

  list(tenantId: string, page: number, pageSize: number): Promise<PaginatedResult<FarmerRecord>> {
    return this.farmers.list(tenantId, page, pageSize);
  }

  async getById(tenantId: string, id: string): Promise<FarmerRecord> {
    const farmer = await this.farmers.findById(tenantId, id);
    if (!farmer) throw new NotFoundException('Farmer not found');
    return farmer;
  }

  create(tenantId: string, actorUserId: string, dto: CreateFarmerDto): Promise<FarmerRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const farmer = await this.farmers.createWithClient(client, tenantId, actorUserId, {
        name: dto.name,
        contact: { ...dto.contact },
        bankDetails: dto.bankDetails,
        place: dto.place?.trim() || null,
      });
      // bank_details never appears in the audit entry itself, even
      // encrypted — the audit log's own retention/access story is
      // separate from this field's, and there's no reason to duplicate
      // sensitive data into a second table just to say "it changed."
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: ENTITY_TYPE,
        entityId: farmer.id,
        after: redactBankDetails(farmer),
      });
      return farmer;
    });
  }

  update(
    tenantId: string,
    actorUserId: string,
    id: string,
    dto: UpdateFarmerDto,
  ): Promise<FarmerRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.farmers.findByIdWithClient(client, id);
      if (!before) throw new NotFoundException('Farmer not found');

      const after = await this.farmers.updateWithClient(client, id, dto.version, {
        name: dto.name,
        contact: dto.contact && { ...dto.contact },
        bankDetails: dto.bankDetails,
        reliabilityRating: dto.reliabilityRating,
        place: dto.place === undefined ? undefined : dto.place?.trim() || null,
      });

      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: ENTITY_TYPE,
        entityId: id,
        before: redactBankDetails(before),
        after: redactBankDetails(after),
      });
      return after;
    });
  }

  archive(tenantId: string, actorUserId: string, id: string): Promise<FarmerRecord> {
    return this.setStatus(tenantId, actorUserId, id, 'archived', 'archive');
  }

  restore(tenantId: string, actorUserId: string, id: string): Promise<FarmerRecord> {
    return this.setStatus(tenantId, actorUserId, id, 'active', 'restore');
  }

  private setStatus(
    tenantId: string,
    actorUserId: string,
    id: string,
    status: 'active' | 'archived',
    action: 'archive' | 'restore',
  ): Promise<FarmerRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.farmers.findByIdWithClient(client, id);
      if (!before) throw new NotFoundException('Farmer not found');

      const after = await this.farmers.setStatusWithClient(client, id, status);
      if (!after) throw new NotFoundException('Farmer not found');

      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action,
        entityType: ENTITY_TYPE,
        entityId: id,
        before: redactBankDetails(before),
        after: redactBankDetails(after),
      });
      return after;
    });
  }
}

function redactBankDetails(farmer: FarmerRecord): Record<string, unknown> {
  const { bankDetails: _bankDetails, ...rest } = farmer;
  return { ...rest, bankDetails: farmer.bankDetails ? '[redacted]' : null };
}
