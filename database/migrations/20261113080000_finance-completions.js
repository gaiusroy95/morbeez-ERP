/* eslint-disable camelcase */

// Master Spec v3 P6 — finance completions (docs/redesign/master-spec-v3-plan.md,
// rules F1–F8; Accounting Engine CN, BD, AGT, FC; Master Spec §11–12, §30–32).
//
// 1. Credit notes (CN.1–CN.4): money.credit_note (CN-000001) against one
//    invoice, never editing it, with credit_note_line — each invoice line's
//    share of it, GST included, which is what GSTR-1 reports. An accepted
//    dispute issues one; the owner can issue one directly.
// 2. Dispute finance (MS §32): a closed dispute keeps the amount accepted. A
//    finance-charge run that leaves a disputed amount out records it
//    (finance_charge_pause); once the pause ends — rejected, withdrawn,
//    partly accepted, or untouched for 30 days — the next run charges what
//    was left out, once (finance_charge.dispute_id, finance_charge_catch_up).
// 3. Bad debts (BD.1, BD.2, BD.4): money.receivable_write_off, never automatic.
// 4. Agent commission (AGT.1–AGT.3): accounts agent_commission and
//    accounts_payable_agent, the 'agent' ledger party, money.agent_commission
//    (one per graded lot, its kg and rate), money.agent_payment (TDS withheld
//    when a section is chosen — 194H joins the default sections), the agent's PAN.
// 5. Customer finance charge on/off (on where a rate was already set); the
//    internal cost of capital defaults to 18% a year (MS §31).
// 6. Credit terms as dated versions (trading_partners.customer_terms_version).
// 7. Farmer payment terms (MS §12) and each payable's due date.
// 8. Customer Bill-to-Bill (MS §30). A Bill-to-Bill invoice (or payable) falls
//    due when the next one is issued, or at its backstop date — issue date +
//    the terms' days — if that comes first.
//
// invoice_balance nets credit notes and write-offs off what's outstanding and
// reads a Bill-to-Bill due date; farmer_payable_balance gains the due date.
// FORCE ROW LEVEL SECURITY hides every row from a non-superuser owner (Neon,
// RDS), so it's lifted around each backfill and restored after.

exports.shorthands = undefined;

