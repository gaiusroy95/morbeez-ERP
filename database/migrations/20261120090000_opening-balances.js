/* eslint-disable camelcase */
// Opening balances (the client, 20 Nov 2026): "Both customer farmer need
// opening balance. If they bring old customer in to that it helps." What a
// customer already owed, or what was already owed to a farmer, when the
// business moved onto Morbeez — carried into the same records everything
// else is in, so statements, aging, collections, credit limits and payments
// treat it like any other bill, and never as a sale, a purchase or a supply
// for GST.
//
// 1. money.ledger_account 'opening_balances' (equity, 3050) — the other side
//    of every balance brought forward, installed for every tenant.
// 2. money.invoice kind 'opening' (OB-000001): no order, no source invoice,
//    no tax; one per customer. Dr Accounts receivable / Cr Opening balances.
// 3. money.farmer_payable kind 'lot' | 'opening': an opening payable has no
//    lot; one per farmer. Dr Opening balances / Cr Accounts payable — farmer.
//
// Constraints and columns only; existing rows are all 'lot' payables and
// keep their lots.

exports.shorthands = undefined;

const invoice = { schema: 'money', name: 'invoice' };
const counter = { schema: 'money', name: 'invoice_counter' };
const payable = { schema: 'money', name: 'farmer_payable' };

const KINDS = "'sale', 'finance_charge', 'crate_charge', 'spot_sale'";
const REFERENCES = `((kind = 'sale') AND (order_id IS NOT NULL) AND (source_invoice_id IS NULL))
  OR ((kind = 'finance_charge') AND (order_id IS NULL) AND (source_invoice_id IS NOT NULL))
  OR ((kind = 'crate_charge') AND (order_id IS NULL) AND (source_invoice_id IS NULL))
  OR ((kind = 'spot_sale') AND (order_id IS NULL) AND (source_invoice_id IS NULL))`;
const COUNTER_KINDS = "'sale', 'finance_charge', 'crate_charge', 'spot_sale', 'credit_note'";

exports.up = (pgm) => {
  // ---- 1. The account ----
  pgm.sql(`
    INSERT INTO money.ledger_account (code, name, root_type, number, report_group, is_system, is_control) VALUES
      ('opening_balances', 'Opening balances', 'equity', 3050, 'equity', true, false)
    ON CONFLICT (code) DO NOTHING
  `);
  pgm.sql('SELECT money.install_chart_of_accounts(id) FROM tenant.tenant');

  // ---- 2. Opening invoices ----
  pgm.dropConstraint(invoice, 'invoice_kind_valid');
  pgm.addConstraint(invoice, 'invoice_kind_valid', { check: `kind IN (${KINDS}, 'opening')` });
  pgm.dropConstraint(invoice, 'invoice_kind_references');
  pgm.addConstraint(invoice, 'invoice_kind_references', {
    check: `${REFERENCES}
  OR ((kind = 'opening') AND (order_id IS NULL) AND (source_invoice_id IS NULL))`,
  });
  pgm.dropConstraint(counter, 'invoice_counter_kind_valid');
  pgm.addConstraint(counter, 'invoice_counter_kind_valid', { check: `kind IN (${COUNTER_KINDS}, 'opening')` });
  pgm.sql(`CREATE UNIQUE INDEX invoice_one_opening_per_customer ON money.invoice (tenant_id, customer_id) WHERE kind = 'opening'`);

  // ---- 3. Opening payables ----
  pgm.addColumns(payable, { kind: { type: 'text', notNull: true, default: 'lot' } });
  pgm.alterColumn(payable, 'lot_id', { notNull: false });
  pgm.addConstraint(payable, 'farmer_payable_kind_valid', {
    check: "kind IN ('lot', 'opening') AND (kind = 'lot') = (lot_id IS NOT NULL)",
  });
  pgm.sql(`CREATE UNIQUE INDEX farmer_payable_one_opening_per_farmer ON money.farmer_payable (tenant_id, farmer_id) WHERE kind = 'opening'`);
};

exports.down = (pgm) => {
  // A balance brought forward is in the books; taking the shape away would orphan it.
  pgm.sql(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM money.invoice WHERE kind = 'opening')
         OR EXISTS (SELECT 1 FROM money.farmer_payable WHERE kind = 'opening') THEN
        RAISE EXCEPTION 'Opening balances have been recorded — this migration cannot be undone';
      END IF;
    END $$
  `);
  pgm.sql('DROP INDEX money.farmer_payable_one_opening_per_farmer');
  pgm.dropConstraint(payable, 'farmer_payable_kind_valid');
  pgm.alterColumn(payable, 'lot_id', { notNull: true });
  pgm.dropColumns(payable, ['kind']);

  pgm.sql('DROP INDEX money.invoice_one_opening_per_customer');
  pgm.dropConstraint(counter, 'invoice_counter_kind_valid');
  pgm.addConstraint(counter, 'invoice_counter_kind_valid', { check: `kind IN (${COUNTER_KINDS})` });
  pgm.dropConstraint(invoice, 'invoice_kind_references');
  pgm.addConstraint(invoice, 'invoice_kind_references', { check: REFERENCES });
  pgm.dropConstraint(invoice, 'invoice_kind_valid');
  pgm.addConstraint(invoice, 'invoice_kind_valid', { check: `kind IN (${KINDS})` });

  pgm.sql("DELETE FROM money.account WHERE code = 'opening_balances'"); // refuses once posted to
  pgm.sql("DELETE FROM money.ledger_account WHERE code = 'opening_balances'");
};
