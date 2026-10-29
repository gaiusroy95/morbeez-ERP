import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { RoutePartyKind, RouteRecord, RouteStatus, RouteStopRecord } from '../entities/route.entity';

interface RouteRow {
  id: string;
  name: string;
  status: RouteStatus;
  created_at: Date;
  customers: number;
  farmers: number;
}

function toRecord(row: RouteRow): RouteRecord {
  return { id: row.id, name: row.name, status: row.status, createdAt: row.created_at, customers: row.customers, farmers: row.farmers };
}

const ROUTE_SELECT = `
  SELECT r.id, r.name, r.status, r.created_at,
         (SELECT count(*)::int FROM trading_partners.route_stop s WHERE s.route_id = r.id AND s.customer_id IS NOT NULL) AS customers,
         (SELECT count(*)::int FROM trading_partners.route_stop s WHERE s.route_id = r.id AND s.farmer_id IS NOT NULL) AS farmers
  FROM trading_partners.route r`;

@Injectable()
export class RoutesRepository {
  async listWithClient(client: PoolClient): Promise<RouteRecord[]> {
    const r = await client.query<RouteRow>(`${ROUTE_SELECT} ORDER BY r.status, r.name`);
    return r.rows.map(toRecord);
  }

  async findByIdWithClient(client: PoolClient, id: string): Promise<RouteRecord | null> {
    const r = await client.query<RouteRow>(`${ROUTE_SELECT} WHERE r.id = $1`, [id]);
    return r.rows[0] ? toRecord(r.rows[0]) : null;
  }

  async findByNameWithClient(client: PoolClient, name: string): Promise<RouteRecord | null> {
    const r = await client.query<RouteRow>(`${ROUTE_SELECT} WHERE lower(trim(r.name)) = lower(trim($1))`, [name]);
    return r.rows[0] ? toRecord(r.rows[0]) : null;
  }

  async createWithClient(client: PoolClient, tenantId: string, name: string): Promise<RouteRecord> {
    const r = await client.query<{ id: string }>('INSERT INTO trading_partners.route (tenant_id, name) VALUES ($1, $2) RETURNING id', [tenantId, name]);
    return (await this.findByIdWithClient(client, r.rows[0].id))!;
  }

  async updateWithClient(client: PoolClient, id: string, fields: { name?: string; status?: RouteStatus }): Promise<RouteRecord | null> {
    await client.query('UPDATE trading_partners.route SET name = COALESCE($2, name), status = COALESCE($3, status) WHERE id = $1', [
      id,
      fields.name ?? null,
      fields.status ?? null,
    ]);
    return this.findByIdWithClient(client, id);
  }

  /** The route's customers and farmers in visiting order, with where each is. */
  async stopsWithClient(client: PoolClient, routeId: string): Promise<RouteStopRecord[]> {
    const r = await client.query(
      `SELECT s.position, CASE WHEN s.customer_id IS NOT NULL THEN 'customer' ELSE 'farmer' END AS kind,
              COALESCE(s.customer_id, s.farmer_id) AS party_id,
              COALESCE(c.name, f.name) AS name, COALESCE(c.place, f.place) AS place,
              COALESCE(c.contact, f.contact)->>'phone' AS phone,
              COALESCE(c.status, f.status) AS status,
              pin.latitude::text AS latitude, pin.longitude::text AS longitude
       FROM trading_partners.route_stop s
       LEFT JOIN trading_partners.customer c ON c.id = s.customer_id
       LEFT JOIN trading_partners.farmer f ON f.id = s.farmer_id
       LEFT JOIN fulfilment.place_pin pin
              ON pin.ref_id = COALESCE(s.customer_id, s.farmer_id)
             AND pin.kind = CASE WHEN s.customer_id IS NOT NULL THEN 'customer' ELSE 'farmer' END
       WHERE s.route_id = $1
       ORDER BY s.position, s.created_at`,
      [routeId],
    );
    return r.rows.map((row) => ({
      position: row.position,
      kind: row.kind,
      partyId: row.party_id,
      name: row.name,
      place: row.place,
      phone: row.phone,
      latitude: row.latitude,
      longitude: row.longitude,
      status: row.status,
    }));
  }

  /** Which of these ids are this business's customers or farmers (row-level security keeps it to the business). */
  async existingPartiesWithClient(client: PoolClient, kind: RoutePartyKind, ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const table = kind === 'customer' ? 'trading_partners.customer' : 'trading_partners.farmer';
    const r = await client.query<{ id: string }>(`SELECT id FROM ${table} WHERE id = ANY($1::uuid[])`, [ids]);
    return new Set(r.rows.map((x) => x.id));
  }

  /**
   * The route's stops become exactly these, in this order. A party listed
   * here leaves whatever route it was on before (a party is on one route).
   */
  async replaceStopsWithClient(client: PoolClient, tenantId: string, routeId: string, stops: { kind: RoutePartyKind; partyId: string }[]): Promise<void> {
    const customers = stops.filter((s) => s.kind === 'customer').map((s) => s.partyId);
    const farmers = stops.filter((s) => s.kind === 'farmer').map((s) => s.partyId);
    await client.query(
      `DELETE FROM trading_partners.route_stop
        WHERE route_id = $1 OR customer_id = ANY($2::uuid[]) OR farmer_id = ANY($3::uuid[])`,
      [routeId, customers, farmers],
    );
    if (stops.length === 0) return;
    await client.query(
      `INSERT INTO trading_partners.route_stop (tenant_id, route_id, position, customer_id, farmer_id)
       SELECT $1, $2, o.n, CASE WHEN o.kind = 'customer' THEN o.id END, CASE WHEN o.kind = 'farmer' THEN o.id END
       FROM unnest($3::text[], $4::uuid[]) WITH ORDINALITY AS o(kind, id, n)`,
      [tenantId, routeId, stops.map((s) => s.kind), stops.map((s) => s.partyId)],
    );
  }

  /** The route a customer or farmer is on, if any. */
  async routeOfWithClient(client: PoolClient, kind: RoutePartyKind, partyId: string): Promise<string | null> {
    const column = kind === 'customer' ? 'customer_id' : 'farmer_id';
    const r = await client.query<{ route_id: string }>(`SELECT route_id FROM trading_partners.route_stop WHERE ${column} = $1`, [partyId]);
    return r.rows[0]?.route_id ?? null;
  }

  /** Puts a party at the end of a route's stops, or takes it off any route (null). */
  async placeWithClient(client: PoolClient, tenantId: string, kind: RoutePartyKind, partyId: string, routeId: string | null): Promise<void> {
    const column = kind === 'customer' ? 'customer_id' : 'farmer_id';
    await client.query(`DELETE FROM trading_partners.route_stop WHERE ${column} = $1`, [partyId]);
    if (!routeId) return;
    await client.query(
      `INSERT INTO trading_partners.route_stop (tenant_id, route_id, position, ${column})
       SELECT $1, $2, COALESCE(MAX(position), 0) + 1, $3 FROM trading_partners.route_stop WHERE route_id = $2`,
      [tenantId, routeId, partyId],
    );
  }
}
