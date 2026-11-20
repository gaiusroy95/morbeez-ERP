import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AllocationRow, COMPONENTS, Components, CostComponent } from './costing-math';
import { fromCents } from '../../common/money';
import { fromMilli } from '../../common/quantity';
import { TripCostRecord } from './costing.entity';

const COLUMN: Record<CostComponent, string> = {
  fuel: 'fuel',
  tolls: 'tolls',
  repairs: 'repairs',
  driverIncentives: 'driver_incentives',
  otherExpenses: 'other_expenses',
  vehicle: 'vehicle',
  labour: 'labour',
  helperIncentives: 'helper_incentives',
  writtenOff: 'written_off',
};

export interface TripHeader {
  id: string;
  number: string | null;
  vehicleId: string;
  routeId: string | null;
  driverEmployeeId: string;
  openingKm: string | null;
  closingKm: string | null;
  closedAt: Date;
  closedOn: string;
  reconciled: boolean;
}

export interface StopLineRow {
  stop_id: string;
  stop_type: 'delivery' | 'pickup';
  status: string;
  customer_id: string | null;
  arrived_at: Date | null;
  completed_at: Date | null;
  key: string;
  product_id: string;
  kg: string | null; // KG-equivalent, 3 dp; null: the product has no weight
  value: string;
}

/** One delivered order line in a period, with everything its contribution needs (rule C6). */
export interface LineFactRow {
  invoice_id: string;
  invoice_line_id: string;
  order_line_id: string;
  order_id: string;
  order_number: number;
  customer_id: string;
  customer_name: string;
  product_id: string;
  product_name: string;
  route_id: string | null;
  route_name: string | null;
  trip_id: string | null;
  trip_number: string | null;
  vehicle_id: string | null;
  vehicle_registration: string | null;
  kg: string;
  revenue: string; // taxable value less what credit notes took back
  purchase: string;
  agent: string;
  fuel: string;
  tolls: string;
  repairs: string;
  driver_incentives: string;
  other_expenses: string;
  vehicle: string;
  labour: string;
  helper_incentives: string;
  written_off: string;
}

/** Costs no order line carries, at the level that holds them (rule C6). */
export interface ExtraCostRow {
  kind: 'unallocated' | 'inbound' | 'store_write_off';
  trip_id: string | null;
  trip_number: string | null;
  vehicle_id: string | null;
  vehicle_registration: string | null;
  route_id: string | null;
  route_name: string | null;
  product_id: string | null;
  product_name: string | null;
  amount: string;
  other_expenses: string;
  written_off: string;
  kg: string;
}

export interface InvoiceFinanceRow {
  invoice_id: string;
  amount: string;
  issued_on: string;
  reductions: { on: string; cents: string }[];
}

// KG-equivalent of a quantity (rule C4): kg as is, g ÷ 1000, any other unit × the product's weight per unit.
const KG = (q: string) => `ROUND(CASE p.base_uom WHEN 'kg' THEN ${q} WHEN 'g' THEN ${q} / 1000 ELSE ${q} * p.unit_weight_kg END, 3)`;

/** Costing reads what Logistics, Fleet, Stock and Finance recorded; it writes only its own two tables. */
@Injectable()
export class CostingRepository {
  async tripWithClient(client: PoolClient, tripId: string): Promise<TripHeader | null> {
    const r = await client.query<{
      id: string;
      number: string | null;
      vehicle_id: string;
      route_id: string | null;
      driver_employee_id: string;
      opening_km: string | null;
      closing_km: string | null;
      closed_at: Date;
      closed_on: string;
      reconciled: boolean;
    }>(
      `SELECT t.id, t.number, t.vehicle_id, t.route_id, t.driver_employee_id, t.opening_km::text, t.closing_km::text,
              COALESCE(r.reconciled_at, now()) AS closed_at,
              (COALESCE(r.reconciled_at, now()) AT TIME ZONE tn.timezone)::date::text AS closed_on,
              r.id IS NOT NULL AS reconciled
         FROM fulfilment.trip t
         LEFT JOIN fulfilment.trip_reconciliation r ON r.trip_id = t.id
         CROSS JOIN (SELECT timezone FROM tenant.tenant WHERE id = current_tenant_id()) tn
        WHERE t.id = $1`,
      [tripId],
    );
    const x = r.rows[0];
    if (!x) return null;
    return {
      id: x.id,
      number: x.number,
      vehicleId: x.vehicle_id,
      routeId: x.route_id,
      driverEmployeeId: x.driver_employee_id,
      openingKm: x.opening_km,
      closingKm: x.closing_km,
      closedAt: x.closed_at,
      closedOn: x.closed_on,
      reconciled: x.reconciled,
    };
  }

