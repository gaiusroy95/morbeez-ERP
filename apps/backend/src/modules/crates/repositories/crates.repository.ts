import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { CrateSettings, CrateType, HolderKind, HolderRef, LossRecord, MovementKind, MovementRecord } from '../entities/crates.entity';

type Row = Record<string, unknown>;

const EDGE_NAME: Record<string, string> = { yard: 'Yard', outside: 'Outside', lost: 'Lost' };

/** A holder's display name: the party's or vehicle's own, or the edge's. */
const nameOf = (alias: string, kindCol: string) =>
  `CASE ${kindCol} WHEN 'customer' THEN ${alias}c.name WHEN 'farmer' THEN ${alias}f.name WHEN 'vehicle' THEN ${alias}v.registration_number END`;
const holderJoins = (alias: string, kindCol: string, idCol: string) => `
  LEFT JOIN trading_partners.customer ${alias}c ON ${kindCol} = 'customer' AND ${alias}c.id = ${idCol}
  LEFT JOIN trading_partners.farmer ${alias}f ON ${kindCol} = 'farmer' AND ${alias}f.id = ${idCol}
  LEFT JOIN trading_partners.vehicle ${alias}v ON ${kindCol} = 'vehicle' AND ${alias}v.id = ${idCol}`;

const MOVEMENT_SELECT = `
  SELECT m.id, m.batch_id, m.crate_type_id, ct.code AS crate_code, m.quantity, m.kind,
         m.from_kind, m.from_id, ${nameOf('fr', 'm.from_kind')} AS from_name,
         m.to_kind, m.to_id, ${nameOf('to', 'm.to_kind')} AS to_name,
         m.occurred_at, m.trip_id, m.trip_stop_id, m.reference, m.notes, m.reverses_movement_id,
         (SELECT r.id FROM crates.movement r WHERE r.reverses_movement_id = m.id) AS reversed_by,
         -- Money follows these two, so they're corrected in Finance, not reversed here.
         (EXISTS (SELECT 1 FROM crates.crate_loss l WHERE l.movement_id = m.id AND l.recovery <> 'absorbed')
          OR (m.kind = 'purchased' AND EXISTS (SELECT 1 FROM money.ledger_entry e WHERE e.entry_type = 'crates_purchased' AND e.source_id = m.batch_id))) AS money_attached,
         u.email AS created_by_email
  FROM crates.movement m
  JOIN crates.crate_type ct ON ct.id = m.crate_type_id
  LEFT JOIN identity.app_user u ON u.id = m.created_by
  ${holderJoins('fr', 'm.from_kind', 'm.from_id')}
  ${holderJoins('to', 'm.to_kind', 'm.to_id')}`;

const ref = (kind: string, id: string | null, name: string | null): HolderRef => ({
  kind: kind as HolderRef['kind'],
  id,
  name: name ?? EDGE_NAME[kind] ?? '—',
});

const toMovement = (r: Row): MovementRecord => ({
  id: r.id as string,
  batchId: r.batch_id as string,
  crateTypeId: r.crate_type_id as string,
  crateCode: r.crate_code as string,
  quantity: r.quantity as number,
  kind: r.kind as MovementKind,
  from: ref(r.from_kind as string, r.from_id as string | null, r.from_name as string | null),
  to: ref(r.to_kind as string, r.to_id as string | null, r.to_name as string | null),
  occurredAt: r.occurred_at as Date,
  tripId: r.trip_id as string | null,
  tripStopId: r.trip_stop_id as string | null,
  reference: r.reference as string | null,
  notes: r.notes as string | null,
  reversesMovementId: r.reverses_movement_id as string | null,
  reversedBy: r.reversed_by as string | null,
  reversible: r.kind !== 'correction' && !r.reversed_by && !r.money_attached,
  createdByEmail: r.created_by_email as string | null,
});

const TYPE_COLUMNS = `id, code, name, capacity_kg::text AS capacity_kg, replacement_cost::text AS replacement_cost, hsn_code,
  reorder_level, is_active, version`;

const toType = (r: Row): CrateType => ({
  id: r.id as string,
  code: r.code as string,
  name: r.name as string,
  capacityKg: r.capacity_kg as string | null,
  replacementCost: r.replacement_cost as string,
  hsnCode: r.hsn_code as string | null,
  reorderLevel: r.reorder_level as number,
  isActive: r.is_active as boolean,
  version: r.version as number,
});

