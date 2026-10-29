import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { isPositiveMoney } from '../../../common/money';
import { CollectionCard, CollectionsView } from '../entities/collections.entity';

interface PaymentRow {
  id: string;
  customer_id: string;
  customer_name: string;
  place: string | null;
  amount: string;
  method: string;
  received_at: Date;
  balance: string;
}

interface DueRow {
  customer_id: string;
  customer_name: string;
  place: string | null;
  due_now: string;
  due_date: string;
  overdue_days: number;
  balance: string;
}

// What every credit customer owes now (open invoices less credit on
// account), and what of it has fallen due by today in the business's own
// timezone. The walk-in customer of spot sales pays on the spot and never
// owes, so it isn't a collection.
const OWED = `
  today AS (SELECT (now() AT TIME ZONE t.timezone)::date AS d, t.timezone FROM tenant.tenant t WHERE t.id = current_tenant_id()),
  credit AS (SELECT customer_id, SUM(unapplied) AS unapplied FROM money.customer_payment_balance GROUP BY customer_id),
  owed AS (
    SELECT c.id AS customer_id,
           COALESCE(SUM(b.outstanding), 0) - COALESCE(MAX(cr.unapplied), 0) AS balance,
           COALESCE(SUM(b.outstanding) FILTER (WHERE b.due_date <= (SELECT d FROM today)), 0) - COALESCE(MAX(cr.unapplied), 0) AS due_now,
           MIN(b.due_date) FILTER (WHERE b.outstanding > 0 AND b.due_date <= (SELECT d FROM today)) AS due_date
    FROM trading_partners.customer c
    LEFT JOIN money.invoice_balance b ON b.customer_id = c.id
    LEFT JOIN credit cr ON cr.customer_id = c.id
    WHERE NOT c.is_walk_in
    GROUP BY c.id
  )`;

const MATCHES = `($1::text IS NULL OR c.name ILIKE '%' || $1 || '%' OR c.place ILIKE '%' || $1 || '%' OR c.contact->>'phone' ILIKE '%' || $1 || '%')`;

const PAYMENTS = `
  FROM money.customer_payment p
  JOIN trading_partners.customer c ON c.id = p.customer_id
  JOIN owed o ON o.customer_id = p.customer_id
  WHERE NOT c.is_walk_in
    AND NOT EXISTS (SELECT 1 FROM money.customer_payment_reversal r WHERE r.payment_id = p.id)`;
const RECEIVED_TODAY = `(p.received_at AT TIME ZONE (SELECT timezone FROM today))::date = (SELECT d FROM today)`;

@Injectable()
export class CollectionsRepository {
  async countsWithClient(client: PoolClient, q: string | null): Promise<{ today: number; pending: number; all: number; collected_today: string; due_now: string }> {
    const r = await client.query(
      `WITH ${OWED}
       SELECT
         (SELECT count(*)::int ${PAYMENTS} AND ${RECEIVED_TODAY} AND ${MATCHES}) AS today,
         (SELECT count(*)::int FROM owed o JOIN trading_partners.customer c ON c.id = o.customer_id WHERE o.due_now > 0 AND ${MATCHES}) AS pending,
         (SELECT count(*)::int ${PAYMENTS} AND ${MATCHES}) AS all,
         (SELECT COALESCE(SUM(p.amount), 0)::numeric(14,2)::text ${PAYMENTS} AND ${RECEIVED_TODAY}) AS collected_today,
         (SELECT COALESCE(SUM(o.due_now) FILTER (WHERE o.due_now > 0), 0)::numeric(14,2)::text FROM owed o) AS due_now`,
      [q],
    );
    return r.rows[0];
  }

  async itemsWithClient(client: PoolClient, view: CollectionsView, q: string | null, limit: number, offset: number): Promise<CollectionCard[]> {
    if (view === 'pending') {
      const r = await client.query<DueRow>(
        `WITH ${OWED}
         SELECT o.customer_id, c.name AS customer_name, c.place, o.due_now::numeric(14,2)::text AS due_now,
                o.due_date::text AS due_date, ((SELECT d FROM today) - o.due_date)::int AS overdue_days,
                o.balance::numeric(14,2)::text AS balance
         FROM owed o JOIN trading_partners.customer c ON c.id = o.customer_id
         WHERE o.due_now > 0 AND ${MATCHES}
         ORDER BY o.due_date, c.name
         LIMIT $2 OFFSET $3`,
        [q, limit, offset],
      );
      return r.rows.map((x) => ({
        kind: 'due',
        id: x.customer_id,
        customerId: x.customer_id,
        customerName: x.customer_name,
        place: x.place,
        amount: x.due_now,
        receivedAt: null,
        method: null,
        dueDate: x.due_date,
        overdueDays: x.overdue_days,
        status: 'pending',
        balance: x.balance,
      }));
    }
    const r = await client.query<PaymentRow>(
      `WITH ${OWED}
       SELECT p.id, p.customer_id, c.name AS customer_name, c.place, p.amount::text AS amount, p.method, p.received_at,
              o.balance::numeric(14,2)::text AS balance
       ${PAYMENTS} AND ${MATCHES} ${view === 'today' ? `AND ${RECEIVED_TODAY}` : ''}
       ORDER BY p.received_at DESC, p.id
       LIMIT $2 OFFSET $3`,
      [q, limit, offset],
    );
    return r.rows.map((x) => ({
      kind: 'payment',
      id: x.id,
      customerId: x.customer_id,
      customerName: x.customer_name,
      place: x.place,
      amount: x.amount,
      receivedAt: x.received_at,
      method: x.method,
      dueDate: null,
      overdueDays: null,
      status: isPositiveMoney(x.balance) ? 'partial' : 'paid',
      balance: x.balance,
    }));
  }
}