  async hasCostWithClient(client: PoolClient, tripId: string): Promise<boolean> {
    const r = await client.query('SELECT 1 FROM money.trip_cost WHERE trip_id = $1', [tripId]);
    return (r.rowCount ?? 0) > 0;
  }

  /** The trip's own costs, by component (rule C1): expenses the owner didn't reject, fuel logged to it, incentives, write-offs. */
  async directCostsWithClient(client: PoolClient, tripId: string, driverEmployeeId: string): Promise<Omit<Components, 'vehicle'>> {
    const r = await client.query<Record<string, string>>(
      `SELECT
         (COALESCE((SELECT SUM(amount) FROM fulfilment.trip_expense WHERE trip_id = $1 AND category = 'fuel' AND decision IS DISTINCT FROM 'rejected'), 0)
          + COALESCE((SELECT SUM(amount) FROM fleet.fuel_log WHERE trip_id = $1), 0))::numeric(12,2)::text AS fuel,
         COALESCE((SELECT SUM(amount) FROM fulfilment.trip_expense WHERE trip_id = $1 AND category IN ('toll', 'parking') AND decision IS DISTINCT FROM 'rejected'), 0)::numeric(12,2)::text AS tolls,
         COALESCE((SELECT SUM(amount) FROM fulfilment.trip_expense WHERE trip_id = $1 AND category = 'repair' AND decision IS DISTINCT FROM 'rejected'), 0)::numeric(12,2)::text AS repairs,
         COALESCE((SELECT SUM(amount) FROM fulfilment.trip_expense WHERE trip_id = $1 AND category = 'other' AND decision IS DISTINCT FROM 'rejected'), 0)::numeric(12,2)::text AS other_expenses,
         COALESCE((SELECT SUM(amount) FROM fulfilment.trip_expense WHERE trip_id = $1 AND category = 'labour' AND decision IS DISTINCT FROM 'rejected'), 0)::numeric(12,2)::text AS labour,
         COALESCE((SELECT SUM(amount) FROM workforce.trip_incentive WHERE trip_id = $1 AND employee_id = $2), 0)::numeric(12,2)::text AS driver_incentives,
         COALESCE((SELECT SUM(amount) FROM workforce.trip_incentive WHERE trip_id = $1 AND employee_id <> $2), 0)::numeric(12,2)::text AS helper_incentives,
         COALESCE((SELECT SUM(l.debit) FROM money.ledger_entry e JOIN money.ledger_line l ON l.entry_id = e.id
                    WHERE e.entry_type = 'inventory_written_off' AND l.account_code = 'shrinkage_expense'
                      AND e.source_id IN (SELECT id FROM stock.inventory_movement WHERE trip_id = $1)), 0)::numeric(12,2)::text AS written_off`,
      [tripId, driverEmployeeId],
    );
    const x = r.rows[0];
    const c = (k: string) => BigInt(x[k].replace('.', ''));
    return {
      fuel: c('fuel'),
      tolls: c('tolls'),
      repairs: c('repairs'),
      driverIncentives: c('driver_incentives'),
      otherExpenses: c('other_expenses'),
      labour: c('labour'),
      helperIncentives: c('helper_incentives'),
      writtenOff: c('written_off'),
    };
  }

