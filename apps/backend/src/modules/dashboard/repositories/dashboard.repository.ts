import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface ResolvedPeriod {
  timezone: string;
  currency: string;
  fromDate: string;
  toDate: string;
  previousFrom: string;
  previousTo: string;
  startAt: Date;
  endAt: Date;
  previousStartAt: Date;
}

export interface PeriodFlows {
  delivered_revenue: string;
  deliveries_completed: number;
  orders_booked: number;
  booked_order_value: string;
  procurement_spend: string;
  collections: string;
  farmer_settlements: string;
  trip_expenses: string;
}

export interface Balances {
  stock_on_hand_value: string;
  receivables_outstanding: string;
  farmer_payables_outstanding: string;
}

export interface ProfitTotalsRow {
  revenue: string;
  costed_revenue: string;
  cost_of_goods: string;
  gross_profit: string;
  gross_margin_percent: string | null;
  trip_expenses: string;
  operating_contribution: string;
}

export interface ProfitByProductRow {
  product_id: string;
  product_name: string;
  revenue: string;
  costed_revenue: string;
  cost_of_goods: string;
  gross_profit: string;
  gross_margin_percent: string | null;
  uncosted_lines: number;
}

export interface AlertThresholds {
  ungradedAfterHours: number;
  agingStockAfterDays: number;
  unreconciledAfterHours: number;
  cashVarianceLookbackDays: number;
  farmerPaymentOverdueAfterDays: number;
}

export interface AlertRow {
  approvals_pending: number;
  ungraded_count: number;
  aging_count: number;
  aging_value: string;
  unreconciled_count: number;
  variance_count: number;
  variance_amount: string;
  overdue_count: number;
  overdue_value: string;
  credit_breach_count: number;
  credit_breach_amount: string;
}

export interface OperationsRow {
  trips_planned: number;
  trips_in_progress: number;
  trips_completed_today: number;
  trips_awaiting_reconciliation: number;
  stops_pending: number;
  stops_completed_today: number;
  stops_skipped_today: number;
  orders_awaiting_confirmation: number;
  orders_awaiting_approval: number;
  orders_awaiting_delivery: number;
  orders_delivered_today: number;
  pos_placed: number;
  pos_awaiting_receipt: number;
  pos_awaiting_grading: number;
  pickups_scheduled_today: number;
  lots_available: number;
  lots_reserved: number;
  lots_ungraded: number;
}


// Delivery-stop lines completed within [$1, $2). Joins through
// fulfilment.trip and commerce.customer_order — both RLS-protected — so the
// tenant scope comes from Postgres, not from a WHERE clause here.
const DELIVERED_LINES_CTE = `
  delivered_lines AS (
    SELECT ol.id AS line_id, ol.product_id, ol.quantity, ol.unit_price
    FROM fulfilment.trip_stop s
    JOIN fulfilment.trip t ON t.id = s.trip_id
    JOIN commerce.customer_order o ON o.id = s.order_id
    JOIN commerce.customer_order_line ol ON ol.order_id = o.id
    WHERE s.stop_type = 'delivery' AND s.status = 'completed'
      AND s.completed_at >= $1 AND s.completed_at < $2
  ),
  line_cost AS (
    -- Specific-lot costing (Accounting Engine LOT.1): a line's cost is the
    -- quantity-weighted unit cost of the lots actually reserved for it.
    SELECT l.reserved_for_order_line_id AS line_id,
           SUM(l.current_quantity * l.unit_cost) / NULLIF(SUM(l.current_quantity), 0) AS avg_unit_cost
    FROM commerce.lot l
    WHERE l.reserved_for_order_line_id IN (SELECT line_id FROM delivered_lines)
      AND l.unit_cost IS NOT NULL
    GROUP BY l.reserved_for_order_line_id
  )`;

/**
 * A read model, not a bounded context's own data: every query here reads
 * across Orders, Procurement, Logistics, and Money tables directly. That is
 * the deliberate exception System Architecture DB.4 makes for reporting —
 * the dashboard never writes, and in production these queries move to the
 * read replica. RLS still applies to every statement (the client always
 * comes from DatabaseService.withTenant).
 */