const tenantColumn = { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' };
const userColumn = { type: 'uuid', references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' };
const ref = (schema, name) => ({ type: 'uuid', notNull: true, references: { schema, name }, onDelete: 'RESTRICT' });
const entryColumn = { type: 'uuid', references: { schema: 'money', name: 'ledger_entry' }, onDelete: 'RESTRICT' };
const money = (extra = {}) => ({ type: 'numeric(12,2)', notNull: true, ...extra });
const PAN = "'^[A-Z]{5}[0-9]{4}[A-Z]$'";
const NET_DAYS = [3, 7, 10, 15, 20, 30, 45, 60];

const NEW_TABLES = [
  // [schema, table, parent table, this row's column pointing at it]
  ['money', 'credit_note', 'money.invoice', 'invoice_id'],
  ['money', 'credit_note_line', 'money.credit_note', 'credit_note_id'],
  ['money', 'receivable_write_off', 'money.invoice', 'invoice_id'],
  ['money', 'finance_charge_pause', 'money.finance_charge', 'charge_id'],
  ['money', 'finance_charge_catch_up', 'money.finance_charge', 'catch_up_charge_id'],
  ['money', 'agent_commission', 'commerce.lot', 'lot_id'],
  ['money', 'agent_payment', 'trading_partners.agent', 'agent_id'],
  ['trading_partners', 'customer_terms_version', 'trading_partners.customer', 'customer_id'],
];

/** RLS like every tenant table, insert-only for the app, and a trigger that takes the parent's tenant and refuses a foreign parent. */
function isolate(pgm, [schema, table, parent, parentCol]) {
  pgm.sql(`
    CREATE TRIGGER ${table}_tenant BEFORE INSERT OR UPDATE OF tenant_id, ${parentCol} ON ${schema}.${table}
      FOR EACH ROW EXECUTE FUNCTION tenant.inherit_tenant_id('${parent}', '${parentCol}')
  `);
  pgm.sql(`ALTER TABLE ${schema}.${table} ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE ${schema}.${table} FORCE ROW LEVEL SECURITY`);
  pgm.sql(`CREATE POLICY ${table}_tenant_isolation ON ${schema}.${table} USING (tenant_id = current_tenant_id())`);
  pgm.sql(`REVOKE UPDATE, DELETE ON ${schema}.${table} FROM morbeez_app`);
}

const OLD_INVOICE_BALANCE = `
  CREATE VIEW money.invoice_balance WITH (security_invoker = true) AS
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

// Same columns in the same order, then the new ones: CREATE OR REPLACE keeps every caller.
const INVOICE_BALANCE = `
  CREATE OR REPLACE VIEW money.invoice_balance WITH (security_invoker = true) AS
  SELECT i.id AS invoice_id, i.tenant_id, i.customer_id, i.kind, i.invoice_number, i.order_id,
         i.source_invoice_id, i.issued_at,
         CASE WHEN i.bill_to_bill THEN LEAST(i.due_date, (
           SELECT (n.issued_at AT TIME ZONE t.timezone)::date
             FROM money.invoice n JOIN tenant.tenant t ON t.id = n.tenant_id
            WHERE n.customer_id = i.customer_id AND n.kind = 'sale'
              AND (n.issued_at, n.invoice_number) > (i.issued_at, i.invoice_number)
            ORDER BY n.issued_at, n.invoice_number
            LIMIT 1))
         ELSE i.due_date END AS due_date,
         i.amount,
         COALESCE(a.paid, 0)::numeric(12,2) AS paid,
         (i.amount - COALESCE(a.paid, 0) - COALESCE(cn.credited, 0) - COALESCE(w.written_off, 0))::numeric(12,2) AS outstanding,
         COALESCE(cn.credited, 0)::numeric(12,2) AS credited,
         COALESCE(w.written_off, 0)::numeric(12,2) AS written_off,
         i.bill_to_bill, i.created_by
  FROM money.invoice i
  LEFT JOIN LATERAL (
    SELECT SUM(pa.amount) AS paid
    FROM money.customer_payment_allocation pa
    WHERE pa.invoice_id = i.id
      AND NOT EXISTS (SELECT 1 FROM money.customer_payment_reversal r WHERE r.payment_id = pa.payment_id)
  ) a ON true
  LEFT JOIN LATERAL (SELECT SUM(c.amount) AS credited FROM money.credit_note c WHERE c.invoice_id = i.id) cn ON true
  LEFT JOIN LATERAL (SELECT SUM(x.amount) AS written_off FROM money.receivable_write_off x WHERE x.invoice_id = i.id) w ON true
`;

const PAYABLE_COLUMNS = `
  SELECT fp.id AS payable_id, fp.tenant_id, fp.lot_id, fp.farmer_id, fp.amount, fp.accrued_at,
         COALESCE(a.paid, 0)::numeric(12,2) AS paid,
         (fp.amount - COALESCE(a.paid, 0) - COALESCE(t.withheld, 0) - COALESCE(d.deducted, 0))::numeric(12,2) AS outstanding,
         COALESCE(t.withheld, 0)::numeric(12,2) AS tds_withheld,
         COALESCE(d.deducted, 0)::numeric(12,2) AS crate_deducted`;
const PAYABLE_FROM = `
  FROM money.farmer_payable fp
  LEFT JOIN (
    SELECT payable_id, SUM(amount) AS paid FROM money.farmer_payment_allocation GROUP BY payable_id
  ) a ON a.payable_id = fp.id
  LEFT JOIN (
    SELECT payable_id, SUM(tds_amount) AS withheld FROM tax.tds_deduction WHERE payable_id IS NOT NULL GROUP BY payable_id
  ) t ON t.payable_id = fp.id
  LEFT JOIN (
    SELECT payable_id, SUM(amount) AS deducted FROM crates.payable_deduction GROUP BY payable_id
  ) d ON d.payable_id = fp.id`;
const OLD_PAYABLE_BALANCE = `CREATE VIEW money.farmer_payable_balance WITH (security_invoker = true) AS ${PAYABLE_COLUMNS} ${PAYABLE_FROM}`;
const PAYABLE_BALANCE = `
  CREATE OR REPLACE VIEW money.farmer_payable_balance WITH (security_invoker = true) AS ${PAYABLE_COLUMNS},
         CASE WHEN fp.bill_to_bill THEN LEAST(fp.due_date, (
           SELECT (n.accrued_at AT TIME ZONE t2.timezone)::date
             FROM money.farmer_payable n JOIN tenant.tenant t2 ON t2.id = n.tenant_id
            WHERE n.farmer_id = fp.farmer_id AND (n.accrued_at, n.id) > (fp.accrued_at, fp.id)
            ORDER BY n.accrued_at, n.id
            LIMIT 1))
         ELSE fp.due_date END AS due_date
  ${PAYABLE_FROM}`;

const OLD_FINANCE_CHARGE_CHECK = `period_end > period_start AND days = period_end - period_start AND principal > 0 AND amount > 0
  AND ((rate_monthly_percent IS NOT NULL AND rate_monthly_percent > 0) <> (rate_annual_percent IS NOT NULL AND rate_annual_percent > 0))`;
// A catch-up gathers the paused periods it charges for, which needn't touch:
// its days are their sum, never more than the span from the first to the last.
const FINANCE_CHARGE_CHECK = `period_end > period_start AND principal > 0 AND amount > 0
  AND ((rate_monthly_percent IS NOT NULL AND rate_monthly_percent > 0) <> (rate_annual_percent IS NOT NULL AND rate_annual_percent > 0))
  AND (days = period_end - period_start OR (dispute_id IS NOT NULL AND days BETWEEN 1 AND period_end - period_start))`;

const OLD_COUNTER_KINDS = "('sale', 'finance_charge', 'crate_charge', 'spot_sale')";
const COUNTER_KINDS = "('sale', 'finance_charge', 'crate_charge', 'spot_sale', 'credit_note')";

exports.up = (pgm) => {
  // ---- 4. Agent accounts and the agent ledger party ----
  pgm.sql(`
    INSERT INTO money.ledger_account (code, name, root_type, number, report_group, is_system, is_control) VALUES
      ('accounts_payable_agent', 'Accounts payable — agents', 'liability', 2010, 'current_liability', true, true),
      ('agent_commission', 'Agent commission', 'expense', 5200, 'cost_of_sales', true, false)
    ON CONFLICT (code) DO NOTHING
  `);
  pgm.sql('SELECT money.install_chart_of_accounts(id) FROM tenant.tenant');
  pgm.dropConstraint({ schema: 'money', name: 'ledger_line' }, 'ledger_line_party_valid');
  pgm.addConstraint({ schema: 'money', name: 'ledger_line' }, 'ledger_line_party_valid', {
    check: "(party_type IS NULL) = (party_id IS NULL) AND (party_type IS NULL OR party_type IN ('customer', 'farmer', 'agent'))",
  });

  // ---- 5, 6, 8. Customer terms ----
  pgm.addColumns({ schema: 'trading_partners', name: 'customer' }, {
    finance_charge_enabled: { type: 'boolean', notNull: true, default: false },
    bill_to_bill: { type: 'boolean', notNull: true, default: false },
  });
  pgm.addConstraint({ schema: 'trading_partners', name: 'customer' }, 'customer_bill_to_bill_backstop', {
    check: 'NOT bill_to_bill OR payment_terms_days >= 1',
  });
  pgm.addColumns({ schema: 'money', name: 'invoice' }, { bill_to_bill: { type: 'boolean', notNull: true, default: false } });
  pgm.addConstraint({ schema: 'money', name: 'invoice' }, 'invoice_bill_to_bill_is_a_sale', { check: "NOT bill_to_bill OR kind = 'sale'" });
  pgm.createIndex({ schema: 'money', name: 'invoice' }, ['customer_id', 'issued_at']);

  pgm.createTable({ schema: 'trading_partners', name: 'customer_terms_version' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    customer_id: ref('trading_partners', 'customer'),
    // The customer's row version these terms came in with.
    version: { type: 'integer', notNull: true },
    credit_limit: money(),
    payment_terms_days: { type: 'integer', notNull: true },
    bill_to_bill: { type: 'boolean', notNull: true },
    finance_charge_enabled: { type: 'boolean', notNull: true },
    finance_charge_rate_annual: { type: 'numeric(6,2)', notNull: true },
    finance_charge_grace_days: { type: 'integer', notNull: true },
    credit_hold: { type: 'boolean', notNull: true },
    credit_hold_reason: { type: 'text' },
    // What brought the change: 'created', 'terms', 'write_off', 'initial' (the terms in force when versions began).
    source: { type: 'text', notNull: true },
    effective_from: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    changed_by: userColumn,
  });
  pgm.addConstraint({ schema: 'trading_partners', name: 'customer_terms_version' }, 'customer_terms_version_valid', {
    check: "source IN ('initial', 'created', 'terms', 'write_off') AND (source = 'initial' OR changed_by IS NOT NULL)",
  });
  pgm.addConstraint({ schema: 'trading_partners', name: 'customer_terms_version' }, 'customer_terms_version_once', {
    unique: ['customer_id', 'version'],
  });
  pgm.createIndex({ schema: 'trading_partners', name: 'customer_terms_version' }, ['tenant_id', 'customer_id', 'effective_from']);
  isolate(pgm, NEW_TABLES[7]);

  pgm.sql('ALTER TABLE trading_partners.customer NO FORCE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE trading_partners.customer_terms_version NO FORCE ROW LEVEL SECURITY');
  // Off by default; on for a customer whose terms already carried a rate (MS §30).
  pgm.sql('UPDATE trading_partners.customer SET finance_charge_enabled = true WHERE finance_charge_rate_annual > 0');
  pgm.sql(`
    INSERT INTO trading_partners.customer_terms_version
      (tenant_id, customer_id, version, credit_limit, payment_terms_days, bill_to_bill, finance_charge_enabled,
       finance_charge_rate_annual, finance_charge_grace_days, credit_hold, credit_hold_reason, source, effective_from)
    SELECT tenant_id, id, version, credit_limit, payment_terms_days, bill_to_bill, finance_charge_enabled,
           finance_charge_rate_annual, finance_charge_grace_days, credit_hold, credit_hold_reason, 'initial', updated_at
      FROM trading_partners.customer
  `);
  pgm.sql('ALTER TABLE trading_partners.customer_terms_version FORCE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE trading_partners.customer FORCE ROW LEVEL SECURITY');

  // ---- 1. Credit notes ----
  pgm.createTable({ schema: 'money', name: 'credit_note' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    credit_note_number: { type: 'text', notNull: true },
    invoice_id: ref('money', 'invoice'),
    customer_id: ref('trading_partners', 'customer'),
    // The dispute whose accepted amount it is; null when issued directly.
    dispute_id: { type: 'uuid', references: { schema: 'money', name: 'invoice_dispute' }, onDelete: 'RESTRICT' },
    reason: { type: 'text', notNull: true },
    taxable_value: money(),
    cgst: money({ default: 0 }),
    sgst: money({ default: 0 }),
    igst: money({ default: 0 }),
    cess: money({ default: 0 }),
    amount: money(),
    issued_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    issued_by: { ...userColumn, notNull: true },
    ledger_entry_id: entryColumn,
  });
  pgm.addConstraint({ schema: 'money', name: 'credit_note' }, 'credit_note_valid', {
    check: `amount > 0 AND taxable_value >= 0 AND cgst >= 0 AND sgst >= 0 AND igst >= 0 AND cess >= 0
            AND amount = taxable_value + cgst + sgst + igst + cess AND length(btrim(reason)) >= 3`,
  });
  pgm.addConstraint({ schema: 'money', name: 'credit_note' }, 'credit_note_number_unique', { unique: ['tenant_id', 'credit_note_number'] });
  pgm.addConstraint({ schema: 'money', name: 'credit_note' }, 'credit_note_one_per_dispute', { unique: ['dispute_id'] });
  pgm.createIndex({ schema: 'money', name: 'credit_note' }, ['tenant_id', 'invoice_id']);
  pgm.createIndex({ schema: 'money', name: 'credit_note' }, ['tenant_id', 'issued_at']);
  pgm.createIndex({ schema: 'money', name: 'credit_note' }, ['tenant_id', 'customer_id']);
  isolate(pgm, NEW_TABLES[0]);

  pgm.createTable({ schema: 'money', name: 'credit_note_line' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    credit_note_id: ref('money', 'credit_note'),
    invoice_line_id: ref('money', 'invoice_line'),
    taxable_value: money(),
    cgst: money({ default: 0 }),
    sgst: money({ default: 0 }),
    igst: money({ default: 0 }),
    cess: money({ default: 0 }),
  });
  pgm.addConstraint({ schema: 'money', name: 'credit_note_line' }, 'credit_note_line_valid', {
    check: 'taxable_value >= 0 AND cgst >= 0 AND sgst >= 0 AND igst >= 0 AND cess >= 0 AND taxable_value + cgst + sgst + igst + cess > 0',
  });
  pgm.addConstraint({ schema: 'money', name: 'credit_note_line' }, 'credit_note_line_once', { unique: ['credit_note_id', 'invoice_line_id'] });
  pgm.createIndex({ schema: 'money', name: 'credit_note_line' }, ['tenant_id', 'credit_note_id']);
  pgm.createIndex({ schema: 'money', name: 'credit_note_line' }, ['tenant_id', 'invoice_line_id']);
  isolate(pgm, NEW_TABLES[1]);

  pgm.sql('ALTER TABLE money.invoice_counter DROP CONSTRAINT invoice_counter_kind_valid');
  pgm.sql(`ALTER TABLE money.invoice_counter ADD CONSTRAINT invoice_counter_kind_valid CHECK (kind IN ${COUNTER_KINDS})`);

  // ---- 3. Bad debts ----
  pgm.createTable({ schema: 'money', name: 'receivable_write_off' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    invoice_id: ref('money', 'invoice'),
    customer_id: ref('trading_partners', 'customer'),
    amount: money(),
    reason: { type: 'text', notNull: true },
    written_off_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    written_off_by: { ...userColumn, notNull: true },
    // BD.1 then BD.2: the provision (Dr Bad debts / Cr Allowance), then the write-off (Dr Allowance / Cr Receivable).
    provision_entry_id: entryColumn,
    ledger_entry_id: entryColumn,
  });
  pgm.addConstraint({ schema: 'money', name: 'receivable_write_off' }, 'receivable_write_off_valid', {
    check: 'amount > 0 AND length(btrim(reason)) >= 3',
  });
  pgm.addConstraint({ schema: 'money', name: 'receivable_write_off' }, 'receivable_write_off_once', { unique: ['invoice_id'] });
  pgm.createIndex({ schema: 'money', name: 'receivable_write_off' }, ['tenant_id', 'customer_id']);
  isolate(pgm, NEW_TABLES[2]);

  pgm.sql(INVOICE_BALANCE);

  // ---- 2. Dispute finance ----
  pgm.addColumns({ schema: 'money', name: 'invoice_dispute' }, { accepted_amount: { type: 'numeric(12,2)' } });
  pgm.sql('ALTER TABLE money.invoice_dispute NO FORCE ROW LEVEL SECURITY');
  // Disputes closed before this recorded only words, and moved no money: nothing was accepted.
  pgm.sql("UPDATE money.invoice_dispute SET accepted_amount = 0 WHERE status <> 'open'");
  pgm.sql('ALTER TABLE money.invoice_dispute FORCE ROW LEVEL SECURITY');
  pgm.addConstraint({ schema: 'money', name: 'invoice_dispute' }, 'invoice_dispute_settlement_valid', {
    check: "(status = 'open') = (accepted_amount IS NULL) AND (accepted_amount IS NULL OR (accepted_amount >= 0 AND accepted_amount <= amount)) AND (status <> 'withdrawn' OR accepted_amount = 0)",
  });

  pgm.addColumns({ schema: 'money', name: 'finance_charge' }, {
    dispute_id: { type: 'uuid', references: { schema: 'money', name: 'invoice_dispute' }, onDelete: 'RESTRICT' },
  });
  pgm.dropConstraint({ schema: 'money', name: 'finance_charge' }, 'finance_charge_values_valid');
  pgm.addConstraint({ schema: 'money', name: 'finance_charge' }, 'finance_charge_values_valid', { check: FINANCE_CHARGE_CHECK });
  pgm.dropConstraint({ schema: 'money', name: 'finance_charge' }, 'finance_charge_period_once');
  pgm.sql('CREATE UNIQUE INDEX finance_charge_period_once ON money.finance_charge (source_invoice_id, period_end) WHERE dispute_id IS NULL');
  pgm.createIndex({ schema: 'money', name: 'finance_charge' }, ['tenant_id', 'dispute_id'], { where: 'dispute_id IS NOT NULL' });

  pgm.createTable({ schema: 'money', name: 'finance_charge_pause' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    charge_id: ref('money', 'finance_charge'),
    dispute_id: ref('money', 'invoice_dispute'),
    amount: money(),
  });
  pgm.addConstraint({ schema: 'money', name: 'finance_charge_pause' }, 'finance_charge_pause_valid', { check: 'amount > 0' });
  pgm.addConstraint({ schema: 'money', name: 'finance_charge_pause' }, 'finance_charge_pause_once', { unique: ['charge_id', 'dispute_id'] });
  pgm.createIndex({ schema: 'money', name: 'finance_charge_pause' }, ['tenant_id', 'dispute_id']);
  isolate(pgm, NEW_TABLES[3]);

  pgm.createTable({ schema: 'money', name: 'finance_charge_catch_up' }, {
    pause_id: { type: 'uuid', primaryKey: true, references: { schema: 'money', name: 'finance_charge_pause' }, onDelete: 'RESTRICT' },
    tenant_id: tenantColumn,
    catch_up_charge_id: ref('money', 'finance_charge'),
  });
  pgm.createIndex({ schema: 'money', name: 'finance_charge_catch_up' }, ['tenant_id', 'catch_up_charge_id']);
  isolate(pgm, NEW_TABLES[4]);

  // ---- 4. Agent commission ----
  pgm.addColumns({ schema: 'trading_partners', name: 'agent' }, { pan: { type: 'text' } });
  pgm.addConstraint({ schema: 'trading_partners', name: 'agent' }, 'agent_pan_format', { check: `pan IS NULL OR pan ~ ${PAN}` });

  pgm.createTable({ schema: 'money', name: 'agent_commission' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    agent_id: ref('trading_partners', 'agent'),
    lot_id: ref('commerce', 'lot'),
    purchase_order_id: ref('commerce', 'purchase_order'),
    // AGT.3: the kg and the rate that produced it.
    accepted_kg: { type: 'numeric(14,3)', notNull: true },
    rate_per_kg: { type: 'numeric(10,2)', notNull: true },
    amount: money(),
    accrued_at: { type: 'timestamptz', notNull: true },
    ledger_entry_id: entryColumn,
    created_by: { ...userColumn, notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint({ schema: 'money', name: 'agent_commission' }, 'agent_commission_valid', {
    check: 'accepted_kg > 0 AND rate_per_kg > 0 AND amount > 0',
  });
  pgm.addConstraint({ schema: 'money', name: 'agent_commission' }, 'agent_commission_one_per_lot', { unique: ['lot_id'] });
  pgm.createIndex({ schema: 'money', name: 'agent_commission' }, ['tenant_id', 'agent_id', 'accrued_at']);
  pgm.createIndex({ schema: 'money', name: 'agent_commission' }, ['tenant_id', 'purchase_order_id']);
  isolate(pgm, NEW_TABLES[5]);

  pgm.createTable({ schema: 'money', name: 'agent_payment' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    agent_id: ref('trading_partners', 'agent'),
    // Commission settled: what the agent receives plus any TDS withheld from it.
    amount: money(),
    tds_section: { type: 'text' },
    tds_amount: money({ default: 0 }),
    method: { type: 'text', notNull: true },
    reference: { type: 'text' },
    paid_at: { type: 'timestamptz', notNull: true },
    ledger_entry_id: entryColumn,
    created_by: { ...userColumn, notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint({ schema: 'money', name: 'agent_payment' }, 'agent_payment_valid', {
    check: `amount > 0 AND tds_amount >= 0 AND tds_amount < amount AND (tds_section IS NULL) = (tds_amount = 0)
            AND method IN ('cash', 'upi', 'bank_transfer', 'cheque')`,
  });
  pgm.createIndex({ schema: 'money', name: 'agent_payment' }, ['tenant_id', 'agent_id', 'paid_at']);
  isolate(pgm, NEW_TABLES[6]);

  // 194H — commission or brokerage: 2% (from 1 Oct 2024), ₹20,000 a year
  // (from 1 Apr 2025), 20% without a PAN. A default section any business can
  // choose when paying an agent; only those liable to tax audit must withhold.
  pgm.sql('ALTER TABLE tax.tds_section NO FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    INSERT INTO tax.tds_section
      (tenant_id, code, description, rate_individual, rate_other, rate_no_pan, single_threshold, annual_threshold, basis, effective_from)
    SELECT NULL, '194H', 'Commission or brokerage, e.g. procurement agents (1961 Act numbering)', 2, 2, 20, NULL, 20000, 'full_once_crossed', '2025-04-01'
     WHERE NOT EXISTS (SELECT 1 FROM tax.tds_section WHERE tenant_id IS NULL AND code = '194H')
  `);
  pgm.sql('ALTER TABLE tax.tds_section FORCE ROW LEVEL SECURITY');

  // ---- 5. Internal cost of capital: 18% a year (MS §31) ----
  pgm.alterColumn({ schema: 'ai', name: 'ai_settings' }, 'cost_of_capital_pct', { default: 18 });
  pgm.sql('ALTER TABLE ai.ai_settings NO FORCE ROW LEVEL SECURITY');
  // 12% was the old default; a business still on it moves to the new one.
  pgm.sql('UPDATE ai.ai_settings SET cost_of_capital_pct = 18 WHERE cost_of_capital_pct = 12');
  pgm.sql('ALTER TABLE ai.ai_settings FORCE ROW LEVEL SECURITY');

  // ---- 7. Farmer payment terms and due dates ----
  pgm.addColumns({ schema: 'trading_partners', name: 'farmer' }, {
    payment_terms: { type: 'text', notNull: true, default: 'immediate' },
    payment_terms_days: { type: 'integer' },
  });
  pgm.addConstraint({ schema: 'trading_partners', name: 'farmer' }, 'farmer_payment_terms_valid', {
    check: `payment_terms IN ('immediate', 'bill_to_bill', 'net', 'custom')
            AND (payment_terms = 'immediate') = (payment_terms_days IS NULL)
            AND (payment_terms <> 'net' OR payment_terms_days IN (${NET_DAYS.join(', ')}))
            AND (payment_terms_days IS NULL OR payment_terms_days BETWEEN 1 AND 180)`,
  });
  pgm.addColumns({ schema: 'money', name: 'farmer_payable' }, {
    due_date: { type: 'date' },
    bill_to_bill: { type: 'boolean', notNull: true, default: false },
  });
  pgm.sql('ALTER TABLE money.farmer_payable NO FORCE ROW LEVEL SECURITY');
  // Payables accrued before terms existed were owed at once: due the day they accrued.
  pgm.sql(`
    UPDATE money.farmer_payable fp SET due_date = (fp.accrued_at AT TIME ZONE t.timezone)::date
      FROM tenant.tenant t WHERE t.id = fp.tenant_id
  `);
  pgm.sql('ALTER TABLE money.farmer_payable FORCE ROW LEVEL SECURITY');
  pgm.alterColumn({ schema: 'money', name: 'farmer_payable' }, 'due_date', { notNull: true });
  pgm.sql(PAYABLE_BALANCE);
};