  /**
   * The vehicle's cost per km for trips closing on `closedOn` (rule C1): what
   * it cost over the 30 days before that day, over the km of its trips closed
   * in them. Every cost is spread over the days it covers — depreciation by
   * its month, documents and hire by their periods, and a one-off (a repair,
   * loan interest, fuel not logged to a trip) over the 30 days from when it
   * was paid — so the rate is smooth, every trip closing on a day uses the
   * same one, and steady running absorbs what the vehicle cost: no cost is
   * charged again by each trip that closes while it is in the window. A
   * vehicle with no km in those days carries none yet.
   */
  async vehicleWindowWithClient(client: PoolClient, vehicleId: string, closedOn: string): Promise<{ fixedCents: bigint; kmTenths: bigint }> {
    const r = await client.query<{ fixed: string; km_tenths: string }>(
      `WITH tn AS (SELECT timezone FROM tenant.tenant WHERE id = current_tenant_id()),
            w AS (SELECT $2::date - 30 AS d0, $2::date - 1 AS d1),
            -- [start, end] a cost covers, and its amount; overlap with the window ÷ its days, below.
            spans AS (
              SELECT m.service_date AS s, m.service_date + 29 AS e, m.amount FROM fleet.maintenance_record m WHERE m.vehicle_id = $1
              UNION ALL
              SELECT d.valid_from, d.valid_until, d.amount FROM fleet.vehicle_document d
               WHERE d.vehicle_id = $1 AND d.valid_from IS NOT NULL AND d.valid_until IS NOT NULL AND d.valid_until >= d.valid_from
              UNION ALL
              SELECT (d.created_at AT TIME ZONE tn.timezone)::date, (d.created_at AT TIME ZONE tn.timezone)::date + 29, d.amount
                FROM fleet.vehicle_document d, tn
               WHERE d.vehicle_id = $1 AND (d.valid_from IS NULL OR d.valid_until IS NULL OR d.valid_until < d.valid_from)
              UNION ALL
              SELECT e.period_month, (e.period_month + interval '1 month')::date - 1, e.amount FROM fleet.depreciation_entry e WHERE e.vehicle_id = $1
              UNION ALL
              SELECT b.period_start, b.period_end, b.amount FROM fleet.hire_bill b WHERE b.vehicle_id = $1 AND b.period_end >= b.period_start
              UNION ALL
              SELECT p.paid_on, p.paid_on + 29, p.interest FROM fleet.loan_payment p JOIN fleet.vehicle_loan l ON l.id = p.loan_id WHERE l.vehicle_id = $1
              UNION ALL
              SELECT f.filled_on, f.filled_on + 29, f.amount FROM fleet.fuel_log f WHERE f.vehicle_id = $1 AND f.trip_id IS NULL
            )
       SELECT ROUND(COALESCE((
                SELECT SUM(x.amount * (LEAST(x.e, w.d1) - GREATEST(x.s, w.d0) + 1)::numeric / (x.e - x.s + 1))
                  FROM spans x, w WHERE x.e >= w.d0 AND x.s <= w.d1 AND x.amount > 0), 0), 2)::text AS fixed,
              COALESCE((SELECT SUM((t.closing_km - t.opening_km) * 10)
                          FROM fulfilment.trip t JOIN fulfilment.trip_reconciliation r ON r.trip_id = t.id, w, tn
                         WHERE t.vehicle_id = $1 AND t.closing_km > t.opening_km
                           AND (r.reconciled_at AT TIME ZONE tn.timezone)::date BETWEEN w.d0 AND w.d1), 0)::bigint::text AS km_tenths`,
      [vehicleId, closedOn],
    );
    return { fixedCents: BigInt(r.rows[0].fixed.replace('.', '')), kmTenths: BigInt(r.rows[0].km_tenths) };
  }

  /** Every delivery stop's order lines and every completed pickup's lots, with their KG-equivalent and value (rules C2, C4). */
  async stopLinesWithClient(client: PoolClient, tripId: string): Promise<StopLineRow[]> {
    const r = await client.query<StopLineRow>(
      `SELECT s.id AS stop_id, s.stop_type, s.status, o.customer_id, s.arrived_at, s.completed_at,
              ol.id AS key, ol.product_id,
              CASE WHEN s.status <> 'completed' OR COALESCE(ol.delivered_quantity, 0) = 0 THEN '0.000'
                   ELSE ${KG('ol.delivered_quantity')}::text END AS kg,
              CASE WHEN s.status = 'completed' THEN ROUND(COALESCE(ol.delivered_quantity, 0) * ol.unit_price, 2) ELSE 0 END::numeric(14,2)::text AS value,
              s.sequence_number
         FROM fulfilment.trip_stop s
         JOIN commerce.customer_order o ON o.id = s.order_id
         JOIN commerce.customer_order_line ol ON ol.order_id = o.id
         JOIN trading_partners.product p ON p.id = ol.product_id
        WHERE s.trip_id = $1 AND s.stop_type = 'delivery'
       UNION ALL
       SELECT s.id, s.stop_type, s.status, NULL, s.arrived_at, s.completed_at,
              l.id, l.product_id,
              CASE WHEN COALESCE(l.received_quantity, 0) = 0 THEN '0.000' ELSE ${KG('l.received_quantity')}::text END,
              ROUND(COALESCE(l.accepted_quantity, 0) * COALESCE(l.unit_cost, 0), 2)::numeric(14,2)::text,
              s.sequence_number
         FROM fulfilment.trip_stop s
         JOIN commerce.lot l ON l.pickup_id = s.pickup_id
         JOIN trading_partners.product p ON p.id = l.product_id
        WHERE s.trip_id = $1 AND s.stop_type = 'pickup' AND s.status = 'completed'
        ORDER BY sequence_number, key`,
      [tripId],
    );
    return r.rows;
  }

