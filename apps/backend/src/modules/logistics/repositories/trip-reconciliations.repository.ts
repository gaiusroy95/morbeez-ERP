import { ConflictException, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { ChecklistItem, ClosureOutcome, TripReconciliationRecord } from '../entities/trip-reconciliation.entity';

interface TripReconciliationRow {
  id: string;
  trip_id: string;
  advance_amount: string;
  total_expenses: string;
  cash_returned: string;
  spot_cash: string;
  cash_collections: string;
  cash_deposited: string;
  direct_payments: string;
  cash_declared: string | null;
  variance: string;
  outcome: ClosureOutcome;
  exception_note: string | null;
  checklist: ChecklistItem[] | null;
  notes: string | null;
  reconciled_by: string;
  reconciled_at: Date;
}

function toRecord(row: TripReconciliationRow): TripReconciliationRecord {
  return {
    id: row.id,
    tripId: row.trip_id,
    advanceAmount: row.advance_amount,
    totalExpenses: row.total_expenses,
    cashReturned: row.cash_returned,
    spotCash: row.spot_cash,
    cashCollections: row.cash_collections ?? '0.00',
    cashDeposited: row.cash_deposited ?? '0.00',
    directPayments: row.direct_payments ?? '0.00',
    cashDeclared: row.cash_declared ?? null,
    variance: row.variance,
    outcome: row.outcome ?? 'pass',
    exceptionNote: row.exception_note ?? null,
    checklist: row.checklist ?? null,
    notes: row.notes,
    reconciledBy: row.reconciled_by,
    reconciledAt: row.reconciled_at,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

@Injectable()
export class TripReconciliationsRepository {
  /**
   * Cash the driver took for completed spot sales on this trip, and how many
   * of the trip's spot sales still await an approval decision.
   */
  async spotSalesWithClient(client: PoolClient, tripId: string): Promise<{ cash: string; pending: number }> {
    const result = await client.query<{ cash: string; pending: number }>(
      `SELECT COALESCE(SUM(total) FILTER (WHERE status = 'completed' AND payment_method = 'cash'), 0)::numeric(12,2)::text AS cash,
              count(*) FILTER (WHERE status = 'pending_approval')::int AS pending
       FROM spot.spot_sale WHERE trip_id = $1`,
      [tripId],
    );
    return result.rows[0];
  }

  /**
   * The money side of a trip, for the handover: cash collected at delivery
   * stops that the driver holds (into_driver_float), customer payments by
   * UPI/bank/cheque that went straight to the business (no handover), and
   * cash the driver deposited in the bank on the road.
   */
  async moneyWithClient(client: PoolClient, tripId: string): Promise<{ cashCollections: string; directPayments: string; deposited: string }> {
    const result = await client.query<{ cash_collections: string; direct_payments: string; deposited: string }>(
      `SELECT
         (SELECT COALESCE(SUM(cc.amount) FILTER (WHERE cc.method = 'cash' AND cc.into_driver_float), 0)::numeric(12,2)::text
            FROM money.customer_collection cc JOIN fulfilment.trip_stop s ON s.id = cc.trip_stop_id WHERE s.trip_id = $1) AS cash_collections,
         (SELECT COALESCE(SUM(cc.amount) FILTER (WHERE cc.method <> 'cash'), 0)::numeric(12,2)::text
            FROM money.customer_collection cc JOIN fulfilment.trip_stop s ON s.id = cc.trip_stop_id WHERE s.trip_id = $1) AS direct_payments,
         (SELECT COALESCE(SUM(d.amount), 0)::numeric(12,2)::text
            FROM fulfilment.trip_cash_deposit d WHERE d.trip_id = $1) AS deposited`,
      [tripId],
    );
    const r = result.rows[0];
    return { cashCollections: r.cash_collections, directPayments: r.direct_payments, deposited: r.deposited };
  }

  /** What the owner checks before closing: the stops, what the vehicle carried, and what cash customers still owe. */
  async reviewFactsWithClient(client: PoolClient, tripId: string): Promise<TripReviewFacts> {
    const stops = await client.query<{ id: string; stop_type: 'pickup' | 'delivery'; status: string; name: string; notes: string | null; has_pod: boolean }>(
      `SELECT s.id, s.stop_type, s.status, s.notes,
              COALESCE(c.name, f.name, '') AS name,
              EXISTS (SELECT 1 FROM fulfilment.trip_stop_pod pod WHERE pod.trip_stop_id = s.id) AS has_pod
       FROM fulfilment.trip_stop s
       LEFT JOIN commerce.customer_order o ON o.id = s.order_id
       LEFT JOIN trading_partners.customer c ON c.id = o.customer_id
       LEFT JOIN commerce.pickup p ON p.id = s.pickup_id
       LEFT JOIN commerce.purchase_order po ON po.id = p.purchase_order_id
       LEFT JOIN trading_partners.farmer f ON f.id = po.farmer_id
       WHERE s.trip_id = $1
       ORDER BY s.sequence_number`,
      [tripId],
    );
    // Per product: what came onto the vehicle from farmers on this trip,
    // what went out to customers, and what came back (deliveries skipped).
    const load = await client.query<{ product: string; uom: string; picked_up: string; delivered: string; returned: string }>(
      `WITH moves AS (
         SELECT l.product_id, l.received_quantity AS picked_up, 0::numeric AS delivered, 0::numeric AS returned
         FROM fulfilment.trip_stop s JOIN commerce.lot l ON l.pickup_id = s.pickup_id
         WHERE s.trip_id = $1 AND s.stop_type = 'pickup' AND s.status = 'completed'
         UNION ALL
         SELECT ol.product_id, 0, CASE WHEN s.status = 'completed' THEN ol.quantity ELSE 0 END,
                CASE WHEN s.status = 'skipped' THEN ol.quantity ELSE 0 END
         FROM fulfilment.trip_stop s JOIN commerce.customer_order_line ol ON ol.order_id = s.order_id
         WHERE s.trip_id = $1 AND s.stop_type = 'delivery'
       )
       SELECT pr.name AS product, pr.base_uom AS uom,
              SUM(m.picked_up)::numeric(12,3)::text AS picked_up,
              SUM(m.delivered)::numeric(12,3)::text AS delivered,
              SUM(m.returned)::numeric(12,3)::text AS returned
       FROM moves m JOIN trading_partners.product pr ON pr.id = m.product_id
       GROUP BY pr.name, pr.base_uom
       ORDER BY pr.name`,
      [tripId],
    );
    // Customers on cash terms (no credit days) delivered to on this trip who
    // paid less than the invoice on the road.
    const unpaid = await client.query<{ customer: string; invoiced: string; collected: string }>(
      `SELECT c.name AS customer, i.amount::text AS invoiced,
              COALESCE((SELECT SUM(cc.amount) FROM money.customer_collection cc WHERE cc.trip_stop_id = s.id), 0)::numeric(12,2)::text AS collected
       FROM fulfilment.trip_stop s
       JOIN commerce.customer_order o ON o.id = s.order_id
       JOIN trading_partners.customer c ON c.id = o.customer_id
       JOIN money.invoice i ON i.order_id = o.id AND i.kind = 'sale'
       WHERE s.trip_id = $1 AND s.status = 'completed' AND c.payment_terms_days = 0
         AND COALESCE((SELECT SUM(cc.amount) FROM money.customer_collection cc WHERE cc.trip_stop_id = s.id), 0) < i.amount
       ORDER BY c.name`,
      [tripId],
    );
    // Spent by a driver whose authority didn't cover expenses: the owner's to approve.
    const unapproved = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::numeric(12,2)::text AS total
         FROM fulfilment.trip_expense WHERE trip_id = $1 AND needs_approval`,
      [tripId],
    );
    // Shrinkage or breakage above the owner's tolerance at a delivery.
    const losses = await client.query<{ customer: string; product: string; uom: string; kind: 'weighment' | 'breakage'; loss_pct: string; tolerance_pct: string }>(
      `SELECT c.name AS customer, p.name AS product, p.base_uom AS uom, m.kind, m.loss_pct::text AS loss_pct, m.tolerance_pct::text AS tolerance_pct
         FROM fulfilment.delivery_line_measure m
         JOIN fulfilment.trip_stop s ON s.id = m.trip_stop_id
         JOIN commerce.customer_order o ON o.id = s.order_id
         JOIN trading_partners.customer c ON c.id = o.customer_id
         JOIN trading_partners.product p ON p.id = m.product_id
        WHERE s.trip_id = $1 AND NOT m.within_tolerance
        ORDER BY s.sequence_number`,
      [tripId],
    );
    return {
      stops: stops.rows.map((r) => ({ id: r.id, type: r.stop_type, status: r.status, name: r.name, notes: r.notes, hasPod: r.has_pod })),
      load: load.rows.map((r) => ({ product: r.product, uom: r.uom, pickedUp: r.picked_up, delivered: r.delivered, returned: r.returned })),
      unpaidCashCustomers: unpaid.rows,
      expensesNeedingApproval: unapproved.rows[0].total,
      lossExceptions: losses.rows.map((r) => ({
        customer: r.customer,
        product: r.product,
        kind: r.kind,
        lossPct: r.loss_pct,
        tolerancePct: r.tolerance_pct,
      })),
    };
  }

  async findByTripWithClient(client: PoolClient, tripId: string): Promise<TripReconciliationRecord | null> {
    const result = await client.query<TripReconciliationRow>(
      'SELECT * FROM fulfilment.trip_reconciliation WHERE trip_id = $1',
      [tripId],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async createWithClient(
    client: PoolClient,
    reconciledBy: string,
    fields: {
      tripId: string;
      advanceAmount: number;
      totalExpenses: number;
      cashReturned: number;
      spotCash: string;
      cashCollections: string;
      cashDeposited: string;
      directPayments: string;
      cashDeclared: string | null;
      variance: number;
      notes: string | null;
      outcome: ClosureOutcome;
      exceptionNote: string | null;
      checklist: ChecklistItem[];
    },
  ): Promise<TripReconciliationRecord> {
    try {
      const result = await client.query<TripReconciliationRow>(
        `INSERT INTO fulfilment.trip_reconciliation
           (trip_id, advance_amount, total_expenses, cash_returned, variance, notes, reconciled_by, spot_cash,
            cash_collections, cash_deposited, direct_payments, cash_declared, outcome, exception_note, checklist)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING *`,
        [
          fields.tripId,
          fields.advanceAmount,
          fields.totalExpenses,
          fields.cashReturned,
          fields.variance,
          fields.notes,
          reconciledBy,
          fields.spotCash,
          fields.cashCollections,
          fields.cashDeposited,
          fields.directPayments,
          fields.cashDeclared,
          fields.outcome,
          fields.exceptionNote,
          JSON.stringify(fields.checklist),
        ],
      );
      return toRecord(result.rows[0]);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('This trip has already been reconciled');
      }
      throw err;
    }
  }
}

export interface TripReviewFacts {
  stops: { id: string; type: 'pickup' | 'delivery'; status: string; name: string; notes: string | null; hasPod: boolean }[];
  load: { product: string; uom: string; pickedUp: string; delivered: string; returned: string }[];
  unpaidCashCustomers: { customer: string; invoiced: string; collected: string }[];
  /** Expenses recorded beyond the driver's authority (below level 4). */
  expensesNeedingApproval: string;
  /** Shrinkage (live birds) or breakage (eggs) above the owner's tolerance. */
  lossExceptions?: { customer: string; product: string; kind: 'weighment' | 'breakage'; lossPct: string; tolerancePct: string }[];
}