@Injectable()
export class DashboardRepository {
  /**
   * Turns tenant-local calendar dates into the [startAt, endAt) instants
   * every other query filters on. `to` defaults to today in the tenant's
   * timezone; `from` defaults to `defaultDays` days ending on `to`.
   */
  async resolvePeriod(
    client: PoolClient,
    from: string | null,
    to: string | null,
    defaultDays: number,
  ): Promise<ResolvedPeriod | null> {
    const result = await client.query<{
      timezone: string;
      currency: string;
      from_date: string;
      to_date: string;
      previous_from: string;
      previous_to: string;
      start_at: Date;
      end_at: Date;
      previous_start_at: Date;
    }>(
      `WITH base AS (
         SELECT t.timezone, t.currency,
                COALESCE($2::date, (now() AT TIME ZONE t.timezone)::date) AS to_date
         FROM tenant.tenant t
         WHERE t.id = current_tenant_id()
       ),
       d AS (
         SELECT timezone, currency, to_date,
                COALESCE($1::date, to_date - ($3::int - 1)) AS from_date
         FROM base
       )
       SELECT timezone, currency,
              from_date::text AS from_date,
              to_date::text AS to_date,
              (from_date - (to_date - from_date + 1))::text AS previous_from,
              (from_date - 1)::text AS previous_to,
              from_date::timestamp AT TIME ZONE timezone AS start_at,
              (to_date + 1)::timestamp AT TIME ZONE timezone AS end_at,
              (from_date - (to_date - from_date + 1))::timestamp AT TIME ZONE timezone AS previous_start_at
       FROM d`,
      [from, to, defaultDays],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      timezone: row.timezone,
      currency: row.currency,
      fromDate: row.from_date,
      toDate: row.to_date,
      previousFrom: row.previous_from,
      previousTo: row.previous_to,
      startAt: row.start_at,
      endAt: row.end_at,
      previousStartAt: row.previous_start_at,
    };
  }

  async periodFlows(client: PoolClient, startAt: Date, endAt: Date): Promise<PeriodFlows> {
    const result = await client.query<PeriodFlows>(
      `SELECT
         (SELECT ROUND(COALESCE(SUM(ol.quantity * ol.unit_price), 0), 2)::text
            FROM fulfilment.trip_stop s
            JOIN fulfilment.trip t ON t.id = s.trip_id
            JOIN commerce.customer_order o ON o.id = s.order_id
            JOIN commerce.customer_order_line ol ON ol.order_id = o.id
           WHERE s.stop_type = 'delivery' AND s.status = 'completed'
             AND s.completed_at >= $1 AND s.completed_at < $2) AS delivered_revenue,
         (SELECT count(*)::int
            FROM fulfilment.trip_stop s
            JOIN fulfilment.trip t ON t.id = s.trip_id
           WHERE s.stop_type = 'delivery' AND s.status = 'completed'
             AND s.completed_at >= $1 AND s.completed_at < $2) AS deliveries_completed,
         (SELECT count(*)::int FROM commerce.customer_order o
           WHERE o.created_at >= $1 AND o.created_at < $2 AND o.status <> 'cancelled') AS orders_booked,
         (SELECT ROUND(COALESCE(SUM(ol.quantity * ol.unit_price), 0), 2)::text
            FROM commerce.customer_order o
            JOIN commerce.customer_order_line ol ON ol.order_id = o.id
           WHERE o.created_at >= $1 AND o.created_at < $2 AND o.status <> 'cancelled') AS booked_order_value,
         (SELECT ROUND(COALESCE(SUM(l.accepted_quantity * l.unit_cost), 0), 2)::text
            FROM commerce.lot l
           WHERE l.graded_at >= $1 AND l.graded_at < $2 AND l.unit_cost IS NOT NULL) AS procurement_spend,
         (SELECT ROUND(COALESCE(SUM(c.amount), 0), 2)::text FROM money.customer_collection c
           WHERE c.collected_at >= $1 AND c.collected_at < $2) AS collections,
         (SELECT ROUND(COALESCE(SUM(f.amount), 0), 2)::text FROM money.farmer_settlement f
           WHERE f.settled_at >= $1 AND f.settled_at < $2) AS farmer_settlements,
         (SELECT ROUND(COALESCE(SUM(e.amount), 0), 2)::text
            FROM fulfilment.trip_expense e
            JOIN fulfilment.trip t ON t.id = e.trip_id
           WHERE e.recorded_at >= $1 AND e.recorded_at < $2) AS trip_expenses`,
      [startAt, endAt],
    );
    return result.rows[0];
  }

