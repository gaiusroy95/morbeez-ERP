import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';

export type PinKind = 'customer' | 'farmer' | 'depot';

export interface PlacePin {
  kind: PinKind;
  refId: string | null;
  name: string;
  latitude: string | null;
  longitude: string | null;
}

/**
 * Map pins for route planning: where each customer and farmer is, and
 * where trips start and end (the depot). Set by people; read by the AI's
 * route and load suggestions. Owned by Logistics.
 */
@Injectable()
export class PinsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Every place a pin can be set for, with its pin if it has one. */
  list(tenantId: string): Promise<PlacePin[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const r = await client.query(
        `SELECT x.kind, x.ref_id, x.name, p.latitude::text, p.longitude::text FROM (
           SELECT 'depot' AS kind, NULL::uuid AS ref_id, 'Depot (trips start and end here)' AS name, 0 AS o
           UNION ALL SELECT 'customer', id, name, 1 FROM trading_partners.customer WHERE status = 'active' AND NOT is_walk_in
           UNION ALL SELECT 'farmer', id, name, 2 FROM trading_partners.farmer WHERE status = 'active'
         ) x LEFT JOIN fulfilment.place_pin p ON p.kind = x.kind AND p.ref_id IS NOT DISTINCT FROM x.ref_id
         ORDER BY x.o, x.name`,
      );
      return r.rows.map((p) => ({ kind: p.kind, refId: p.ref_id, name: p.name, latitude: p.latitude, longitude: p.longitude }));
    });
  }

  set(tenantId: string, userId: string, kind: PinKind, refId: string | null, latitude: number, longitude: number): Promise<PlacePin[]> {
    if ((kind === 'depot') !== (refId === null)) throw new BadRequestException(kind === 'depot' ? 'The depot takes no refId' : 'Say which customer or farmer');
    return this.db.withTenant(tenantId, async (client) => {
      if (refId) {
        const table = kind === 'customer' ? 'trading_partners.customer' : 'trading_partners.farmer';
        const found = await client.query(`SELECT 1 FROM ${table} WHERE id = $1`, [refId]);
        if (!found.rowCount) throw new NotFoundException(`${kind === 'customer' ? 'Customer' : 'Farmer'} not found`);
      }
      const updated = await client.query(
        `UPDATE fulfilment.place_pin SET latitude = $3, longitude = $4, updated_by = $5, updated_at = now()
         WHERE kind = $1 AND ref_id IS NOT DISTINCT FROM $2::uuid`,
        [kind, refId, latitude.toFixed(6), longitude.toFixed(6), userId],
      );
      if (!updated.rowCount) {
        await client.query(
          'INSERT INTO fulfilment.place_pin (tenant_id, kind, ref_id, latitude, longitude, updated_by) VALUES ($1, $2, $3, $4, $5, $6)',
          [tenantId, kind, refId, latitude.toFixed(6), longitude.toFixed(6), userId],
        );
      }
      await this.audit.record(client, { tenantId, actorUserId: userId, action: 'update', entityType: 'place_pin', entityId: refId ?? tenantId, after: { kind, latitude, longitude } });
      return this.listWith(client);
    });
  }

  private async listWith(client: import('pg').PoolClient): Promise<PlacePin[]> {
    const r = await client.query(
      `SELECT p.kind, p.ref_id, COALESCE(c.name, f.name, 'Depot (trips start and end here)') AS name, p.latitude::text, p.longitude::text
       FROM fulfilment.place_pin p
       LEFT JOIN trading_partners.customer c ON p.kind = 'customer' AND c.id = p.ref_id
       LEFT JOIN trading_partners.farmer f ON p.kind = 'farmer' AND f.id = p.ref_id
       ORDER BY p.kind, name`,
    );
    return r.rows.map((p) => ({ kind: p.kind, refId: p.ref_id, name: p.name, latitude: p.latitude, longitude: p.longitude }));
  }
}