export interface MovementInsert {
  tenantId: string;
  batchId: string;
  crateTypeId: string;
  quantity: number;
  kind: MovementKind;
  fromKind: string;
  fromId: string | null;
  toKind: string;
  toId: string | null;
  occurredAt: Date;
  tripId: string | null;
  tripStopId: string | null;
  reversesMovementId: string | null;
  reference: string | null;
  notes: string | null;
  userId: string;
}

/**
 * The crates schema's reads and writes, plus the names of the customers,
 * farmers and vehicles that hold crates and — for trip counts — Logistics'
 * trips and stops, read only. RLS scopes every statement.
 */
@Injectable()
export class CratesRepository {
  async books(client: PoolClient): Promise<{ today: string; timezone: string; currency: string }> {
    const r = await client.query(
      `SELECT (now() AT TIME ZONE timezone)::date::text AS today, timezone, currency FROM tenant.tenant WHERE id = current_tenant_id()`,
    );
    return r.rows[0];
  }

  async instant(client: PoolClient, timezone: string, today: string, date: string): Promise<Date> {
    if (date >= today) return new Date();
    const r = await client.query<{ at: Date }>(`SELECT ($1::date + time '12:00')::timestamp AT TIME ZONE $2 AS at`, [date, timezone]);
    return r.rows[0].at;
  }