  async balances(client: PoolClient): Promise<Balances> {
    const result = await client.query<Balances>(
      `SELECT
         (SELECT ROUND(COALESCE(SUM(l.current_quantity * l.unit_cost), 0), 2)::text
            FROM commerce.lot l
           WHERE l.status IN ('available', 'reserved') AND l.unit_cost IS NOT NULL) AS stock_on_hand_value,
         (SELECT ROUND(
            (SELECT COALESCE(SUM(ol.quantity * ol.unit_price), 0)
               FROM commerce.customer_order o
               JOIN commerce.customer_order_line ol ON ol.order_id = o.id
              WHERE o.status = 'delivered')
            - (SELECT COALESCE(SUM(c.amount), 0) FROM money.customer_collection c), 2)::text) AS receivables_outstanding,
         (SELECT ROUND(COALESCE(SUM(l.accepted_quantity * l.unit_cost), 0), 2)::text
            FROM commerce.lot l
           WHERE l.unit_cost IS NOT NULL AND l.accepted_quantity > 0
             AND NOT EXISTS (SELECT 1 FROM money.farmer_settlement fs WHERE fs.lot_id = l.id)) AS farmer_payables_outstanding`,
    );
    return result.rows[0];
  }

  async profitTotals(client: PoolClient, startAt: Date, endAt: Date): Promise<ProfitTotalsRow> {
    const result = await client.query<ProfitTotalsRow>(
      `WITH ${DELIVERED_LINES_CTE},
       totals AS (
         SELECT COALESCE(SUM(dl.quantity * dl.unit_price), 0) AS revenue,
                COALESCE(SUM(dl.quantity * dl.unit_price) FILTER (WHERE lc.avg_unit_cost IS NOT NULL), 0) AS costed_revenue,
                COALESCE(SUM(dl.quantity * lc.avg_unit_cost), 0) AS cost_of_goods
         FROM delivered_lines dl
         LEFT JOIN line_cost lc ON lc.line_id = dl.line_id
       ),
       expenses AS (
         SELECT COALESCE(SUM(e.amount), 0) AS trip_expenses
         FROM fulfilment.trip_expense e
         JOIN fulfilment.trip t ON t.id = e.trip_id
         WHERE e.recorded_at >= $1 AND e.recorded_at < $2
       )
       SELECT ROUND(revenue, 2)::text AS revenue,
              ROUND(costed_revenue, 2)::text AS costed_revenue,
              ROUND(cost_of_goods, 2)::text AS cost_of_goods,
              ROUND(costed_revenue - cost_of_goods, 2)::text AS gross_profit,
              ROUND(100 * (costed_revenue - cost_of_goods) / NULLIF(costed_revenue, 0), 1)::text AS gross_margin_percent,
              ROUND(trip_expenses, 2)::text AS trip_expenses,
              ROUND(costed_revenue - cost_of_goods - trip_expenses, 2)::text AS operating_contribution
       FROM totals, expenses`,
      [startAt, endAt],
    );
    return result.rows[0];
  }

