/* eslint-disable camelcase */

// Each tenant gets its own chart of accounts (money.account), installed
// from the system template (money.ledger_account) when the tenant is
// created, and extendable by the tenant with accounts of its own — rent,
// salaries, a second bank account. Until now every tenant posted to one
// global, fixed chart that the app could never add to.
//
//   money.ledger_account — now the *template*: the accounts the engine
//     itself posts to (is_system), plus a few common ones a new business
//     usually wants. Changed only by migrations.
//   money.account        — per tenant, keyed (tenant_id, code). The ledger
//     posts to it: ledger_line's foreign key moves here, so a line can only
//     name an account the posting tenant actually has.
//
// Every account declares its root type (DE.2) and a report group, which is
// what places it on the P&L, the balance sheet, and the cash-flow
// statement. System accounts can be renamed and renumbered but never
// deactivated or regrouped — code depends on them. Control accounts
// (receivables, payables, inventory, advances) have sub-ledgers and take
// no manual journals.

exports.shorthands = undefined;

// root type -> the report groups allowed under it.
const GROUPS = {
  asset: ['cash', 'current_asset', 'fixed_asset'],
  liability: ['current_liability', 'long_term_liability'],
  equity: ['equity'],
  revenue: ['sales', 'contra_sales', 'other_income'],
  expense: ['cost_of_sales', 'operating_expense', 'finance_cost', 'other_expense'],
};

// [code, number, name, root, group, is_system, is_control]
// Existing codes are kept as-is; they're referenced by posted lines.
const TEMPLATE = [
  ['cash_on_hand', 1000, 'Cash on hand', 'asset', 'cash', true, false],
  ['bank', 1010, 'Bank', 'asset', 'cash', true, false],
  ['cash_with_drivers', 1050, 'Cash with drivers (trip advances)', 'asset', 'current_asset', true, false],
  ['accounts_receivable', 1100, 'Accounts receivable', 'asset', 'current_asset', true, true],
  ['allowance_doubtful_accounts', 1110, 'Allowance for doubtful accounts', 'asset', 'current_asset', true, false],
  ['inventory_asset', 1200, 'Inventory', 'asset', 'current_asset', true, true],
  ['farmer_advance', 1300, 'Farmer advances', 'asset', 'current_asset', true, true],
  ['fixed_assets_vehicles', 1500, 'Fixed assets — vehicles', 'asset', 'fixed_asset', true, false],
  ['accumulated_depreciation', 1510, 'Accumulated depreciation', 'asset', 'fixed_asset', true, false],
  ['accounts_payable_farmer', 2000, 'Accounts payable — farmers', 'liability', 'current_liability', true, true],
  ['owner_capital', 3000, "Owner's capital", 'equity', 'equity', true, false],
  ['owner_drawings', 3100, "Owner's drawings", 'equity', 'equity', true, false],
  ['retained_earnings', 3900, 'Retained earnings', 'equity', 'equity', true, false],
  ['revenue_sales', 4000, 'Sales', 'revenue', 'sales', true, false],
  ['sales_returns', 4100, 'Sales returns and allowances', 'revenue', 'contra_sales', true, false],
  ['finance_charge_income', 4500, 'Finance charge income', 'revenue', 'other_income', true, false],
  ['gain_on_disposal', 4600, 'Gain on disposal of assets', 'revenue', 'other_income', true, false],
  ['cash_over', 4700, 'Cash over (trip reconciliations)', 'revenue', 'other_income', true, false],
  ['cost_of_goods_sold', 5000, 'Cost of goods sold', 'expense', 'cost_of_sales', true, false],
  ['shrinkage_expense', 5100, 'Shrinkage and wastage', 'expense', 'operating_expense', true, false],
  ['trip_expense_fuel', 6000, 'Transport — fuel', 'expense', 'operating_expense', true, false],
  ['trip_expense_toll', 6010, 'Transport — tolls', 'expense', 'operating_expense', true, false],
  ['trip_expense_labour', 6020, 'Transport — loading labour', 'expense', 'operating_expense', true, false],
  ['trip_expense_other', 6030, 'Transport — other', 'expense', 'operating_expense', true, false],
  ['cash_shortage', 6100, 'Cash shortages (trip reconciliations)', 'expense', 'operating_expense', true, false],
  ['bad_debt_expense', 6200, 'Bad debts', 'expense', 'operating_expense', true, false],
  ['depreciation_expense', 6300, 'Depreciation', 'expense', 'operating_expense', true, false],
  // Common accounts a tenant usually wants — not system: rename or retire freely.
  ['salaries_wages', 6400, 'Salaries and wages', 'expense', 'operating_expense', false, false],
  ['rent', 6500, 'Rent', 'expense', 'operating_expense', false, false],
  ['utilities', 6600, 'Electricity, water, phone', 'expense', 'operating_expense', false, false],
  ['repairs_maintenance', 6700, 'Repairs and maintenance', 'expense', 'operating_expense', false, false],
  ['other_operating_expense', 6800, 'Other operating expenses', 'expense', 'operating_expense', false, false],
  ['loss_on_disposal', 6900, 'Loss on disposal of assets', 'expense', 'other_expense', true, false],
  ['finance_costs', 7000, 'Finance costs — bank charges, interest, fees', 'expense', 'finance_cost', true, false],
];

