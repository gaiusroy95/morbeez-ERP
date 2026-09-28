/* eslint-disable camelcase */

// Open balances, derived — never stored, so they can't drift from the
// allocations they summarise. security_invoker makes every view run with
// the caller's privileges, so RLS on the underlying tables still scopes
// them to the caller's tenant (a plain view would run as its owner and
// bypass RLS). Requires Postgres 15+.
//
// A reversed customer payment's allocations are excluded: reversing a
// bounced cheque puts the invoices it paid back into the receivable.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE VIEW money.invoice_balance WITH (security_invoker = true) AS
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
  `);

  pgm.sql(`
    CREATE VIEW money.customer_payment_balance WITH (security_invoker = true) AS
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
  `);

  pgm.sql(`
    CREATE VIEW money.farmer_payable_balance WITH (security_invoker = true) AS
    SELECT fp.id AS payable_id, fp.tenant_id, fp.lot_id, fp.farmer_id, fp.amount, fp.accrued_at,
           COALESCE(a.paid, 0)::numeric(12,2) AS paid,
           (fp.amount - COALESCE(a.paid, 0))::numeric(12,2) AS outstanding
    FROM money.farmer_payable fp
    LEFT JOIN (
      SELECT payable_id, SUM(amount) AS paid FROM money.farmer_payment_allocation GROUP BY payable_id
    ) a ON a.payable_id = fp.id
  `);

  pgm.sql(`
    CREATE VIEW money.farmer_payment_balance WITH (security_invoker = true) AS
    SELECT p.id AS payment_id, p.tenant_id, p.farmer_id, p.amount, p.fee_amount, p.method, p.reference, p.paid_at,
           COALESCE(a.applied, 0)::numeric(12,2) AS applied,
           (p.amount - COALESCE(a.applied, 0))::numeric(12,2) AS unapplied
    FROM money.farmer_payment p
    LEFT JOIN (
      SELECT payment_id, SUM(amount) AS applied FROM money.farmer_payment_allocation GROUP BY payment_id
    ) a ON a.payment_id = p.id
  `);

  // Views are writable-through in principle; the app only ever reads them.
  for (const view of ['invoice_balance', 'customer_payment_balance', 'farmer_payable_balance', 'farmer_payment_balance']) {
    pgm.sql(`REVOKE INSERT, UPDATE, DELETE ON money.${view} FROM morbeez_app`);
  }
};

exports.down = (pgm) => {
  pgm.sql('DROP VIEW money.farmer_payment_balance');
  pgm.sql('DROP VIEW money.farmer_payable_balance');
  pgm.sql('DROP VIEW money.customer_payment_balance');
  pgm.sql('DROP VIEW money.invoice_balance');
};