  /** When each customer's first verified service time was recorded, before this trip (D1's 30 days). */
  async firstServiceWithClient(client: PoolClient, customerIds: string[], tripId: string): Promise<Map<string, Date>> {
    if (customerIds.length === 0) return new Map();
    const r = await client.query<{ customer_id: string; first_at: Date }>(
      `SELECT o.customer_id, MIN(s.completed_at) AS first_at
         FROM fulfilment.trip_stop s JOIN commerce.customer_order o ON o.id = s.order_id
        WHERE s.stop_type = 'delivery' AND s.trip_id <> $2 AND o.customer_id = ANY($1::uuid[])
          AND s.arrived_at IS NOT NULL AND s.completed_at > s.arrived_at
          AND s.completed_at - s.arrived_at <= interval '180 minutes'
        GROUP BY o.customer_id`,
      [customerIds, tripId],
    );
    return new Map(r.rows.map((x) => [x.customer_id, x.first_at]));
  }

  /** The running pool's share by KG in force at `at` (D1): 50% until the owner sets it. */
  async kgSharePctWithClient(client: PoolClient, at: Date): Promise<string> {
    const r = await client.query<{ pct: string }>(
      'SELECT kg_share_pct::text AS pct FROM money.cost_allocation_setting WHERE effective_from <= $1 ORDER BY effective_from DESC, id DESC LIMIT 1',
      [at],
    );
    return r.rows[0]?.pct ?? '50.00';
  }

  async settingsWithClient(client: PoolClient): Promise<{ kgSharePct: string; effectiveFrom: Date; setBy: string | null; note: string | null }[]> {
    const r = await client.query<{ kg_share_pct: string; effective_from: Date; set_by: string | null; note: string | null }>(
      `SELECT s.kg_share_pct::text, s.effective_from, COALESCE(u.email::text, u.phone) AS set_by, s.note
         FROM money.cost_allocation_setting s LEFT JOIN identity.app_user u ON u.id = s.set_by
        ORDER BY s.effective_from DESC, s.id DESC LIMIT 50`,
    );
    return r.rows.map((x) => ({ kgSharePct: x.kg_share_pct, effectiveFrom: x.effective_from, setBy: x.set_by, note: x.note }));
  }

  async insertSettingWithClient(client: PoolClient, tenantId: string, kgSharePct: string, setBy: string, note: string | null): Promise<void> {
    await client.query('INSERT INTO money.cost_allocation_setting (tenant_id, kg_share_pct, set_by, note) VALUES ($1, $2, $3, $4)', [tenantId, kgSharePct, setBy, note]);
  }

  /**
   * The standard a trip is held to (FX 7; rule C5): delivery cost over KG
   * delivered on trips closed in the 30 days before `before` — on the route
   * when it has 3 such trips, else the business when it has 3, else none.
   */
  async standardWithClient(
    client: PoolClient,
    tripId: string,
    routeId: string | null,
    before: Date,
  ): Promise<{ basis: 'route' | 'business'; costCents: bigint; kgMilli: bigint; trips: number } | null> {
    const q = async (route: string | null) =>
      (
        await client.query<{ cost: string; kg: string; trips: number }>(
          `SELECT COALESCE(SUM(c.delivery_cost), 0)::numeric(14,2)::text AS cost, COALESCE(SUM(c.delivered_kg), 0)::numeric(14,3)::text AS kg, count(*)::int AS trips
             FROM money.trip_cost c
             JOIN fulfilment.trip t ON t.id = c.trip_id
             JOIN fulfilment.trip_reconciliation r ON r.trip_id = c.trip_id
            WHERE c.trip_id <> $1 AND c.delivered_kg > 0
              AND r.reconciled_at < $2 AND r.reconciled_at >= $2 - interval '30 days'
              AND ($3::uuid IS NULL OR t.route_id = $3)`,
          [tripId, before, route],
        )
      ).rows[0];
    const toFigures = (x: { cost: string; kg: string; trips: number }) => ({
      costCents: BigInt(x.cost.replace('.', '')),
      kgMilli: BigInt(x.kg.replace('.', '')),
      trips: x.trips,
    });
    if (routeId) {
      const route = await q(routeId);
      if (route.trips >= 3) return { basis: 'route', ...toFigures(route) };
    }
    const business = await q(null);
    return business.trips >= 3 ? { basis: 'business', ...toFigures(business) } : null;
  }