  async profitByProduct(client: PoolClient, startAt: Date, endAt: Date, limit: number): Promise<ProfitByProductRow[]> {
    const result = await client.query<ProfitByProductRow>(
      `WITH ${DELIVERED_LINES_CTE},
       per_product AS (
         SELECT dl.product_id,
                SUM(dl.quantity * dl.unit_price) AS revenue,
                COALESCE(SUM(dl.quantity * dl.unit_price) FILTER (WHERE lc.avg_unit_cost IS NOT NULL), 0) AS costed_revenue,
                COALESCE(SUM(dl.quantity * lc.avg_unit_cost), 0) AS cost_of_goods,
                count(*) FILTER (WHERE lc.avg_unit_cost IS NULL) AS uncosted_lines
         FROM delivered_lines dl
         LEFT JOIN line_cost lc ON lc.line_id = dl.line_id
         GROUP BY dl.product_id
       )
       SELECT pp.product_id,
              p.name AS product_name,
              ROUND(pp.revenue, 2)::text AS revenue,
              ROUND(pp.costed_revenue, 2)::text AS costed_revenue,
              ROUND(pp.cost_of_goods, 2)::text AS cost_of_goods,
              ROUND(pp.costed_revenue - pp.cost_of_goods, 2)::text AS gross_profit,
              ROUND(100 * (pp.costed_revenue - pp.cost_of_goods) / NULLIF(pp.costed_revenue, 0), 1)::text AS gross_margin_percent,
              pp.uncosted_lines::int AS uncosted_lines
       FROM per_product pp
       JOIN trading_partners.product p ON p.id = pp.product_id
       ORDER BY pp.revenue DESC
       LIMIT $3`,
      [startAt, endAt, limit],
    );
    return result.rows;
  }

  async alerts(client: PoolClient, thresholds: AlertThresholds): Promise<AlertRow> {
    const result = await client.query<AlertRow>(
      `SELECT
         (SELECT count(*)::int FROM approvals.approval_request WHERE status = 'pending') AS approvals_pending,
         (SELECT count(*)::int FROM commerce.lot
           WHERE status = 'received_ungraded' AND received_at < now() - make_interval(hours => $1)) AS ungraded_count,
         (SELECT count(*)::int FROM commerce.lot
           WHERE status = 'available' AND current_quantity > 0
             AND received_at < now() - make_interval(days => $2)) AS aging_count,
         (SELECT ROUND(COALESCE(SUM(current_quantity * unit_cost), 0), 2)::text FROM commerce.lot
           WHERE status = 'available' AND current_quantity > 0
             AND received_at < now() - make_interval(days => $2)) AS aging_value,
         (SELECT count(*)::int FROM fulfilment.trip
           WHERE status = 'completed' AND completed_at < now() - make_interval(hours => $3)) AS unreconciled_count,
         (SELECT count(*)::int FROM fulfilment.trip_reconciliation r
            JOIN fulfilment.trip t ON t.id = r.trip_id
           WHERE r.variance > 0 AND r.reconciled_at >= now() - make_interval(days => $4)) AS variance_count,
         (SELECT ROUND(COALESCE(SUM(r.variance), 0), 2)::text FROM fulfilment.trip_reconciliation r
            JOIN fulfilment.trip t ON t.id = r.trip_id
           WHERE r.variance > 0 AND r.reconciled_at >= now() - make_interval(days => $4)) AS variance_amount,
         (SELECT count(*)::int FROM commerce.lot l
           WHERE l.unit_cost IS NOT NULL AND l.accepted_quantity > 0
             AND l.graded_at < now() - make_interval(days => $5)
             AND NOT EXISTS (SELECT 1 FROM money.farmer_settlement fs WHERE fs.lot_id = l.id)) AS overdue_count,
         (SELECT ROUND(COALESCE(SUM(l.accepted_quantity * l.unit_cost), 0), 2)::text FROM commerce.lot l
           WHERE l.unit_cost IS NOT NULL AND l.accepted_quantity > 0
             AND l.graded_at < now() - make_interval(days => $5)
             AND NOT EXISTS (SELECT 1 FROM money.farmer_settlement fs WHERE fs.lot_id = l.id)) AS overdue_value,
         breach.count AS credit_breach_count,
         breach.amount AS credit_breach_amount
       FROM (
         -- Same exposure definition OrdersService's credit check uses:
         -- the value of every confirmed order.
         SELECT count(*)::int AS count, ROUND(COALESCE(SUM(exposure - credit_limit), 0), 2)::text AS amount
         FROM (
           SELECT c.credit_limit, SUM(ol.quantity * ol.unit_price) AS exposure
           FROM trading_partners.customer c
           JOIN commerce.customer_order o ON o.customer_id = c.id AND o.status = 'confirmed'
           JOIN commerce.customer_order_line ol ON ol.order_id = o.id
           GROUP BY c.id, c.credit_limit
           HAVING SUM(ol.quantity * ol.unit_price) > c.credit_limit
         ) over_limit
       ) breach`,
      [
        thresholds.ungradedAfterHours,
        thresholds.agingStockAfterDays,
        thresholds.unreconciledAfterHours,
        thresholds.cashVarianceLookbackDays,
        thresholds.farmerPaymentOverdueAfterDays,
      ],
    );
    return result.rows[0];
  }