// Constants from this file, never user input.
const literal = (value) => `'${String(value).replace(/'/g, "''")}'`;

const GROUP_PAIRS = Object.entries(GROUPS)
  .flatMap(([root, groups]) => groups.map((group) => `(${literal(root)}, ${literal(group)})`))
  .join(', ');

exports.up = (pgm) => {
  // ---- Template ----
  pgm.addColumns(
    { schema: 'money', name: 'ledger_account' },
    {
      number: { type: 'integer' },
      report_group: { type: 'text' },
      is_system: { type: 'boolean', notNull: true, default: true },
      is_control: { type: 'boolean', notNull: true, default: false },
    },
  );
  pgm.sql(
    `INSERT INTO money.ledger_account (code, name, root_type, number, report_group, is_system, is_control) VALUES
     ${TEMPLATE.map(
       ([code, number, name, root, group, system, control]) =>
         `(${literal(code)}, ${literal(name)}, ${literal(root)}, ${number}, ${literal(group)}, ${system}, ${control})`,
     ).join(',\n     ')}
     ON CONFLICT (code) DO UPDATE SET
       name = EXCLUDED.name, number = EXCLUDED.number, report_group = EXCLUDED.report_group,
       is_system = EXCLUDED.is_system, is_control = EXCLUDED.is_control`,
  );
  pgm.alterColumn({ schema: 'money', name: 'ledger_account' }, 'number', { notNull: true });
  pgm.alterColumn({ schema: 'money', name: 'ledger_account' }, 'report_group', { notNull: true });
  pgm.addConstraint({ schema: 'money', name: 'ledger_account' }, 'ledger_account_number_unique', { unique: ['number'] });
  pgm.addConstraint({ schema: 'money', name: 'ledger_account' }, 'ledger_account_group_matches_root', {
    check: `(root_type, report_group) IN (${GROUP_PAIRS})`,
  });

  // ---- Per-tenant chart ----
  pgm.createTable(
    { schema: 'money', name: 'account' },
    {
      // A surrogate id beside the (tenant_id, code) key — what the audit log
      // and any future reference points at.
      id: { type: 'uuid', notNull: true, unique: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'CASCADE' },
      code: { type: 'text', notNull: true },
      number: { type: 'integer', notNull: true },
      name: { type: 'text', notNull: true },
      root_type: { type: 'text', notNull: true },
      report_group: { type: 'text', notNull: true },
      is_system: { type: 'boolean', notNull: true, default: false },
      is_control: { type: 'boolean', notNull: true, default: false },
      is_active: { type: 'boolean', notNull: true, default: true },
      description: { type: 'text' },
      version: { type: 'integer', notNull: true, default: 1 },
      created_by: { type: 'uuid', references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  const account = { schema: 'money', name: 'account' };
  pgm.addConstraint(account, 'account_pkey', { primaryKey: ['tenant_id', 'code'] });
  pgm.addConstraint(account, 'account_number_unique', { unique: ['tenant_id', 'number'] });
  pgm.addConstraint(account, 'account_code_format', { check: "code ~ '^[a-z][a-z0-9_]{1,62}$'" });
  pgm.addConstraint(account, 'account_number_range', { check: 'number BETWEEN 1 AND 99999' });
  pgm.addConstraint(account, 'account_name_present', { check: "length(btrim(name)) >= 2" });
  pgm.addConstraint(account, 'account_group_matches_root', { check: `(root_type, report_group) IN (${GROUP_PAIRS})` });
  // Code depends on system accounts; control accounts carry sub-ledgers.
  pgm.addConstraint(account, 'account_system_stays_active', { check: 'is_active OR NOT is_system' });
  pgm.addConstraint(account, 'account_control_is_system', { check: 'is_system OR NOT is_control' });

  pgm.sql('ALTER TABLE money.account ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE money.account FORCE ROW LEVEL SECURITY');
  pgm.sql('CREATE POLICY account_tenant_isolation ON money.account USING (tenant_id = current_tenant_id())');
  // Insert (a tenant's own accounts) and a narrow update; never delete —
  // an account with postings must stay, and one without is simply retired.
  pgm.sql('REVOKE UPDATE, DELETE ON money.account FROM morbeez_app');
  pgm.sql('GRANT UPDATE (name, number, description, is_active, version, updated_at) ON money.account TO morbeez_app');

  // Installs (or tops up) a tenant's chart from the template. Idempotent,
  // so a later migration that adds template accounts just calls it again;
  // a template number a tenant already used for an account of its own is
  // skipped rather than failing. SECURITY DEFINER, so it runs as the role
  // that owns these tables (the migration role) — which the policy below
  // lets through FORCE RLS. morbeez_app gets no such policy.
  pgm.sql(`
    CREATE FUNCTION money.install_chart_of_accounts(target_tenant uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      INSERT INTO money.account (tenant_id, code, number, name, root_type, report_group, is_system, is_control)
      SELECT target_tenant, t.code, t.number, t.name, t.root_type, t.report_group, t.is_system, t.is_control
      FROM money.ledger_account t
      WHERE NOT EXISTS (SELECT 1 FROM money.account a WHERE a.tenant_id = target_tenant AND a.number = t.number)
      ON CONFLICT (tenant_id, code) DO NOTHING
    $$
  `);
  pgm.sql('CREATE POLICY account_install ON money.account TO CURRENT_USER USING (true) WITH CHECK (true)');
  pgm.sql(`
    CREATE FUNCTION money.install_chart_for_new_tenant() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    BEGIN
      PERFORM money.install_chart_of_accounts(NEW.id);
      RETURN NEW;
    END;
    $$
  `);
  pgm.sql(`
    CREATE TRIGGER tenant_chart_of_accounts AFTER INSERT ON tenant.tenant
      FOR EACH ROW EXECUTE FUNCTION money.install_chart_for_new_tenant()
  `);
  pgm.sql('REVOKE ALL ON FUNCTION money.install_chart_of_accounts(uuid) FROM PUBLIC');
  pgm.sql('SELECT money.install_chart_of_accounts(id) FROM tenant.tenant');

  // ---- The ledger posts to the tenant's chart ----
  pgm.dropConstraint({ schema: 'money', name: 'ledger_line' }, 'ledger_line_account_code_fkey');
  pgm.addConstraint({ schema: 'money', name: 'ledger_line' }, 'ledger_line_account_fkey', {
    foreignKeys: {
      columns: ['tenant_id', 'account_code'],
      references: { schema: 'money', name: 'account' },
      onDelete: 'RESTRICT',
    },
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint({ schema: 'money', name: 'ledger_line' }, 'ledger_line_account_fkey');
  pgm.sql(
    `ALTER TABLE money.ledger_line ADD CONSTRAINT ledger_line_account_code_fkey
       FOREIGN KEY (account_code) REFERENCES money.ledger_account (code) ON DELETE RESTRICT`,
  );
  pgm.sql('DROP TRIGGER tenant_chart_of_accounts ON tenant.tenant');
  pgm.sql('DROP FUNCTION money.install_chart_for_new_tenant()');
  pgm.sql('DROP FUNCTION money.install_chart_of_accounts(uuid)');
  pgm.dropTable({ schema: 'money', name: 'account' });

  const added = TEMPLATE.filter(
    ([code]) =>
      ![
        'cash_on_hand',
        'bank',
        'accounts_receivable',
        'inventory_asset',
        'farmer_advance',
        'accounts_payable_farmer',
        'revenue_sales',
        'finance_charge_income',
        'cost_of_goods_sold',
        'finance_costs',
      ].includes(code),
  ).map(([code]) => literal(code));
  pgm.sql(`DELETE FROM money.ledger_account WHERE code IN (${added.join(', ')})`);
  pgm.dropConstraint({ schema: 'money', name: 'ledger_account' }, 'ledger_account_group_matches_root');
  pgm.dropConstraint({ schema: 'money', name: 'ledger_account' }, 'ledger_account_number_unique');
  pgm.dropColumns({ schema: 'money', name: 'ledger_account' }, ['number', 'report_group', 'is_system', 'is_control']);
};
