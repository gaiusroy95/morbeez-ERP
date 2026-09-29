/* eslint-disable camelcase */

// Crate management, in a new `crates` schema. No governing spec covers
// returnable crates (Domain Model, Inventory Engine, Event Catalog and
// Production Database are silent), so this follows the Constitution's
// general rules: an append-only ledger (III.3), money as exact decimals
// (III.2), nothing financial deleted (III.8), every posting through
// Finance's ledger (DE.1).
//
//   crate_type      — a kind of crate the business owns: its replacement
//                     cost (what a lost one is charged at), an optional HSN
//                     (a charge for lost crates is a supply of the crates,
//                     taxed by the tenant's GST rules), and a reorder level
//                     for the yard.
//   crate_settings  — when a party's crates count as overdue.
//   crate_limit     — optionally, the most crates one customer or farmer
//                     may hold.
//   movement        — the ledger. Every row moves N crates of one type from
//                     one holder to another, so crates are never created or
//                     destroyed except at the two edges ('outside' — bought
//                     or counted in — and 'lost'). A holder's balance is the
//                     sum of what came in less what went out: derived, never
//                     stored (holder_balance). Mistakes are reversed by a
//                     mirror 'correction' row, never edited (DE.4).
//                     A purchase with a cost posts Dr Crates and packaging /
//                     Cr bank or cash: crates are expensed when bought, so
//                     a loss writes nothing off.
//   crate_loss      — each loss and how it was recovered: invoiced to the
//                     customer, deducted from the farmer's payable, or
//                     absorbed.
//   payable_deduction — the farmer payables a loss charge was taken from;
//                     money.farmer_payable_balance counts it, so payments
//                     only pay what's left.

exports.shorthands = undefined;