  async operations(client: PoolClient, startAt: Date, endAt: Date): Promise<OperationsRow> {
    const result = await client.query<OperationsRow>(
      `SELECT
         (SELECT count(*)::int FROM fulfilment.trip WHERE status = 'planned') AS trips_planned,
         (SELECT count(*)::int FROM fulfilment.trip WHERE status = 'in_progress') AS trips_in_progress,
         (SELECT count(*)::int FROM fulfilment.trip
           WHERE status IN ('completed', 'reconciled') AND completed_at >= $1 AND completed_at < $2) AS trips_completed_today,
         (SELECT count(*)::int FROM fulfilment.trip WHERE status = 'completed') AS trips_awaiting_reconciliation,
         (SELECT count(*)::int FROM fulfilment.trip_stop s JOIN fulfilment.trip t ON t.id = s.trip_id
           WHERE s.status = 'pending' AND t.status = 'in_progress') AS stops_pending,
         (SELECT count(*)::int FROM fulfilment.trip_stop s JOIN fulfilment.trip t ON t.id = s.trip_id
           WHERE s.status = 'completed' AND s.completed_at >= $1 AND s.completed_at < $2) AS stops_completed_today,
         (SELECT count(*)::int FROM fulfilment.trip_stop s JOIN fulfilment.trip t ON t.id = s.trip_id
           WHERE s.status = 'skipped' AND s.completed_at >= $1 AND s.completed_at < $2) AS stops_skipped_today,
         (SELECT count(*)::int FROM commerce.customer_order
           WHERE status = 'placed' AND approval_request_id IS NULL) AS orders_awaiting_confirmation,
         (SELECT count(*)::int FROM commerce.customer_order
           WHERE status = 'placed' AND approval_request_id IS NOT NULL) AS orders_awaiting_approval,
         (SELECT count(*)::int FROM commerce.customer_order WHERE status = 'confirmed') AS orders_awaiting_delivery,
         (SELECT count(DISTINCT s.order_id)::int FROM fulfilment.trip_stop s JOIN fulfilment.trip t ON t.id = s.trip_id
           WHERE s.stop_type = 'delivery' AND s.status = 'completed'
             AND s.completed_at >= $1 AND s.completed_at < $2) AS orders_delivered_today,
         (SELECT count(*)::int FROM commerce.purchase_order WHERE status = 'placed') AS pos_placed,
         (SELECT count(*)::int FROM commerce.purchase_order WHERE status = 'confirmed') AS pos_awaiting_receipt,
         (SELECT count(*)::int FROM commerce.purchase_order WHERE status = 'received') AS pos_awaiting_grading,
         (SELECT count(*)::int FROM commerce.pickup
           WHERE status = 'scheduled' AND scheduled_at >= $1 AND scheduled_at < $2) AS pickups_scheduled_today,
         (SELECT count(*)::int FROM commerce.lot l WHERE l.status = 'available' AND l.current_quantity > 0) AS lots_available,
         (SELECT count(*)::int FROM commerce.lot l WHERE l.status = 'reserved') AS lots_reserved,
         (SELECT count(*)::int FROM commerce.lot WHERE status = 'received_ungraded') AS lots_ungraded`,
      [startAt, endAt],
    );
    return result.rows[0];
  }
}