  async insertTripCostWithClient(
    client: PoolClient,
    c: {
      tenantId: string;
      tripId: string;
      source: 'close' | 'backfill';
      computedBy: string;
      kgSharePct: string;
      pools: Components;
      tripKm: string | null;
      ratePerKm: string | null;
      deliveredKgMilli: bigint;
      pickupKgMilli: bigint;
      deliveryCost: bigint;
      inboundCost: bigint;
      unallocated: bigint;
      unallocatedReason: string | null;
      unweightedLines: number;
      actualPerKg: string | null;
      standardPerKg: string | null;
      standardBasis: 'route' | 'business' | null;
      standardTrips: number;
      variancePerKg: string | null;
    },
    rows: AllocationRow[],
  ): Promise<void> {
    const running = c.pools.fuel + c.pools.tolls + c.pools.repairs + c.pools.driverIncentives + c.pools.otherExpenses + c.pools.vehicle;
    const load = c.pools.labour + c.pools.helperIncentives + c.pools.writtenOff;
    const cols = COMPONENTS.map((k) => COLUMN[k]);
    await client.query(
      `INSERT INTO money.trip_cost
         (trip_id, tenant_id, source, computed_by, kg_share_pct, ${cols.join(', ')}, running_total, load_total, total,
          trip_km, vehicle_rate_per_km, delivered_kg, pickup_kg, delivery_cost, inbound_cost, unallocated, unallocated_reason,
          unweighted_lines, actual_per_kg, standard_per_kg, standard_basis, standard_trips, variance_per_kg)
       VALUES ($1, $2, $3, $4, $5, ${cols.map((_, i) => `$${6 + i}`).join(', ')},
               $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31)`,
      [
        c.tripId,
        c.tenantId,
        c.source,
        c.computedBy,
        c.kgSharePct,
        ...COMPONENTS.map((k) => fromCents(c.pools[k])),
        fromCents(running),
        fromCents(load),
        fromCents(running + load),
        c.tripKm,
        c.ratePerKm,
        fromMilli(c.deliveredKgMilli),
        fromMilli(c.pickupKgMilli),
        fromCents(c.deliveryCost),
        fromCents(c.inboundCost),
        fromCents(c.unallocated),
        c.unallocatedReason,
        c.unweightedLines,
        c.actualPerKg,
        c.standardPerKg,
        c.standardBasis,
        c.standardTrips,
        c.variancePerKg,
      ],
    );
    for (const row of rows) {
      const amount = COMPONENTS.reduce((s, k) => s + row.components[k], 0n);
      await client.query(
        `INSERT INTO money.trip_cost_allocation
           (tenant_id, trip_id, trip_stop_id, order_line_id, lot_id, customer_id, product_id, kg, service_minutes, ${cols.join(', ')}, amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ${cols.map((_, i) => `$${10 + i}`).join(', ')}, $19)`,
        [
          c.tenantId,
          c.tripId,
          row.stopId,
          row.kind === 'order_line' ? row.key : null,
          row.kind === 'lot' ? row.key : null,
          row.kind === 'order_line' ? row.customerId : null,
          row.productId,
          fromMilli(row.kgMilli),
          row.serviceMinutes,
          ...COMPONENTS.map((k) => fromCents(row.components[k])),
          fromCents(amount),
        ],
      );
    }
  }