const tenantColumn = { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' };
const userColumn = { type: 'uuid', references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' };
const t = (name) => ({ schema: 'crates', name });
const HOLDERS = "('yard', 'customer', 'farmer', 'vehicle', 'outside', 'lost')";
const PARTY = "('customer', 'farmer')";

// Which holders each kind of movement may run between.
const KIND_RULES = `CASE kind
  WHEN 'purchased' THEN from_kind = 'outside' AND to_kind = 'yard'
  WHEN 'opening'   THEN from_kind = 'outside' AND to_kind IN ('yard', 'customer', 'farmer', 'vehicle')
  WHEN 'issued'    THEN from_kind = 'yard' AND to_kind IN ${PARTY}
  WHEN 'returned'  THEN from_kind IN ${PARTY} AND to_kind = 'yard'
  WHEN 'loaded'    THEN from_kind = 'yard' AND to_kind = 'vehicle'
  WHEN 'unloaded'  THEN from_kind = 'vehicle' AND to_kind = 'yard'
  WHEN 'delivered' THEN from_kind = 'vehicle' AND to_kind IN ${PARTY}
  WHEN 'collected' THEN from_kind IN ${PARTY} AND to_kind = 'vehicle'
  WHEN 'lost'      THEN from_kind IN ('yard', 'customer', 'farmer', 'vehicle') AND to_kind = 'lost'
  WHEN 'correction' THEN reverses_movement_id IS NOT NULL
  ELSE false END`;

const PREVIOUS_PAYABLE_VIEW = `
    CREATE OR REPLACE VIEW money.farmer_payable_balance WITH (security_invoker = true) AS
    SELECT fp.id AS payable_id, fp.tenant_id, fp.lot_id, fp.farmer_id, fp.amount, fp.accrued_at,
           COALESCE(a.paid, 0)::numeric(12,2) AS paid,
           (fp.amount - COALESCE(a.paid, 0) - COALESCE(t.withheld, 0))::numeric(12,2) AS outstanding,
           COALESCE(t.withheld, 0)::numeric(12,2) AS tds_withheld
    FROM money.farmer_payable fp
    LEFT JOIN (
      SELECT payable_id, SUM(amount) AS paid FROM money.farmer_payment_allocation GROUP BY payable_id
    ) a ON a.payable_id = fp.id
    LEFT JOIN (
      SELECT payable_id, SUM(tds_amount) AS withheld FROM tax.tds_deduction WHERE payable_id IS NOT NULL GROUP BY payable_id
    ) t ON t.payable_id = fp.id`;

function isolate(pgm, table, updatable) {
  pgm.sql(`ALTER TABLE crates.${table} ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE crates.${table} FORCE ROW LEVEL SECURITY`);
  pgm.sql(`CREATE POLICY ${table}_tenant_isolation ON crates.${table} USING (tenant_id = current_tenant_id())`);
  pgm.sql(`GRANT SELECT, INSERT ON crates.${table} TO morbeez_app`);
  if (updatable === '*') pgm.sql(`GRANT UPDATE ON crates.${table} TO morbeez_app`);
  else if (updatable.length) pgm.sql(`GRANT UPDATE (${updatable.join(', ')}) ON crates.${table} TO morbeez_app`);
}

exports.up = (pgm) => {
  pgm.createSchema('crates', { ifNotExists: true });
  pgm.sql('GRANT USAGE ON SCHEMA crates TO morbeez_app');

  pgm.createTable(t('crate_settings'), {
    tenant_id: { ...tenantColumn, primaryKey: true },
    customer_overdue_days: { type: 'integer', notNull: true, default: 7 },
    farmer_overdue_days: { type: 'integer', notNull: true, default: 15 },
    version: { type: 'integer', notNull: true, default: 1 },
    updated_by: userColumn,
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(t('crate_settings'), 'crate_settings_valid', {
    check: 'customer_overdue_days BETWEEN 1 AND 365 AND farmer_overdue_days BETWEEN 1 AND 365',
  });
  isolate(pgm, 'crate_settings', '*');

  pgm.createTable(t('crate_type'), {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    code: { type: 'text', notNull: true },
    name: { type: 'text', notNull: true },
    capacity_kg: { type: 'numeric(8,2)' },
    replacement_cost: { type: 'numeric(10,2)', notNull: true },
    hsn_code: { type: 'text' },
    reorder_level: { type: 'integer', notNull: true, default: 0 },
    is_active: { type: 'boolean', notNull: true, default: true },
    version: { type: 'integer', notNull: true, default: 1 },
    created_by: { ...userColumn, notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(t('crate_type'), 'crate_type_valid', {
    check: `code ~ '^[A-Z0-9-]{1,12}$' AND length(btrim(name)) >= 2 AND replacement_cost > 0
            AND (capacity_kg IS NULL OR capacity_kg > 0) AND reorder_level >= 0
            AND (hsn_code IS NULL OR hsn_code ~ '^[0-9]{4}([0-9]{2}){0,2}$')`,
  });
  pgm.addConstraint(t('crate_type'), 'crate_type_code_unique', { unique: ['tenant_id', 'code'] });
  isolate(pgm, 'crate_type', ['name', 'capacity_kg', 'replacement_cost', 'hsn_code', 'reorder_level', 'is_active', 'version', 'updated_at']);

  pgm.createTable(t('crate_limit'), {
    tenant_id: tenantColumn,
    holder_kind: { type: 'text', notNull: true },
    holder_id: { type: 'uuid', notNull: true },
    max_crates: { type: 'integer', notNull: true },
    updated_by: userColumn,
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(t('crate_limit'), 'crate_limit_pk', { primaryKey: ['holder_kind', 'holder_id'] });
  pgm.addConstraint(t('crate_limit'), 'crate_limit_valid', { check: `holder_kind IN ${PARTY} AND max_crates >= 0` });
  isolate(pgm, 'crate_limit', ['max_crates', 'updated_by', 'updated_at']);
  pgm.sql('GRANT DELETE ON crates.crate_limit TO morbeez_app');

  // ---- The ledger ----
  pgm.createTable(t('movement'), {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    batch_id: { type: 'uuid', notNull: true }, // the lines recorded together (a delivery's crate types)
    crate_type_id: { type: 'uuid', notNull: true, references: t('crate_type'), onDelete: 'RESTRICT' },
    quantity: { type: 'integer', notNull: true },
    kind: { type: 'text', notNull: true },
    from_kind: { type: 'text', notNull: true },
    from_id: { type: 'uuid' },
    to_kind: { type: 'text', notNull: true },
    to_id: { type: 'uuid' },
    occurred_at: { type: 'timestamptz', notNull: true },
    trip_id: { type: 'uuid', references: { schema: 'fulfilment', name: 'trip' }, onDelete: 'RESTRICT' },
    trip_stop_id: { type: 'uuid', references: { schema: 'fulfilment', name: 'trip_stop' }, onDelete: 'RESTRICT' },
    reverses_movement_id: { type: 'uuid', references: t('movement'), onDelete: 'RESTRICT' },
    reference: { type: 'text' },
    notes: { type: 'text' },
    created_by: { ...userColumn, notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(t('movement'), 'movement_valid', {
    check: `quantity > 0 AND from_kind IN ${HOLDERS} AND to_kind IN ${HOLDERS}
            AND (from_id IS NULL) = (from_kind IN ('yard', 'outside', 'lost'))
            AND (to_id IS NULL) = (to_kind IN ('yard', 'outside', 'lost'))
            AND NOT (from_kind = to_kind AND from_id IS NOT DISTINCT FROM to_id)
            AND (trip_stop_id IS NULL OR trip_id IS NOT NULL)
            AND (reverses_movement_id IS NULL) = (kind <> 'correction')
            AND ${KIND_RULES}`,
  });
  pgm.sql('CREATE UNIQUE INDEX movement_reversed_once ON crates.movement (reverses_movement_id) WHERE reverses_movement_id IS NOT NULL');
  pgm.createIndex(t('movement'), ['tenant_id', 'occurred_at']);
  pgm.createIndex(t('movement'), ['from_kind', 'from_id']);
  pgm.createIndex(t('movement'), ['to_kind', 'to_id']);
  pgm.createIndex(t('movement'), 'trip_id');
  pgm.createIndex(t('movement'), 'batch_id');
  isolate(pgm, 'movement', []);

  // A holder is a real customer, farmer or vehicle of the same tenant (RLS
  // hides everyone else's, so a foreign id simply isn't found).
  pgm.sql(`
    CREATE FUNCTION crates.assert_holders() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      side record;
    BEGIN
      FOR side IN SELECT * FROM (VALUES (NEW.from_kind, NEW.from_id), (NEW.to_kind, NEW.to_id)) AS s(kind, id) LOOP
        IF side.kind = 'customer' AND NOT EXISTS (SELECT 1 FROM trading_partners.customer WHERE id = side.id) OR
           side.kind = 'farmer' AND NOT EXISTS (SELECT 1 FROM trading_partners.farmer WHERE id = side.id) OR
           side.kind = 'vehicle' AND NOT EXISTS (SELECT 1 FROM trading_partners.vehicle WHERE id = side.id) THEN
          RAISE EXCEPTION 'crate holder % % not found', side.kind, side.id USING ERRCODE = 'foreign_key_violation';
        END IF;
      END LOOP;
      RETURN NEW;
    END $$`);
  pgm.sql(`CREATE TRIGGER movement_holders BEFORE INSERT ON crates.movement FOR EACH ROW EXECUTE FUNCTION crates.assert_holders()`);

  // Balances, derived. Only real holders: 'outside' and 'lost' are the edges.
  pgm.sql(`
    CREATE VIEW crates.holder_balance WITH (security_invoker = true) AS
    SELECT tenant_id, holder_kind, holder_id, crate_type_id, SUM(delta)::int AS balance
    FROM (
      SELECT tenant_id, to_kind AS holder_kind, to_id AS holder_id, crate_type_id, quantity AS delta FROM crates.movement
      UNION ALL
      SELECT tenant_id, from_kind, from_id, crate_type_id, -quantity FROM crates.movement
    ) m
    WHERE holder_kind NOT IN ('outside', 'lost')
    GROUP BY tenant_id, holder_kind, holder_id, crate_type_id`);
  pgm.sql('GRANT SELECT ON crates.holder_balance TO morbeez_app');

  // ---- Losses and their recovery ----
  pgm.createTable(t('crate_loss'), {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    movement_id: { type: 'uuid', notNull: true, unique: true, references: t('movement'), onDelete: 'RESTRICT' },
    recovery: { type: 'text', notNull: true },
    unit_charge: { type: 'numeric(10,2)', notNull: true, default: 0 },
    amount: { type: 'numeric(12,2)', notNull: true, default: 0 },
    tax_amount: { type: 'numeric(12,2)', notNull: true, default: 0 },
    invoice_id: { type: 'uuid', references: { schema: 'money', name: 'invoice' }, onDelete: 'RESTRICT' },
    ledger_entry_id: { type: 'uuid', references: { schema: 'money', name: 'ledger_entry' }, onDelete: 'RESTRICT' },
    reason: { type: 'text', notNull: true },
    created_by: { ...userColumn, notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(t('crate_loss'), 'crate_loss_valid', {
    check: `recovery IN ('absorbed', 'invoiced', 'deducted') AND length(btrim(reason)) >= 3
            AND CASE recovery
                  WHEN 'absorbed' THEN amount = 0 AND tax_amount = 0 AND invoice_id IS NULL AND ledger_entry_id IS NULL
                  WHEN 'invoiced' THEN amount > 0 AND invoice_id IS NOT NULL AND ledger_entry_id IS NOT NULL
                  ELSE amount > 0 AND tax_amount = 0 AND invoice_id IS NULL AND ledger_entry_id IS NOT NULL END`,
  });
  isolate(pgm, 'crate_loss', []);

  pgm.createTable(t('payable_deduction'), {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    loss_id: { type: 'uuid', notNull: true, references: t('crate_loss'), onDelete: 'RESTRICT' },
    payable_id: { type: 'uuid', notNull: true, references: { schema: 'money', name: 'farmer_payable' }, onDelete: 'RESTRICT' },
    amount: { type: 'numeric(12,2)', notNull: true },
  });
  pgm.addConstraint(t('payable_deduction'), 'payable_deduction_positive', { check: 'amount > 0' });
  pgm.createIndex(t('payable_deduction'), 'payable_id');
  isolate(pgm, 'payable_deduction', []);

  // What's left to pay on a farmer payable now also nets off crate charges.
  pgm.sql(`
    CREATE OR REPLACE VIEW money.farmer_payable_balance WITH (security_invoker = true) AS
    SELECT fp.id AS payable_id, fp.tenant_id, fp.lot_id, fp.farmer_id, fp.amount, fp.accrued_at,
           COALESCE(a.paid, 0)::numeric(12,2) AS paid,
           (fp.amount - COALESCE(a.paid, 0) - COALESCE(t.withheld, 0) - COALESCE(d.deducted, 0))::numeric(12,2) AS outstanding,
           COALESCE(t.withheld, 0)::numeric(12,2) AS tds_withheld,
           COALESCE(d.deducted, 0)::numeric(12,2) AS crate_deducted
    FROM money.farmer_payable fp
    LEFT JOIN (
      SELECT payable_id, SUM(amount) AS paid FROM money.farmer_payment_allocation GROUP BY payable_id
    ) a ON a.payable_id = fp.id
    LEFT JOIN (
      SELECT payable_id, SUM(tds_amount) AS withheld FROM tax.tds_deduction WHERE payable_id IS NOT NULL GROUP BY payable_id
    ) t ON t.payable_id = fp.id
    LEFT JOIN (
      SELECT payable_id, SUM(amount) AS deducted FROM crates.payable_deduction GROUP BY payable_id
    ) d ON d.payable_id = fp.id`);

  // ---- A crate charge is its own kind of invoice ----
  pgm.sql('ALTER TABLE money.invoice DROP CONSTRAINT invoice_kind_valid');
  pgm.sql("ALTER TABLE money.invoice ADD CONSTRAINT invoice_kind_valid CHECK (kind IN ('sale', 'finance_charge', 'crate_charge'))");
  pgm.sql('ALTER TABLE money.invoice DROP CONSTRAINT invoice_kind_references');
  pgm.sql(`ALTER TABLE money.invoice ADD CONSTRAINT invoice_kind_references CHECK (
    (kind = 'sale' AND order_id IS NOT NULL AND source_invoice_id IS NULL) OR
    (kind = 'finance_charge' AND order_id IS NULL AND source_invoice_id IS NOT NULL) OR
    (kind = 'crate_charge' AND order_id IS NULL AND source_invoice_id IS NULL))`);
  pgm.sql('ALTER TABLE money.invoice_counter DROP CONSTRAINT IF EXISTS invoice_counter_kind_valid');
  pgm.sql("ALTER TABLE money.invoice_counter ADD CONSTRAINT invoice_counter_kind_valid CHECK (kind IN ('sale', 'finance_charge', 'crate_charge'))");

  // ---- Ledger accounts ----
  pgm.sql(`
    INSERT INTO money.ledger_account (code, name, root_type, number, report_group, is_system, is_control) VALUES
      ('crate_recoveries', 'Crate loss recoveries', 'revenue', 4800, 'other_income', true, false),
      ('crate_purchases', 'Crates and packaging', 'expense', 6080, 'operating_expense', true, false)
    ON CONFLICT (code) DO NOTHING
  `);
  pgm.sql('SELECT money.install_chart_of_accounts(id) FROM tenant.tenant');

  pgm.sql(`
    INSERT INTO identity.permission (code, description) VALUES
      ('crates:read', 'See crate balances, movements and alerts'),
      ('crates:write', 'Record crates issued, returned, loaded, unloaded, bought and lost'),
      ('crates:charge', 'Charge customers and farmers for lost crates'),
      ('crates:configure', 'Set crate types, costs, limits and alert settings')
    ON CONFLICT (code) DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql("DELETE FROM identity.permission WHERE code IN ('crates:read', 'crates:write', 'crates:charge', 'crates:configure')");
  pgm.sql(PREVIOUS_PAYABLE_VIEW.replace('CREATE OR REPLACE VIEW', 'CREATE VIEW').replace(/^/, 'DROP VIEW money.farmer_payable_balance;'));
  pgm.sql('REVOKE INSERT, UPDATE, DELETE ON money.farmer_payable_balance FROM morbeez_app');
  pgm.sql('GRANT SELECT ON money.farmer_payable_balance TO morbeez_app');
  pgm.sql("DELETE FROM money.invoice_counter WHERE kind = 'crate_charge'");
  pgm.sql('ALTER TABLE money.invoice_counter DROP CONSTRAINT invoice_counter_kind_valid');
  pgm.sql("ALTER TABLE money.invoice_counter ADD CONSTRAINT invoice_counter_kind_valid CHECK (kind IN ('sale', 'finance_charge'))");
  pgm.sql('ALTER TABLE money.invoice DROP CONSTRAINT invoice_kind_references');
  pgm.sql(`ALTER TABLE money.invoice ADD CONSTRAINT invoice_kind_references CHECK (
    (kind = 'sale' AND order_id IS NOT NULL AND source_invoice_id IS NULL) OR
    (kind = 'finance_charge' AND order_id IS NULL AND source_invoice_id IS NOT NULL))`);
  pgm.sql('ALTER TABLE money.invoice DROP CONSTRAINT invoice_kind_valid');
  pgm.sql("ALTER TABLE money.invoice ADD CONSTRAINT invoice_kind_valid CHECK (kind IN ('sale', 'finance_charge'))");
  pgm.dropSchema('crates', { cascade: true });
  pgm.sql("DELETE FROM money.account WHERE code IN ('crate_recoveries', 'crate_purchases')");
  pgm.sql("DELETE FROM money.ledger_account WHERE code IN ('crate_recoveries', 'crate_purchases')");
};
