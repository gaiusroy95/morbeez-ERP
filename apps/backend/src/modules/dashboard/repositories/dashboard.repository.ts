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
    SELECT ol.id AS line_id, ol.product_id, COALESCE(ol.delivered_quantity, ol.quantity) AS quantity, ol.unit_price
    FROM fulfilment.trip_stop s
    JOIN fulfilment.trip t ON t.id = s.trip_id
    JOIN commerce.customer_order o ON o.id = s.order_id
    JOIN commerce.customer_order_line ol ON ol.order_id = o.id
    WHERE s.stop_type = 'delivery' AND s.status = 'completed'
      AND s.completed_at >= $1 AND s.completed_at < $2
  ),
  line_cost AS (
    -- Specific-lot costing (Accounting Engine LOT.1): a line's cost is the
    -- quantity-weighted unit cost of the kilos actually delivered for it.
    SELECT a.order_line_id AS line_id,
           SUM(a.delivered_quantity * l.unit_cost) / NULLIF(SUM(a.delivered_quantity), 0) AS avg_unit_cost
    FROM commerce.lot_allocation a JOIN commerce.lot l ON l.id = a.lot_id
    WHERE a.order_line_id IN (SELECT line_id FROM delivered_lines)
      AND a.delivered_quantity > 0 AND l.unit_cost IS NOT NULL
    GROUP BY a.order_line_id
  )`;

/**
 * A read model, not a bounded context's own data: every query here reads
 * across Orders, Procurement, Logistics, and Money tables directly. That is
 * the deliberate exception System Architecture DB.4 makes for reporting —
 * the dashboard never writes, and in production these queries move to the
 * read replica. RLS still applies to every statement (the client always
 * comes from DatabaseService.withTenant).
 */
export interface HomeRow {
  cash: string;
  trips_active: number;
  trips_today: number;
  procurement_today: number;
  deliveries_today: number;
  collections_today: number;
  customers_overdue: number;
  customers_overdue_amount: string;
  expense_approvals: number;
  vehicle_documents_due: number;
}

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
         (SELECT ROUND(
            (SELECT COALESCE(SUM(p.amount), 0) FROM money.customer_payment p
              WHERE p.received_at >= $1 AND p.received_at < $2)
          - (SELECT COALESCE(SUM(p.amount), 0) FROM money.customer_payment_reversal r
               JOIN money.customer_payment p ON p.id = r.payment_id
              WHERE r.reversed_at >= $1 AND r.reversed_at < $2), 2)::text) AS collections,
         (SELECT ROUND(COALESCE(SUM(f.amount), 0), 2)::text FROM money.farmer_payment f
           WHERE f.paid_at >= $1 AND f.paid_at < $2) AS farmer_settlements,
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
           WHERE l.status = 'available' AND l.unit_cost IS NOT NULL) AS stock_on_hand_value,
         -- Open invoices (finance charges included) net of credit on account.
         (SELECT ROUND(
            (SELECT COALESCE(SUM(outstanding), 0) FROM money.invoice_balance)
            - (SELECT COALESCE(SUM(unapplied), 0) FROM money.customer_payment_balance), 2)::text) AS receivables_outstanding,
         (SELECT ROUND(COALESCE(SUM(outstanding), 0), 2)::text
            FROM money.farmer_payable_balance) AS farmer_payables_outstanding`,
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
         (SELECT count(*)::int FROM money.farmer_payable_balance
           WHERE outstanding > 0 AND accrued_at < now() - make_interval(days => $5)) AS overdue_count,
         (SELECT ROUND(COALESCE(SUM(outstanding), 0), 2)::text FROM money.farmer_payable_balance
           WHERE outstanding > 0 AND accrued_at < now() - make_interval(days => $5)) AS overdue_value,
         breach.count AS credit_breach_count,
         breach.amount AS credit_breach_amount
       FROM (
         -- Same exposure OrdersService's credit check uses: what the
         -- customer owes now (open invoices net of credit on account) plus
         -- every confirmed, undelivered order.
         SELECT count(*)::int AS count, ROUND(COALESCE(SUM(exposure - credit_limit), 0), 2)::text AS amount
         FROM (
           SELECT c.credit_limit,
                  COALESCE((SELECT SUM(ol.quantity * ol.unit_price) FROM commerce.customer_order o
                              JOIN commerce.customer_order_line ol ON ol.order_id = o.id
                             WHERE o.customer_id = c.id AND o.status = 'confirmed'), 0)
                + COALESCE((SELECT SUM(outstanding) FROM money.invoice_balance b WHERE b.customer_id = c.id), 0)
                - COALESCE((SELECT SUM(unapplied) FROM money.customer_payment_balance p WHERE p.customer_id = c.id), 0)
                  AS exposure
           FROM trading_partners.customer c
         ) e
         WHERE exposure > credit_limit
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
         (SELECT count(DISTINCT b.lot_id)::int FROM stock.lot_balance b JOIN commerce.lot l ON l.id = b.lot_id
           WHERE l.status = 'available' AND b.quantity > b.reserved_quantity) AS lots_available,
         (SELECT count(DISTINCT b.lot_id)::int FROM stock.lot_balance b WHERE b.reserved_quantity > 0) AS lots_reserved,
         (SELECT count(*)::int FROM commerce.lot WHERE status = 'received_ungraded') AS lots_ungraded`,
      [startAt, endAt],
    );
    return result.rows[0];
  }

  /** Cash in hand and in the bank, as the ledger has it now. */
  async cashBalance(client: PoolClient): Promise<string> {
    const result = await client.query<{ cash: string }>(
      `SELECT ROUND(COALESCE(SUM(l.debit - l.credit), 0), 2)::text AS cash FROM money.ledger_line l
        WHERE l.account_code IN ('cash_on_hand', 'bank')`,
    );
    return result.rows[0].cash;
  }

  /**
   * Product by product, the sales invoiced in [$1, $2) — orders delivered
   * and spot sales, before GST — against the cost of the very kilos sold:
   * the delivered kilos of each order line at their lots' cost, and each
   * spot sale's lots at theirs (Accounting Engine LOT.1).
   */
  async productProfit(client: PoolClient, startAt: Date, endAt: Date): Promise<{ product_id: string; product: string; revenue: string; cost: string }[]> {
    const result = await client.query<{ product_id: string; product: string; revenue: string; cost: string }>(
      `WITH sold AS (
         SELECT i.id AS invoice_id, i.kind, il.id AS line_id, il.product_id, il.order_line_id, il.amount
         FROM money.invoice i JOIN money.invoice_line il ON il.invoice_id = i.id
         WHERE i.kind IN ('sale', 'spot_sale') AND i.issued_at >= $1 AND i.issued_at < $2 AND il.product_id IS NOT NULL
       ), revenue AS (
         SELECT product_id, SUM(amount) AS revenue FROM sold GROUP BY product_id
       ), order_cost AS (
         SELECT s.product_id, SUM(a.delivered_quantity * l.unit_cost) AS cost
         FROM sold s
         JOIN commerce.lot_allocation a ON a.order_line_id = s.order_line_id AND a.delivered_quantity > 0
         JOIN commerce.lot l ON l.id = a.lot_id AND l.unit_cost IS NOT NULL
         WHERE s.kind = 'sale'
         GROUP BY s.product_id
       ), spot_cost AS (
         SELECT sl.product_id, SUM(sll.quantity * sll.unit_cost) AS cost
         FROM spot.spot_sale ss
         JOIN spot.spot_sale_line sl ON sl.sale_id = ss.id
         JOIN spot.spot_sale_lot sll ON sll.line_id = sl.id
         WHERE ss.invoice_id IN (SELECT invoice_id FROM sold WHERE kind = 'spot_sale')
         GROUP BY sl.product_id
       )
       SELECT r.product_id, p.name AS product, ROUND(r.revenue, 2)::text AS revenue,
              ROUND(COALESCE(oc.cost, 0) + COALESCE(sc.cost, 0), 2)::text AS cost
       FROM revenue r
       JOIN trading_partners.product p ON p.id = r.product_id
       LEFT JOIN order_cost oc ON oc.product_id = r.product_id
       LEFT JOIN spot_cost sc ON sc.product_id = r.product_id
       ORDER BY r.revenue - COALESCE(oc.cost, 0) - COALESCE(sc.cost, 0) DESC, p.name`,
      [startAt, endAt],
    );
    return result.rows;
  }

  /** The few extra figures the owner's Home screen needs beyond the KPIs (redesign V1.1). */
  async home(client: PoolClient, todayStart: Date, todayEnd: Date, today: string): Promise<HomeRow> {
    const result = await client.query<HomeRow>(
      `SELECT
         (SELECT ROUND(COALESCE(SUM(l.debit - l.credit), 0), 2)::text FROM money.ledger_line l
           WHERE l.account_code IN ('cash_on_hand', 'bank')) AS cash,
         (SELECT count(*)::int FROM fulfilment.trip WHERE status = 'in_progress') AS trips_active,
         (SELECT count(*)::int FROM fulfilment.trip
           WHERE status = 'in_progress'
              OR (status = 'planned' AND (planned_date IS NULL OR planned_date <= $3::date))
              OR (status IN ('completed', 'reconciled', 'on_hold') AND completed_at >= $1 AND completed_at < $2)) AS trips_today,
         (SELECT count(*)::int FROM commerce.purchase_order
           WHERE status <> 'cancelled'
             AND (expected_delivery_date = $3::date
                  OR (expected_delivery_date IS NULL AND created_at >= $1 AND created_at < $2))) AS procurement_today,
         (SELECT count(*)::int FROM commerce.customer_order WHERE status = 'confirmed')
           + (SELECT count(DISTINCT s.order_id)::int FROM fulfilment.trip_stop s
               WHERE s.stop_type = 'delivery' AND s.status = 'completed'
                 AND s.completed_at >= $1 AND s.completed_at < $2) AS deliveries_today,
         (SELECT count(*)::int FROM money.customer_payment p
           WHERE p.received_at >= $1 AND p.received_at < $2) AS collections_today,
         (SELECT count(DISTINCT b.customer_id)::int FROM money.invoice_balance b
           WHERE b.outstanding > 0 AND b.due_date < $3::date) AS customers_overdue,
         (SELECT ROUND(COALESCE(SUM(b.outstanding), 0), 2)::text FROM money.invoice_balance b
           WHERE b.outstanding > 0 AND b.due_date < $3::date) AS customers_overdue_amount,
         (SELECT count(*)::int FROM fulfilment.trip_expense e JOIN fulfilment.trip t ON t.id = e.trip_id
           WHERE e.needs_approval AND t.status IN ('in_progress', 'completed', 'on_hold')) AS expense_approvals,
         (SELECT count(DISTINCT d.vehicle_id)::int FROM fleet.vehicle_document d
           WHERE d.valid_until IS NOT NULL AND d.valid_until < $3::date + 15
             AND NOT EXISTS (SELECT 1 FROM fleet.vehicle_document n
                              WHERE n.vehicle_id = d.vehicle_id AND n.doc_type = d.doc_type
                                AND n.valid_until > d.valid_until)) AS vehicle_documents_due`,
      [todayStart, todayEnd, today],
    );
    return result.rows[0];
  }

  /** The newest AI suggestion nobody has acted on yet, for the Home screen's insight card. */
  async latestInsight(client: PoolClient): Promise<{ id: string; title: string; explanation: string } | null> {
    const result = await client.query<{ id: string; title: string; explanation: string }>(
      `SELECT r.id, r.title, r.explanation FROM ai.recommendation r
        WHERE r.expires_at > now()
          AND NOT EXISTS (SELECT 1 FROM ai.recommendation_decision d WHERE d.recommendation_id = r.id)
        ORDER BY r.created_at DESC LIMIT 1`,
    );
    return result.rows[0] ?? null;
  }
}