  async tripCostWithClient(client: PoolClient, tripId: string): Promise<TripCostRecord | null> {
    const r = await client.query<Record<string, unknown>>(
      `SELECT c.*, t.number AS trip_number,
              (SELECT count(*)::int FROM money.trip_cost_allocation a WHERE a.trip_id = c.trip_id AND a.order_line_id IS NOT NULL) AS order_lines,
              (SELECT count(DISTINCT a.customer_id)::int FROM money.trip_cost_allocation a WHERE a.trip_id = c.trip_id) AS customers,
              (SELECT count(*)::int FROM money.trip_cost_allocation a WHERE a.trip_id = c.trip_id AND a.lot_id IS NOT NULL) AS lots
         FROM money.trip_cost c JOIN fulfilment.trip t ON t.id = c.trip_id
        WHERE c.trip_id = $1`,
      [tripId],
    );
    const x = r.rows[0];
    if (!x) return null;
    const m = (k: string) => String(x[k]);
    const allocations = await client.query<Record<string, unknown>>(
      `SELECT a.trip_stop_id, a.order_line_id, a.lot_id, a.customer_id, cu.name AS customer_name, p.name AS product_name,
              a.kg::text AS kg, a.service_minutes, a.amount::text AS amount, ${COMPONENTS.map((k) => `a.${COLUMN[k]}::text AS ${COLUMN[k]}`).join(', ')}
         FROM money.trip_cost_allocation a
         JOIN trading_partners.product p ON p.id = a.product_id
         LEFT JOIN trading_partners.customer cu ON cu.id = a.customer_id
         JOIN fulfilment.trip_stop s ON s.id = a.trip_stop_id
        WHERE a.trip_id = $1
        ORDER BY s.sequence_number, p.name`,
      [tripId],
    );
    return {
      tripId: m('trip_id'),
      tripNumber: x.trip_number as string | null,
      source: x.source as 'close' | 'backfill',
      computedAt: x.computed_at as Date,
      kgSharePct: m('kg_share_pct'),
      components: Object.fromEntries(COMPONENTS.map((k) => [k, m(COLUMN[k])])) as Record<CostComponent, string>,
      runningTotal: m('running_total'),
      loadTotal: m('load_total'),
      total: m('total'),
      tripKm: x.trip_km === null ? null : m('trip_km'),
      vehicleRatePerKm: x.vehicle_rate_per_km === null ? null : m('vehicle_rate_per_km'),
      deliveredKg: m('delivered_kg'),
      pickupKg: m('pickup_kg'),
      deliveryCost: m('delivery_cost'),
      inboundCost: m('inbound_cost'),
      unallocated: m('unallocated'),
      unallocatedReason: x.unallocated_reason as string | null,
      unweightedLines: x.unweighted_lines as number,
      actualPerKg: x.actual_per_kg === null ? null : m('actual_per_kg'),
      standardPerKg: x.standard_per_kg === null ? null : m('standard_per_kg'),
      standardBasis: x.standard_basis as 'route' | 'business' | null,
      standardTrips: x.standard_trips as number,
      variancePerKg: x.variance_per_kg === null ? null : m('variance_per_kg'),
      orderLines: x.order_lines as number,
      customers: x.customers as number,
      lots: x.lots as number,
      allocations: allocations.rows.map((a) => ({
        stopId: a.trip_stop_id as string,
        orderLineId: a.order_line_id as string | null,
        lotId: a.lot_id as string | null,
        customerId: a.customer_id as string | null,
        customerName: a.customer_name as string | null,
        productName: a.product_name as string,
        kg: a.kg as string,
        serviceMinutes: a.service_minutes as number | null,
        amount: a.amount as string,
        components: Object.fromEntries(COMPONENTS.map((k) => [k, a[COLUMN[k]] as string])) as Record<CostComponent, string>,
      })),
    };
  }

  /** Closed trips with no cost worked out yet — closed before costing existed (rule C8). */
  async uncostedTripsWithClient(client: PoolClient): Promise<string[]> {
    const r = await client.query<{ id: string }>(
      `SELECT t.id FROM fulfilment.trip t JOIN fulfilment.trip_reconciliation r ON r.trip_id = t.id
        WHERE NOT EXISTS (SELECT 1 FROM money.trip_cost c WHERE c.trip_id = t.id)
        ORDER BY r.reconciled_at, t.id`,
    );
    return r.rows.map((x) => x.id);
  }

  // ---- Contribution (rule C6) ----