exports.down = (pgm) => {
  pgm.sql('DROP VIEW money.farmer_payable_balance');
  pgm.sql(OLD_PAYABLE_BALANCE);
  pgm.sql('REVOKE INSERT, UPDATE, DELETE ON money.farmer_payable_balance FROM morbeez_app');
  pgm.sql('GRANT SELECT ON money.farmer_payable_balance TO morbeez_app, morbeez_ai');
  pgm.dropColumns({ schema: 'money', name: 'farmer_payable' }, ['due_date', 'bill_to_bill']);
  pgm.dropConstraint({ schema: 'trading_partners', name: 'farmer' }, 'farmer_payment_terms_valid');
  pgm.dropColumns({ schema: 'trading_partners', name: 'farmer' }, ['payment_terms', 'payment_terms_days']);

  // Rows moved to 18 stay there: a business may since have chosen it.
  pgm.alterColumn({ schema: 'ai', name: 'ai_settings' }, 'cost_of_capital_pct', { default: 12 });

  pgm.sql('ALTER TABLE tax.tds_section NO FORCE ROW LEVEL SECURITY');
  pgm.sql("DELETE FROM tax.tds_section WHERE tenant_id IS NULL AND code = '194H'"); // refuses if a deduction used it
  pgm.sql('ALTER TABLE tax.tds_section FORCE ROW LEVEL SECURITY');

  pgm.dropTable({ schema: 'money', name: 'agent_payment' });
  pgm.dropTable({ schema: 'money', name: 'agent_commission' });
  pgm.dropConstraint({ schema: 'trading_partners', name: 'agent' }, 'agent_pan_format');
  pgm.dropColumns({ schema: 'trading_partners', name: 'agent' }, ['pan']);

  pgm.dropTable({ schema: 'money', name: 'finance_charge_catch_up' });
  pgm.dropTable({ schema: 'money', name: 'finance_charge_pause' });
  pgm.sql('DROP INDEX money.finance_charge_period_once');
  pgm.dropIndex({ schema: 'money', name: 'finance_charge' }, ['tenant_id', 'dispute_id']);
  pgm.dropConstraint({ schema: 'money', name: 'finance_charge' }, 'finance_charge_values_valid');
  pgm.sql('ALTER TABLE money.finance_charge NO FORCE ROW LEVEL SECURITY');
  pgm.sql('DELETE FROM money.finance_charge WHERE dispute_id IS NOT NULL'); // refuses once posted; reverse those first
  pgm.sql('ALTER TABLE money.finance_charge FORCE ROW LEVEL SECURITY');
  pgm.dropColumns({ schema: 'money', name: 'finance_charge' }, ['dispute_id']);
  pgm.addConstraint({ schema: 'money', name: 'finance_charge' }, 'finance_charge_values_valid', { check: OLD_FINANCE_CHARGE_CHECK });
  pgm.addConstraint({ schema: 'money', name: 'finance_charge' }, 'finance_charge_period_once', { unique: ['source_invoice_id', 'period_end'] });

  pgm.dropConstraint({ schema: 'money', name: 'invoice_dispute' }, 'invoice_dispute_settlement_valid');
  pgm.dropColumns({ schema: 'money', name: 'invoice_dispute' }, ['accepted_amount']);

  pgm.sql('DROP VIEW money.invoice_balance');
  pgm.sql(OLD_INVOICE_BALANCE);
  pgm.sql('REVOKE INSERT, UPDATE, DELETE ON money.invoice_balance FROM morbeez_app');
  pgm.sql('GRANT SELECT ON money.invoice_balance TO morbeez_app, morbeez_ai');

  pgm.dropTable({ schema: 'money', name: 'receivable_write_off' });
  pgm.sql("DELETE FROM money.invoice_counter WHERE kind = 'credit_note'");
  pgm.sql('ALTER TABLE money.invoice_counter DROP CONSTRAINT invoice_counter_kind_valid');
  pgm.sql(`ALTER TABLE money.invoice_counter ADD CONSTRAINT invoice_counter_kind_valid CHECK (kind IN ${OLD_COUNTER_KINDS})`);
  pgm.dropTable({ schema: 'money', name: 'credit_note_line' });
  pgm.dropTable({ schema: 'money', name: 'credit_note' });

  pgm.dropTable({ schema: 'trading_partners', name: 'customer_terms_version' });
  pgm.dropIndex({ schema: 'money', name: 'invoice' }, ['customer_id', 'issued_at']);
  pgm.dropConstraint({ schema: 'money', name: 'invoice' }, 'invoice_bill_to_bill_is_a_sale');
  pgm.dropColumns({ schema: 'money', name: 'invoice' }, ['bill_to_bill']);
  pgm.dropConstraint({ schema: 'trading_partners', name: 'customer' }, 'customer_bill_to_bill_backstop');
  pgm.dropColumns({ schema: 'trading_partners', name: 'customer' }, ['finance_charge_enabled', 'bill_to_bill']);

  pgm.dropConstraint({ schema: 'money', name: 'ledger_line' }, 'ledger_line_party_valid');
  pgm.addConstraint({ schema: 'money', name: 'ledger_line' }, 'ledger_line_party_valid', {
    check: "(party_type IS NULL) = (party_id IS NULL) AND (party_type IS NULL OR party_type IN ('customer', 'farmer'))",
  });
  pgm.sql("DELETE FROM money.account WHERE code IN ('accounts_payable_agent', 'agent_commission')"); // refuses once posted to
  pgm.sql("DELETE FROM money.ledger_account WHERE code IN ('accounts_payable_agent', 'agent_commission')");
};
