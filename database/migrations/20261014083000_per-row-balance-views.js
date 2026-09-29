/* eslint-disable camelcase */

// Balances summed per row instead of across the whole tenant (Performance
// Audit PA-05).
//
// Both views used to join a subquery that grouped *every* payment
// allocation the tenant ever made, and the planner can't push a
// customer_id filter into a grouped subquery — so one customer's credit
// check (run on every order) cost as much as the whole receivables book.
// A LATERAL sum per invoice / per payment uses the (invoice_id) and
// (payment_id) indexes and costs only that customer's rows. Same columns,
// same order, so CREATE OR REPLACE keeps the grants and every caller.

const INVOICE_BALANCE_PER_ROW = `
  CREATE OR REPLACE VIEW money.invoice_balance WITH (security_invoker = true) AS
  SELECT i.id AS invoice_id, i.tenant_id, i.customer_id, i.kind, i.invoice_number, i.order_id,
         i.source_invoice_id, i.issued_at, i.due_date, i.amount,
         COALESCE(a.paid, 0)::numeric(12,2) AS paid,
         (i.amount - COALESCE(a.paid, 0))::numeric(12,2) AS outstanding
  FROM money.invoice i
  LEFT JOIN LATERAL (
    SELECT SUM(pa.amount) AS paid
    FROM money.customer_payment_allocation pa
    WHERE pa.invoice_id = i.id
      AND NOT EXISTS (SELECT 1 FROM money.customer_payment_reversal r WHERE r.payment_id = pa.payment_id)
  ) a ON true
`;

const PAYMENT_BALANCE_PER_ROW = `
  CREATE OR REPLACE VIEW money.customer_payment_balance WITH (security_invoker = true) AS
  SELECT p.id AS payment_id, p.tenant_id, p.customer_id, p.amount, p.fee_amount, p.method, p.reference,
         p.received_at, p.collection_id,
         r.reversed_at,
         COALESCE(a.applied, 0)::numeric(12,2) AS applied,
         CASE WHEN r.id IS NULL THEN (p.amount - COALESCE(a.applied, 0)) ELSE 0 END::numeric(12,2) AS unapplied
  FROM money.customer_payment p
  LEFT JOIN money.customer_payment_reversal r ON r.payment_id = p.id
  LEFT JOIN LATERAL (
    SELECT SUM(pa.amount) AS applied FROM money.customer_payment_allocation pa WHERE pa.payment_id = p.id
  ) a ON true
`;

const INVOICE_BALANCE_GROUPED = `
  CREATE OR REPLACE VIEW money.invoice_balance WITH (security_invoker = true) AS
  SELECT i.id AS invoice_id, i.tenant_id, i.customer_id, i.kind, i.invoice_number, i.order_id,
         i.source_invoice_id, i.issued_at, i.due_date, i.amount,
         COALESCE(a.paid, 0)::numeric(12,2) AS paid,
         (i.amount - COALESCE(a.paid, 0))::numeric(12,2) AS outstanding
  FROM money.invoice i
  LEFT JOIN (
    SELECT pa.invoice_id, SUM(pa.amount) AS paid
    FROM money.customer_payment_allocation pa
    WHERE NOT EXISTS (SELECT 1 FROM money.customer_payment_reversal r WHERE r.payment_id = pa.payment_id)
    GROUP BY pa.invoice_id
  ) a ON a.invoice_id = i.id
`;

const PAYMENT_BALANCE_GROUPED = `
  CREATE OR REPLACE VIEW money.customer_payment_balance WITH (security_invoker = true) AS
  SELECT p.id AS payment_id, p.tenant_id, p.customer_id, p.amount, p.fee_amount, p.method, p.reference,
         p.received_at, p.collection_id,
         r.reversed_at,
         COALESCE(a.applied, 0)::numeric(12,2) AS applied,
         CASE WHEN r.id IS NULL THEN (p.amount - COALESCE(a.applied, 0)) ELSE 0 END::numeric(12,2) AS unapplied
  FROM money.customer_payment p
  LEFT JOIN money.customer_payment_reversal r ON r.payment_id = p.id
  LEFT JOIN (
    SELECT payment_id, SUM(amount) AS applied FROM money.customer_payment_allocation GROUP BY payment_id
  ) a ON a.payment_id = p.id
`;

exports.up = (pgm) => {
  pgm.sql(INVOICE_BALANCE_PER_ROW);
  pgm.sql(PAYMENT_BALANCE_PER_ROW);
};

exports.down = (pgm) => {
  pgm.sql(PAYMENT_BALANCE_GROUPED);
  pgm.sql(INVOICE_BALANCE_GROUPED);
};
