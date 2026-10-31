import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { formatOrderNumber, formatPurchaseOrderNumber } from '../../../common/persistence/document-number';
import { ApprovalsInbox, InboxItem } from '../entities/dashboard.entity';

const EXPENSE_LABEL: Record<string, string> = { fuel: 'Fuel', toll: 'Toll', parking: 'Parking', labour: 'Loading labour', repair: 'Repair', other: 'Other' };

/** Who asked: their worker name when the login is a worker's, else the login itself. */
const REQUESTER = (user: string) => `
  COALESCE((SELECT e.name FROM trading_partners.employee e WHERE e.user_id = ${user} ORDER BY e.created_at LIMIT 1),
           (SELECT COALESCE(u.phone, u.email) FROM identity.app_user u WHERE u.id = ${user}))`;

/**
 * The Approvals & Exceptions inbox (owner app redesign Phase 7, screen
 * 17): everything waiting for the owner, wherever it was raised. Read
 * across contexts like the rest of the dashboard read model (DB.4); each
 * decision itself goes through its own module's endpoint.
 */
@Injectable()
export class ApprovalsInboxRepository {
  async inboxWithClient(client: PoolClient): Promise<ApprovalsInbox> {
    const items: InboxItem[] = [];

    // A driver's expense beyond their authority, on a trip not yet closed.
    const expenses = await client.query<{
      id: string; trip_id: string; number: string; category: string; amount: string; notes: string | null; at: Date; driver: string;
    }>(
      `SELECT x.id, x.trip_id, t.number, x.category, x.amount::text AS amount, x.notes, x.recorded_at AS at, d.name AS driver
         FROM fulfilment.trip_expense x
         JOIN fulfilment.trip t ON t.id = x.trip_id
         JOIN trading_partners.employee d ON d.id = t.driver_employee_id
        WHERE x.needs_approval AND x.decision IS NULL AND t.status NOT IN ('reconciled', 'cancelled')`,
    );
    for (const x of expenses.rows) {
      items.push({
        key: `expense:${x.id}`,
        kind: 'expense',
        tab: 'expense',
        subject: `${EXPENSE_LABEL[x.category] ?? x.category} — ${x.driver}`,
        detail: [x.number, x.notes].filter(Boolean).join(' · '),
        amount: x.amount,
        at: x.at,
        by: x.driver,
        refs: { tripId: x.trip_id, expenseId: x.id },
      });
    }

    // Approval requests still pending, whose purchase order, order or spot sale still waits on them.
    const requests = await client.query<{
      id: string; action_type: string; subject_id: string; amount: string | null; at: Date; version: number; by: string | null;
      po_number: number | null; farmer: string | null; order_number: number | null; customer: string | null;
      sale_number: string | null; buyer: string | null; spot_lines: string | null;
    }>(
      `SELECT ar.id, ar.action_type, ar.subject_id, ar.amount::text AS amount, ar.created_at AS at, ar.version,
              ${REQUESTER('ar.requested_by')} AS by,
              po.number AS po_number, f.name AS farmer, o.number AS order_number, c.name AS customer,
              s.sale_number, s.buyer_name AS buyer,
              (SELECT string_agg(p.name || ' at ₹' || sl.unit_price::text, ', ' ORDER BY p.name)
                 FROM spot.spot_sale_line sl JOIN trading_partners.product p ON p.id = sl.product_id WHERE sl.sale_id = s.id) AS spot_lines
         FROM approvals.approval_request ar
         LEFT JOIN commerce.purchase_order po ON ar.action_type = 'purchase_order' AND po.id = ar.subject_id AND po.approval_request_id = ar.id
         LEFT JOIN trading_partners.farmer f ON f.id = po.farmer_id
         LEFT JOIN commerce.customer_order o ON ar.action_type = 'customer_order' AND o.id = ar.subject_id AND o.approval_request_id = ar.id
         LEFT JOIN trading_partners.customer c ON c.id = o.customer_id
         LEFT JOIN spot.spot_sale s ON ar.action_type = 'spot_sale_price' AND s.id = ar.subject_id AND s.status = 'pending_approval'
        WHERE ar.status = 'pending'`,
    );
    for (const r of requests.rows) {
      const refs = { approvalRequestId: r.id, approvalVersion: r.version };
      if (r.action_type === 'purchase_order' && r.po_number !== null) {
        items.push({
          key: `approval:${r.id}`,
          kind: 'purchase_order',
          tab: 'other',
          subject: `${formatPurchaseOrderNumber(r.po_number)} · ${r.farmer ?? ''}`.trim(),
          detail: null,
          amount: r.amount,
          at: r.at,
          by: r.by,
          refs: { ...refs, purchaseOrderId: r.subject_id },
        });
      } else if (r.action_type === 'customer_order' && r.order_number !== null) {
        items.push({
          key: `approval:${r.id}`,
          kind: 'customer_order',
          tab: 'other',
          subject: `${formatOrderNumber(r.order_number)} · ${r.customer ?? ''}`.trim(),
          detail: null,
          amount: r.amount,
          at: r.at,
          by: r.by,
          refs: { ...refs, orderId: r.subject_id },
        });
      } else if (r.action_type === 'spot_sale_price' && r.sale_number !== null) {
        items.push({
          key: `approval:${r.id}`,
          kind: 'spot_price',
          tab: 'price',
          subject: `${r.sale_number}${r.buyer ? ` · ${r.buyer}` : ''}`,
          detail: r.spot_lines,
          amount: r.amount,
          at: r.at,
          by: r.by,
          refs: { ...refs, spotSaleId: r.subject_id },
        });
      }
    }

    // AI suggestions nobody has decided yet (pricing ones are price changes).
    const suggestions = await client.query<{ id: string; type: string; title: string; impact: string | null; at: Date }>(
      `SELECT r.id, r.type, r.title, r.expected_impact::text AS impact, r.created_at AS at
         FROM ai.recommendation r
        WHERE r.expires_at > now() AND NOT EXISTS (SELECT 1 FROM ai.recommendation_decision d WHERE d.recommendation_id = r.id)`,
    );
    for (const s of suggestions.rows) {
      items.push({
        key: `ai:${s.id}`,
        kind: 'ai',
        tab: s.type === 'pricing' ? 'price' : 'other',
        subject: s.title,
        detail: null,
        amount: s.impact,
        at: s.at,
        by: null,
        refs: { recommendationId: s.id },
      });
    }

    // Invoice disputes still open.
    const disputes = await client.query<{ id: string; customer_id: string; customer: string; invoice: string; amount: string; reason: string; at: Date; by: string | null }>(
      `SELECT d.id, d.customer_id, c.name AS customer, i.invoice_number AS invoice, d.amount::text AS amount, d.reason, d.raised_at AS at,
              ${REQUESTER('d.raised_by')} AS by
         FROM money.invoice_dispute d
         JOIN trading_partners.customer c ON c.id = d.customer_id
         JOIN money.invoice i ON i.id = d.invoice_id
        WHERE d.status = 'open'`,
    );
    for (const d of disputes.rows) {
      items.push({
        key: `dispute:${d.id}`,
        kind: 'dispute',
        tab: 'other',
        subject: `${d.customer} · ${d.invoice}`,
        detail: d.reason,
        amount: d.amount,
        at: d.at,
        by: d.by,
        refs: { disputeId: d.id, customerId: d.customer_id },
      });
    }

    // What drivers asked for from the road (D10): an advance, a new customer, a credit limit.
    const driverRequests = await client.query<{
      id: string; kind: string; amount: string | null; reason: string; at: Date; driver: string; customer: string | null; new_name: string | null; trip_id: string | null; current: string | null;
    }>(
      `SELECT r.id, r.kind, r.amount::text AS amount, r.reason, r.requested_at AS at, d.name AS driver, c.name AS customer,
              r.details->>'name' AS new_name, r.trip_id, c.credit_limit::text AS current
         FROM fulfilment.driver_request r
         JOIN trading_partners.employee d ON d.id = r.driver_employee_id
         LEFT JOIN trading_partners.customer c ON c.id = r.customer_id
        WHERE r.status = 'pending'`,
    );
    for (const r of driverRequests.rows) {
      const inr = (v: string) => `₹${Number(v).toLocaleString('en-IN')}`;
      items.push({
        key: `driver_request:${r.id}`,
        kind: 'driver_request',
        tab: r.kind === 'advance' ? 'expense' : 'other',
        subject:
          r.kind === 'advance'
            ? `Advance — ${r.driver}`
            : r.kind === 'new_customer'
              ? `New customer: ${r.new_name ?? ''} — ${r.driver}`
              : `Credit limit: ${r.customer ?? ''} ${inr(r.current ?? '0')} → ${inr(r.amount ?? '0')} — ${r.driver}`,
        detail: r.reason,
        amount: r.kind === 'new_customer' ? null : r.amount,
        at: r.at,
        by: r.driver,
        refs: { driverRequestId: r.id, requestKind: r.kind, ...(r.trip_id && { tripId: r.trip_id }) },
      });
    }

    // Trips handed over (or on hold), waiting for the owner to close them.
    const trips = await client.query<{ id: string; number: string; status: string; at: Date; driver: string; declared: string | null }>(
      `SELECT t.id, t.number, t.status, COALESCE(t.completed_at, t.updated_at) AS at, d.name AS driver, t.cash_declared::text AS declared
         FROM fulfilment.trip t JOIN trading_partners.employee d ON d.id = t.driver_employee_id
        WHERE t.status IN ('completed', 'on_hold')`,
    );
    for (const t of trips.rows) {
      items.push({
        key: `trip:${t.id}`,
        kind: 'trip_close',
        tab: 'other',
        subject: `${t.number} — ${t.driver}`,
        detail: t.status === 'on_hold' ? 'On hold' : null,
        amount: t.declared,
        at: t.at,
        by: t.driver,
        refs: { tripId: t.id },
      });
    }

    items.sort((a, b) => b.at.getTime() - a.at.getTime());
    const count = (tab: InboxItem['tab']) => items.filter((i) => i.tab === tab).length;
    return { counts: { all: items.length, expense: count('expense'), price: count('price'), other: count('other') }, items };
  }
}