  /** Every crate write for a tenant runs one at a time, so a balance checked is the balance written against. */
  async lock(client: PoolClient): Promise<void> {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('crates:' || current_tenant_id()::text))`);
  }

  // ---- Settings, types, limits ----

  async settings(client: PoolClient): Promise<CrateSettings> {
    const r = await client.query('SELECT customer_overdue_days, farmer_overdue_days, version FROM crates.crate_settings');
    const row = r.rows[0];
    return row
      ? { customerOverdueDays: row.customer_overdue_days, farmerOverdueDays: row.farmer_overdue_days, version: row.version }
      : { customerOverdueDays: 7, farmerOverdueDays: 15, version: 0 };
  }

  async saveSettings(client: PoolClient, tenantId: string, userId: string, version: number, s: Omit<CrateSettings, 'version'>): Promise<boolean> {
    if (version === 0) {
      const r = await client.query(
        `INSERT INTO crates.crate_settings (tenant_id, customer_overdue_days, farmer_overdue_days, updated_by)
         VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id) DO NOTHING`,
        [tenantId, s.customerOverdueDays, s.farmerOverdueDays, userId],
      );
      return (r.rowCount ?? 0) === 1;
    }
    const r = await client.query(
      `UPDATE crates.crate_settings SET customer_overdue_days = $1, farmer_overdue_days = $2, updated_by = $3,
         version = version + 1, updated_at = now() WHERE version = $4`,
      [s.customerOverdueDays, s.farmerOverdueDays, userId, version],
    );
    return (r.rowCount ?? 0) === 1;
  }

  async types(client: PoolClient): Promise<CrateType[]> {
    const r = await client.query(`SELECT ${TYPE_COLUMNS} FROM crates.crate_type ORDER BY is_active DESC, code`);
    return r.rows.map(toType);
  }

  async findType(client: PoolClient, id: string): Promise<CrateType | null> {
    const r = await client.query(`SELECT ${TYPE_COLUMNS} FROM crates.crate_type WHERE id = $1`, [id]);
    return r.rows[0] ? toType(r.rows[0]) : null;
  }

  async insertType(
    client: PoolClient,
    t: { tenantId: string; code: string; name: string; capacityKg: string | null; replacementCost: string; hsnCode: string | null; reorderLevel: number; userId: string },
  ): Promise<string> {
    const r = await client.query<{ id: string }>(
      `INSERT INTO crates.crate_type (tenant_id, code, name, capacity_kg, replacement_cost, hsn_code, reorder_level, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [t.tenantId, t.code, t.name, t.capacityKg, t.replacementCost, t.hsnCode, t.reorderLevel, t.userId],
    );
    return r.rows[0].id;
  }

  async updateType(
    client: PoolClient,
    id: string,
    version: number,
    t: { name: string; capacityKg: string | null; replacementCost: string; hsnCode: string | null; reorderLevel: number; isActive: boolean },
  ): Promise<boolean> {
    const r = await client.query(
      `UPDATE crates.crate_type SET name = $3, capacity_kg = $4, replacement_cost = $5, hsn_code = $6, reorder_level = $7, is_active = $8,
         version = version + 1, updated_at = now()
       WHERE id = $1 AND version = $2`,
      [id, version, t.name, t.capacityKg, t.replacementCost, t.hsnCode, t.reorderLevel, t.isActive],
    );
    return (r.rowCount ?? 0) === 1;
  }

  async limits(client: PoolClient): Promise<Map<string, number>> {
    const r = await client.query<{ holder_kind: string; holder_id: string; max_crates: number }>('SELECT holder_kind, holder_id, max_crates FROM crates.crate_limit');
    return new Map(r.rows.map((l) => [`${l.holder_kind}:${l.holder_id}`, l.max_crates]));
  }

  async setLimit(client: PoolClient, tenantId: string, userId: string, kind: string, id: string, max: number | null): Promise<void> {
    if (max === null) {
      await client.query('DELETE FROM crates.crate_limit WHERE holder_kind = $1 AND holder_id = $2', [kind, id]);
      return;
    }
    await client.query(
      `INSERT INTO crates.crate_limit (tenant_id, holder_kind, holder_id, max_crates, updated_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (holder_kind, holder_id) DO UPDATE SET max_crates = EXCLUDED.max_crates, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [tenantId, kind, id, max, userId],
    );
  }

  // ---- Holders and balances ----

  /** Who crates can go to: active customers, farmers and vehicles, by name. */
  async parties(client: PoolClient): Promise<{ kind: string; id: string; name: string }[]> {
    const r = await client.query(
      `SELECT 'customer' AS kind, id, name FROM trading_partners.customer WHERE status = 'active'
       UNION ALL SELECT 'farmer', id, name FROM trading_partners.farmer WHERE status = 'active'
       UNION ALL SELECT 'vehicle', id, registration_number FROM trading_partners.vehicle WHERE status <> 'disposed'
       ORDER BY 1, 3`,
    );
    return r.rows;
  }

  /** The holder's name, or null when there's no such customer, farmer or vehicle in this tenant. */
  async holderName(client: PoolClient, kind: HolderKind, id: string | null): Promise<string | null> {
    if (kind === 'yard') return 'Yard';
    const table = { customer: 'trading_partners.customer', farmer: 'trading_partners.farmer', vehicle: 'trading_partners.vehicle' }[kind];
    const col = kind === 'vehicle' ? 'registration_number' : 'name';
    const r = await client.query(`SELECT ${col} AS name FROM ${table} WHERE id = $1`, [id]);
    return r.rows[0]?.name ?? null;
  }

  /** Non-zero balances, by holder and crate type, with names. */
  async balances(client: PoolClient, kind: HolderKind | null, id: string | null): Promise<Row[]> {
    const r = await client.query(
      `SELECT b.holder_kind, b.holder_id, ${nameOf('h', 'b.holder_kind')} AS holder_name, b.crate_type_id, ct.code,
              ct.replacement_cost::text AS replacement_cost, b.balance,
              (SELECT max(m.occurred_at) FROM crates.movement m
                WHERE (m.to_kind = b.holder_kind AND m.to_id IS NOT DISTINCT FROM b.holder_id)
                   OR (m.from_kind = b.holder_kind AND m.from_id IS NOT DISTINCT FROM b.holder_id)) AS last_movement_at
       FROM crates.holder_balance b
       JOIN crates.crate_type ct ON ct.id = b.crate_type_id
       ${holderJoins('h', 'b.holder_kind', 'b.holder_id')}
       WHERE b.balance <> 0 AND ($1::text IS NULL OR b.holder_kind = $1) AND ($2::uuid IS NULL OR b.holder_id = $2)
       ORDER BY b.holder_kind, holder_name, ct.code`,
      [kind, id],
    );
    return r.rows;
  }

  async balanceOf(client: PoolClient, kind: string, id: string | null, crateTypeId: string): Promise<number> {
    const r = await client.query<{ balance: number }>(
      `SELECT balance FROM crates.holder_balance WHERE holder_kind = $1 AND holder_id IS NOT DISTINCT FROM $2 AND crate_type_id = $3`,
      [kind, id, crateTypeId],
    );
    return r.rows[0]?.balance ?? 0;
  }

  /** Each party's crate movements as dated deltas per crate type — for aging. */
  async partyEvents(client: PoolClient, timezone: string, kind: 'customer' | 'farmer' | null, id: string | null): Promise<Row[]> {
    const r = await client.query(
      `SELECT holder_kind, holder_id, crate_type_id, (occurred_at AT TIME ZONE $1)::date::text AS on, delta
       FROM (
         SELECT to_kind AS holder_kind, to_id AS holder_id, crate_type_id, occurred_at, quantity AS delta FROM crates.movement
         UNION ALL
         SELECT from_kind, from_id, crate_type_id, occurred_at, -quantity FROM crates.movement
       ) e
       WHERE holder_kind IN ('customer', 'farmer') AND ($2::text IS NULL OR holder_kind = $2) AND ($3::uuid IS NULL OR holder_id = $3)`,
      [timezone, kind, id],
    );
    return r.rows;
  }

  /** Vehicles out on a trip right now. */
  async vehiclesOnTrip(client: PoolClient): Promise<Set<string>> {
    const r = await client.query<{ vehicle_id: string }>("SELECT DISTINCT vehicle_id FROM fulfilment.trip WHERE status = 'in_progress'");
    return new Set(r.rows.map((x) => x.vehicle_id));
  }

  /** Crates of each type ever lost (for the overview's totals). */
  async lostByType(client: PoolClient): Promise<Map<string, number>> {
    const r = await client.query<{ crate_type_id: string; lost: number }>(
      `SELECT crate_type_id, (SUM(CASE WHEN to_kind = 'lost' THEN quantity ELSE 0 END) - SUM(CASE WHEN from_kind = 'lost' THEN quantity ELSE 0 END))::int AS lost
       FROM crates.movement GROUP BY crate_type_id`,
    );
    return new Map(r.rows.map((x) => [x.crate_type_id, x.lost]));
  }

  // ---- Movements ----

  async insertMovement(client: PoolClient, m: MovementInsert): Promise<string> {
    const r = await client.query<{ id: string }>(
      `INSERT INTO crates.movement
         (tenant_id, batch_id, crate_type_id, quantity, kind, from_kind, from_id, to_kind, to_id, occurred_at, trip_id, trip_stop_id,
          reverses_movement_id, reference, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
      [m.tenantId, m.batchId, m.crateTypeId, m.quantity, m.kind, m.fromKind, m.fromId, m.toKind, m.toId, m.occurredAt, m.tripId, m.tripStopId, m.reversesMovementId, m.reference, m.notes, m.userId],
    );
    return r.rows[0].id;
  }

  async findMovement(client: PoolClient, id: string): Promise<MovementRecord | null> {
    const r = await client.query(`${MOVEMENT_SELECT} WHERE m.id = $1`, [id]);
    return r.rows[0] ? toMovement(r.rows[0]) : null;
  }

  async movements(
    client: PoolClient,
    f: { timezone: string; from: string | null; to: string | null; holderKind: string | null; holderId: string | null; tripId: string | null; batchId: string | null; limit: number },
  ): Promise<MovementRecord[]> {
    const r = await client.query(
      `${MOVEMENT_SELECT}
       WHERE ($2::date IS NULL OR (m.occurred_at AT TIME ZONE $1)::date >= $2) AND ($3::date IS NULL OR (m.occurred_at AT TIME ZONE $1)::date <= $3)
         AND ($4::text IS NULL OR ((m.from_kind = $4 AND m.from_id IS NOT DISTINCT FROM $5::uuid) OR (m.to_kind = $4 AND m.to_id IS NOT DISTINCT FROM $5::uuid)))
         AND ($6::uuid IS NULL OR m.trip_id = $6) AND ($7::uuid IS NULL OR m.batch_id = $7)
       ORDER BY m.occurred_at DESC, m.created_at DESC
       LIMIT $8`,
      [f.timezone, f.from, f.to, f.holderKind, f.holderId, f.tripId, f.batchId, f.limit],
    );
    return r.rows.map(toMovement);
  }

  // ---- Losses ----

  async insertLoss(
    client: PoolClient,
    l: { tenantId: string; movementId: string; recovery: string; unitCharge: string; amount: string; taxAmount: string; invoiceId: string | null; entryId: string | null; reason: string; userId: string },
  ): Promise<string> {
    const r = await client.query<{ id: string }>(
      `INSERT INTO crates.crate_loss (tenant_id, movement_id, recovery, unit_charge, amount, tax_amount, invoice_id, ledger_entry_id, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [l.tenantId, l.movementId, l.recovery, l.unitCharge, l.amount, l.taxAmount, l.invoiceId, l.entryId, l.reason, l.userId],
    );
    return r.rows[0].id;
  }

  async insertDeductions(client: PoolClient, tenantId: string, lossId: string, rows: { payableId: string; amount: string }[]): Promise<void> {
    for (const d of rows) {
      await client.query('INSERT INTO crates.payable_deduction (tenant_id, loss_id, payable_id, amount) VALUES ($1, $2, $3, $4)', [tenantId, lossId, d.payableId, d.amount]);
    }
  }

  async losses(client: PoolClient, f: { timezone: string; from: string | null; to: string | null; holderKind: string | null; holderId: string | null }): Promise<LossRecord[]> {
    const r = await client.query(
      `SELECT l.id, l.movement_id, m.from_kind, m.from_id, ${nameOf('h', 'm.from_kind')} AS holder_name, m.crate_type_id, ct.code AS crate_code,
              m.quantity, l.recovery, l.unit_charge::text AS unit_charge, l.amount::text AS amount, l.tax_amount::text AS tax_amount,
              l.invoice_id, i.invoice_number, l.reason, m.occurred_at
       FROM crates.crate_loss l
       JOIN crates.movement m ON m.id = l.movement_id
       JOIN crates.crate_type ct ON ct.id = m.crate_type_id
       LEFT JOIN money.invoice i ON i.id = l.invoice_id
       ${holderJoins('h', 'm.from_kind', 'm.from_id')}
       WHERE ($2::date IS NULL OR (m.occurred_at AT TIME ZONE $1)::date >= $2) AND ($3::date IS NULL OR (m.occurred_at AT TIME ZONE $1)::date <= $3)
         AND ($4::text IS NULL OR (m.from_kind = $4 AND m.from_id IS NOT DISTINCT FROM $5::uuid))
       ORDER BY m.occurred_at DESC`,
      [f.timezone, f.from, f.to, f.holderKind, f.holderId],
    );
    return r.rows.map((x) => ({
      id: x.id,
      movementId: x.movement_id,
      holder: ref(x.from_kind, x.from_id, x.holder_name),
      crateTypeId: x.crate_type_id,
      crateCode: x.crate_code,
      quantity: x.quantity,
      recovery: x.recovery,
      unitCharge: x.unit_charge,
      amount: x.amount,
      taxAmount: x.tax_amount,
      invoiceId: x.invoice_id,
      invoiceNumber: x.invoice_number,
      reason: x.reason,
      occurredAt: x.occurred_at,
    }));
  }

  async lossForMovement(client: PoolClient, movementId: string): Promise<{ recovery: string } | null> {
    const r = await client.query('SELECT recovery FROM crates.crate_loss WHERE movement_id = $1', [movementId]);
    return r.rows[0] ?? null;
  }

  // ---- Trips (Logistics' read model) ----

  async trip(client: PoolClient, tripId: string): Promise<Row | null> {
    const r = await client.query(
      `SELECT t.id, t.status, t.vehicle_id, v.registration_number FROM fulfilment.trip t
       JOIN trading_partners.vehicle v ON v.id = t.vehicle_id WHERE t.id = $1`,
      [tripId],
    );
    return r.rows[0] ?? null;
  }

  /** A trip's stops with the party at each: the farmer for a pickup, the customer for a delivery. */
  async tripStops(client: PoolClient, tripId: string): Promise<Row[]> {
    const r = await client.query(
      `SELECT s.id, s.sequence_number, s.stop_type, s.status,
              CASE s.stop_type WHEN 'pickup' THEN 'farmer' ELSE 'customer' END AS party_kind,
              COALESCE(p.farmer_id, o.customer_id) AS party_id, COALESCE(f.name, c.name) AS party_name
       FROM fulfilment.trip_stop s
       LEFT JOIN commerce.pickup p ON p.id = s.pickup_id
       LEFT JOIN trading_partners.farmer f ON f.id = p.farmer_id
       LEFT JOIN commerce.customer_order o ON o.id = s.order_id
       LEFT JOIN trading_partners.customer c ON c.id = o.customer_id
       WHERE s.trip_id = $1
       ORDER BY s.sequence_number`,
      [tripId],
    );
    return r.rows;
  }
}