  /**
   * One row per sale-invoice line issued in the period: revenue (taxable,
   * less what credit notes took back), purchase and agent commission from
   * the lots it was delivered from, and its share of its trip's costs.
   */
  async lineFactsWithClient(client: PoolClient, from: string, to: string): Promise<LineFactRow[]> {
    const r = await client.query<LineFactRow>(
      `WITH tn AS (SELECT timezone FROM tenant.tenant WHERE id = current_tenant_id()),
       lines AS (
         SELECT i.id AS invoice_id, il.id AS invoice_line_id, il.order_line_id, ol.order_id, o.number AS order_number,
                i.customer_id, cu.name AS customer_name, ol.product_id, p.name AS product_name, o.route_id, rt.name AS route_name,
                COALESCE(lt.taxable_value, il.amount)
                  - COALESCE((SELECT SUM(nl.taxable_value) FROM money.credit_note_line nl WHERE nl.invoice_line_id = il.id), 0) AS revenue,
                COALESCE(${KG('ol.delivered_quantity')}, 0) AS kg
           FROM money.invoice i
           JOIN money.invoice_line il ON il.invoice_id = i.id
           JOIN commerce.customer_order_line ol ON ol.id = il.order_line_id
           JOIN commerce.customer_order o ON o.id = ol.order_id
           JOIN trading_partners.customer cu ON cu.id = i.customer_id
           JOIN trading_partners.product p ON p.id = ol.product_id
           LEFT JOIN trading_partners.route rt ON rt.id = o.route_id
           LEFT JOIN tax.invoice_line_tax lt ON lt.invoice_line_id = il.id
           , tn
          WHERE i.kind = 'sale' AND (i.issued_at AT TIME ZONE tn.timezone)::date BETWEEN $1::date AND $2::date
       ),
       alloc AS (
         SELECT order_line_id, (array_agg(trip_id ORDER BY trip_id))[1] AS trip_id,
                ${COMPONENTS.map((k) => `SUM(${COLUMN[k]}) AS ${COLUMN[k]}`).join(', ')}
           FROM money.trip_cost_allocation WHERE order_line_id IN (SELECT order_line_id FROM lines)
          GROUP BY order_line_id
       )
       SELECT l.invoice_id, l.invoice_line_id, l.order_line_id, l.order_id, l.order_number, l.customer_id, l.customer_name,
              l.product_id, l.product_name, l.route_id, l.route_name,
              a.trip_id, t.number AS trip_number, t.vehicle_id, v.registration_number AS vehicle_registration,
              l.kg::numeric(14,3)::text AS kg, ROUND(l.revenue, 2)::text AS revenue,
              ROUND(COALESCE((SELECT SUM(la.delivered_quantity * lo.unit_cost)
                                FROM commerce.lot_allocation la JOIN commerce.lot lo ON lo.id = la.lot_id
                               WHERE la.order_line_id = l.order_line_id), 0), 2)::text AS purchase,
              ROUND(COALESCE((SELECT SUM(${KG('la.delivered_quantity')} * ac.amount / ac.accepted_kg)
                                FROM commerce.lot_allocation la
                                JOIN money.agent_commission ac ON ac.lot_id = la.lot_id
                                JOIN commerce.lot lo ON lo.id = la.lot_id
                                JOIN trading_partners.product p ON p.id = lo.product_id
                               WHERE la.order_line_id = l.order_line_id), 0), 2)::text AS agent,
              ${COMPONENTS.map((k) => `COALESCE(a.${COLUMN[k]}, 0)::numeric(12,2)::text AS ${COLUMN[k]}`).join(', ')}
         FROM lines l
         LEFT JOIN alloc a ON a.order_line_id = l.order_line_id
         LEFT JOIN fulfilment.trip t ON t.id = a.trip_id
         LEFT JOIN trading_partners.vehicle v ON v.id = t.vehicle_id
        ORDER BY l.customer_name, l.order_number, l.product_name, l.invoice_line_id`,
      [from, to],
    );
    return r.rows;
  }

  /**
   * Costs no sold line carries, by when they arose (rule C6): what stayed
   * unallocated on trips closed in the period (trip level), the inbound leg
   * charged to lots picked up on them (product level), and stock written off
   * in the store, off any trip (product level).
   */
  async extraCostsWithClient(client: PoolClient, from: string, to: string): Promise<ExtraCostRow[]> {
    const r = await client.query<ExtraCostRow>(
      `WITH tn AS (SELECT timezone FROM tenant.tenant WHERE id = current_tenant_id()),
       closed AS (
         SELECT c.*, t.number AS trip_number, t.vehicle_id, v.registration_number, t.route_id, rt.name AS route_name
           FROM money.trip_cost c
           JOIN fulfilment.trip t ON t.id = c.trip_id
           JOIN fulfilment.trip_reconciliation r ON r.trip_id = c.trip_id
           JOIN trading_partners.vehicle v ON v.id = t.vehicle_id
           LEFT JOIN trading_partners.route rt ON rt.id = t.route_id
           , tn
          WHERE (r.reconciled_at AT TIME ZONE tn.timezone)::date BETWEEN $1::date AND $2::date
       )
       SELECT 'unallocated' AS kind, c.trip_id, c.trip_number, c.vehicle_id, c.registration_number AS vehicle_registration,
              c.route_id, c.route_name, NULL::uuid AS product_id, NULL AS product_name,
              c.unallocated::text AS amount, c.unallocated::text AS other_expenses, '0.00' AS written_off, '0.000' AS kg
         FROM closed c WHERE c.unallocated > 0
       UNION ALL
       SELECT 'inbound', c.trip_id, c.trip_number, c.vehicle_id, c.registration_number, c.route_id, c.route_name,
              a.product_id, p.name, SUM(a.amount)::numeric(12,2)::text, SUM(a.amount)::numeric(12,2)::text, '0.00', SUM(a.kg)::numeric(14,3)::text
         FROM closed c JOIN money.trip_cost_allocation a ON a.trip_id = c.trip_id AND a.lot_id IS NOT NULL
         JOIN trading_partners.product p ON p.id = a.product_id
        GROUP BY c.trip_id, c.trip_number, c.vehicle_id, c.registration_number, c.route_id, c.route_name, a.product_id, p.name
       UNION ALL
       SELECT 'store_write_off', NULL, NULL, NULL, NULL, NULL, NULL, m.product_id, p.name,
              SUM(l.debit)::numeric(12,2)::text, '0.00', SUM(l.debit)::numeric(12,2)::text, '0.000'
         FROM money.ledger_entry e
         JOIN money.ledger_line l ON l.entry_id = e.id AND l.account_code = 'shrinkage_expense'
         JOIN stock.inventory_movement m ON m.id = e.source_id
         JOIN trading_partners.product p ON p.id = m.product_id
         , tn
        WHERE e.entry_type = 'inventory_written_off' AND m.trip_id IS NULL
          AND (e.occurred_at AT TIME ZONE tn.timezone)::date BETWEEN $1::date AND $2::date
        GROUP BY m.product_id, p.name`,
      [from, to],
    );
    return r.rows;
  }

  /** Each invoice's amount and what lowered it, and when — for the rupee-days it kept the business waiting (MS §31). */
  async invoiceFinanceWithClient(client: PoolClient, invoiceIds: string[]): Promise<InvoiceFinanceRow[]> {
    if (invoiceIds.length === 0) return [];
    const r = await client.query<InvoiceFinanceRow>(
      `WITH tn AS (SELECT timezone FROM tenant.tenant WHERE id = current_tenant_id())
       SELECT i.id AS invoice_id, i.amount::text AS amount, (i.issued_at AT TIME ZONE tn.timezone)::date::text AS issued_on,
              COALESCE((
                SELECT json_agg(json_build_object('on', x.on_date, 'cents', x.cents) ORDER BY x.on_date)
                  FROM (
                    SELECT (p.received_at AT TIME ZONE tn.timezone)::date::text AS on_date, (pa.amount * 100)::bigint::text AS cents
                      FROM money.customer_payment_allocation pa JOIN money.customer_payment p ON p.id = pa.payment_id
                     WHERE pa.invoice_id = i.id AND NOT EXISTS (SELECT 1 FROM money.customer_payment_reversal rv WHERE rv.payment_id = p.id)
                    UNION ALL
                    SELECT (n.issued_at AT TIME ZONE tn.timezone)::date::text, (n.amount * 100)::bigint::text FROM money.credit_note n WHERE n.invoice_id = i.id
                    UNION ALL
                    SELECT (w.written_off_at AT TIME ZONE tn.timezone)::date::text, (w.amount * 100)::bigint::text FROM money.receivable_write_off w WHERE w.invoice_id = i.id
                  ) x
              ), '[]'::json) AS reductions
         FROM money.invoice i, tn
        WHERE i.id = ANY($1::uuid[])`,
      [invoiceIds],
    );
    return r.rows;
  }

  async todayWithClient(client: PoolClient): Promise<string> {
    const r = await client.query<{ d: string }>('SELECT (now() AT TIME ZONE timezone)::date::text AS d FROM tenant.tenant WHERE id = current_tenant_id()');
    return r.rows[0].d;
  }

  async costOfCapitalWithClient(client: PoolClient): Promise<string> {
    const r = await client.query<{ pct: string }>('SELECT cost_of_capital_pct::text AS pct FROM ai.ai_settings LIMIT 1');
    return r.rows[0]?.pct ?? '18.00';
  }
}
