/* eslint-disable camelcase */

// Workforce management and payroll, in a new `workforce` schema, beside the
// employee record (trading_partners.employee) it extends.
//
//   worker_profile    — how a person is employed: type, skill category, the
//                       state they work in (minimum wages are set per
//                       state and category), joining and leaving dates.
//   pay_rate          — effective-dated, like the Production Database's
//                       driver_cost_rate: a rate change is a new row from a
//                       date, never an edit, so past pay stays explainable.
//                       Pay basis: monthly salary, daily, hourly, or piece.
//   assignment        — a day's work (a trip, a warehouse shift, loading,
//                       grading…): planned, then completed (with hours and
//                       units) or marked absent. Doubles as attendance
//                       (Domain Model: Workforce owns Shift and Attendance).
//                       A completed trip records its driver's assignment
//                       automatically.
//   incentive_rule    — per trip, per unit, or an attendance bonus, above a
//                       threshold, effective-dated.
//   minimum_wage_rate — the daily minimum for a state and skill category,
//                       effective-dated. No defaults are seeded: rates
//                       differ by state and are revised through the year,
//                       so each tenant enters the ones its state notifies.
//   advance           — money paid to a worker ahead of pay, recovered from
//                       later settlements.
//   settlement        — a worker's pay for a period: drafted from the
//                       period's work, rates, incentives, minimum-wage
//                       top-up and advance recovery; approved by someone
//                       other than the preparer (Constitution V.2); then
//                       paid. Approval posts the wage cost to the ledger —
//                       Cost Allocation Engine: labour cost is "recorded as
//                       real expenses in Finance's ledger when incurred";
//                       payment clears the liability. A settlement moves
//                       forward only; a mistake voids it with a reversing
//                       entry (Accounting Engine DE.4).
//
// No money row is ever deleted (Constitution III.8); lines are insert-only.

exports.shorthands = undefined;

const tenantColumn = { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' };
const userColumn = { type: 'uuid', references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' };
const employeeColumn = {
  type: 'uuid',
  notNull: true,
  references: { schema: 'trading_partners', name: 'employee' },
  onDelete: 'RESTRICT',
};
const t = (name) => ({ schema: 'workforce', name });

// grants: which columns the app may UPDATE ('*' = all), [] = insert + read only.
function isolate(pgm, table, updatable) {
  pgm.sql(`ALTER TABLE workforce.${table} ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE workforce.${table} FORCE ROW LEVEL SECURITY`);
  pgm.sql(`CREATE POLICY ${table}_tenant_isolation ON workforce.${table} USING (tenant_id = current_tenant_id())`);
  pgm.sql(`GRANT SELECT, INSERT ON workforce.${table} TO morbeez_app`);
  if (updatable === '*') pgm.sql(`GRANT UPDATE ON workforce.${table} TO morbeez_app`);
  else if (updatable.length) pgm.sql(`GRANT UPDATE (${updatable.join(', ')}) ON workforce.${table} TO morbeez_app`);
}

exports.up = (pgm) => {
  pgm.createSchema('workforce', { ifNotExists: true });
  pgm.sql('GRANT USAGE ON SCHEMA workforce TO morbeez_app');

  // ---- Settings ----
  pgm.createTable(t('payroll_settings'), {
    tenant_id: { ...tenantColumn, primaryKey: true },
    default_state_code: { type: 'text' },
    min_wage_policy: { type: 'text', notNull: true, default: 'top_up' },
    version: { type: 'integer', notNull: true, default: 1 },
    updated_by: userColumn,
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(t('payroll_settings'), 'payroll_settings_valid', {
    check: "min_wage_policy IN ('top_up', 'warn') AND (default_state_code IS NULL OR default_state_code ~ '^[0-9]{2}$')",
  });
  isolate(pgm, 'payroll_settings', '*');

  // ---- Workers ----
  pgm.createTable(t('worker_profile'), {
    employee_id: { ...employeeColumn, primaryKey: true },
    tenant_id: tenantColumn,
    employment_type: { type: 'text', notNull: true, default: 'permanent' },
    skill_category: { type: 'text', notNull: true, default: 'unskilled' },
    work_state_code: { type: 'text' },
    joined_on: { type: 'date' },
    left_on: { type: 'date' },
    phone: { type: 'text' },
    version: { type: 'integer', notNull: true, default: 1 },
    updated_by: userColumn,
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(t('worker_profile'), 'worker_profile_valid', {
    check: `employment_type IN ('permanent', 'casual', 'contract')
            AND skill_category IN ('unskilled', 'semi_skilled', 'skilled', 'highly_skilled')
            AND (work_state_code IS NULL OR work_state_code ~ '^[0-9]{2}$')
            AND (left_on IS NULL OR joined_on IS NULL OR left_on >= joined_on)`,
  });
  isolate(pgm, 'worker_profile', '*');

  pgm.createTable(t('pay_rate'), {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    employee_id: employeeColumn,
    pay_basis: { type: 'text', notNull: true },
    rate: { type: 'numeric(12,2)', notNull: true },
    unit_label: { type: 'text' },
    effective_from: { type: 'date', notNull: true },
    effective_to: { type: 'date' },
    created_by: { ...userColumn, notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(t('pay_rate'), 'pay_rate_valid', {
    check: `pay_basis IN ('monthly', 'daily', 'hourly', 'piece') AND rate > 0
            AND (pay_basis = 'piece') = (unit_label IS NOT NULL)
            AND (effective_to IS NULL OR effective_to >= effective_from)`,
  });
  pgm.addConstraint(t('pay_rate'), 'pay_rate_one_per_start', { unique: ['employee_id', 'effective_from'] });
  isolate(pgm, 'pay_rate', ['effective_to']);

  // ---- Assignments (and attendance) ----
  pgm.createTable(t('assignment'), {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    employee_id: employeeColumn,
    work_date: { type: 'date', notNull: true },
    kind: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'planned' },
    hours: { type: 'numeric(5,2)' },
    units: { type: 'numeric(12,3)' },
    trip_id: { type: 'uuid', references: { schema: 'fulfilment', name: 'trip' }, onDelete: 'RESTRICT' },
    notes: { type: 'text' },
    settlement_id: { type: 'uuid' },
    version: { type: 'integer', notNull: true, default: 1 },
    created_by: { ...userColumn, notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(t('assignment'), 'assignment_valid', {
    check: `kind IN ('trip', 'warehouse', 'loading', 'grading', 'market', 'other')
            AND status IN ('planned', 'completed', 'absent', 'cancelled')
            AND (hours IS NULL OR (hours > 0 AND hours <= 24))
            AND (units IS NULL OR units >= 0)
            AND (kind = 'trip') = (trip_id IS NOT NULL)
            AND (settlement_id IS NULL OR status IN ('completed', 'absent'))`,
  });
  pgm.sql(
    'CREATE UNIQUE INDEX assignment_one_per_trip_worker ON workforce.assignment (employee_id, trip_id) WHERE trip_id IS NOT NULL',
  );
  pgm.createIndex(t('assignment'), ['tenant_id', 'work_date']);
  pgm.createIndex(t('assignment'), ['employee_id', 'work_date']);
  isolate(pgm, 'assignment', '*');

  // ---- Rules ----
  pgm.createTable(t('incentive_rule'), {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    name: { type: 'text', notNull: true },
    role_type: { type: 'text' },
    basis: { type: 'text', notNull: true },
    threshold: { type: 'numeric(12,3)', notNull: true, default: 0 },
    amount: { type: 'numeric(12,2)', notNull: true },
    effective_from: { type: 'date', notNull: true },
    effective_to: { type: 'date' },
    created_by: { ...userColumn, notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(t('incentive_rule'), 'incentive_rule_valid', {
    check: `basis IN ('per_trip', 'per_unit', 'attendance') AND amount > 0 AND threshold >= 0
            AND length(btrim(name)) >= 2
            AND (role_type IS NULL OR role_type IN ('driver', 'warehouse', 'procurement', 'finance', 'other'))
            AND (effective_to IS NULL OR effective_to >= effective_from)`,
  });
  isolate(pgm, 'incentive_rule', ['effective_to']);

  pgm.createTable(t('minimum_wage_rate'), {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    state_code: { type: 'text', notNull: true },
    skill_category: { type: 'text', notNull: true },
    daily_rate: { type: 'numeric(12,2)', notNull: true },
    effective_from: { type: 'date', notNull: true },
    effective_to: { type: 'date' },
    source: { type: 'text' },
    created_by: { ...userColumn, notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(t('minimum_wage_rate'), 'minimum_wage_rate_valid', {
    check: `state_code ~ '^[0-9]{2}$' AND skill_category IN ('unskilled', 'semi_skilled', 'skilled', 'highly_skilled')
            AND daily_rate > 0 AND (effective_to IS NULL OR effective_to >= effective_from)`,
  });
  pgm.addConstraint(t('minimum_wage_rate'), 'minimum_wage_rate_one_per_start', {
    unique: ['tenant_id', 'state_code', 'skill_category', 'effective_from'],
  });
  isolate(pgm, 'minimum_wage_rate', ['effective_to']);

  // ---- Advances ----
  pgm.createTable(t('advance'), {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    employee_id: employeeColumn,
    amount: { type: 'numeric(12,2)', notNull: true },
    paid_on: { type: 'date', notNull: true },
    paid_from: { type: 'text', notNull: true },
    notes: { type: 'text' },
    ledger_entry_id: { type: 'uuid', notNull: true, references: { schema: 'money', name: 'ledger_entry' }, onDelete: 'RESTRICT' },
    created_by: { ...userColumn, notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(t('advance'), 'advance_valid', { check: "amount > 0 AND paid_from IN ('bank', 'cash_on_hand')" });
  pgm.createIndex(t('advance'), ['employee_id', 'paid_on']);
  isolate(pgm, 'advance', []);

  // ---- Settlements ----
  pgm.createTable(t('settlement'), {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    settlement_number: { type: 'integer', notNull: true },
    employee_id: employeeColumn,
    period_start: { type: 'date', notNull: true },
    period_end: { type: 'date', notNull: true },
    status: { type: 'text', notNull: true, default: 'draft' },
    gross: { type: 'numeric(12,2)', notNull: true },
    deductions: { type: 'numeric(12,2)', notNull: true },
    net: { type: 'numeric(12,2)', notNull: true },
    warnings: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
    prepared_by: { ...userColumn, notNull: true },
    prepared_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    approved_by: userColumn,
    approved_at: { type: 'timestamptz' },
    approval_entry_id: { type: 'uuid', references: { schema: 'money', name: 'ledger_entry' }, onDelete: 'RESTRICT' },
    paid_by: userColumn,
    paid_at: { type: 'timestamptz' },
    paid_from: { type: 'text' },
    payment_reference: { type: 'text' },
    payment_entry_id: { type: 'uuid', references: { schema: 'money', name: 'ledger_entry' }, onDelete: 'RESTRICT' },
    voided_by: userColumn,
    voided_at: { type: 'timestamptz' },
    void_reason: { type: 'text' },
    void_entry_id: { type: 'uuid', references: { schema: 'money', name: 'ledger_entry' }, onDelete: 'RESTRICT' },
    version: { type: 'integer', notNull: true, default: 1 },
  });
  pgm.addConstraint(t('settlement'), 'settlement_number_unique', { unique: ['tenant_id', 'settlement_number'] });
  pgm.addConstraint(t('settlement'), 'settlement_valid', {
    check: `status IN ('draft', 'approved', 'paid', 'void') AND period_start <= period_end
            AND gross >= 0 AND deductions >= 0 AND net = gross - deductions AND net >= 0
            AND (status IN ('approved', 'paid') OR (status = 'void' AND approved_at IS NOT NULL)) = (approved_at IS NOT NULL)
            AND (status = 'paid') = (paid_at IS NOT NULL)
            AND (status = 'void') = (voided_at IS NOT NULL)
            AND (paid_from IS NULL OR paid_from IN ('bank', 'cash_on_hand'))`,
  });
  // Segregation of duties (Constitution V.2): nobody approves their own settlement.
  pgm.addConstraint(t('settlement'), 'settlement_approver_not_preparer', {
    check: 'approved_by IS NULL OR approved_by <> prepared_by',
  });
  pgm.createIndex(t('settlement'), ['tenant_id', 'status']);
  pgm.createIndex(t('settlement'), ['employee_id', 'period_start']);
  isolate(pgm, 'settlement', [
    'status',
    'approved_by',
    'approved_at',
    'approval_entry_id',
    'paid_by',
    'paid_at',
    'paid_from',
    'payment_reference',
    'payment_entry_id',
    'voided_by',
    'voided_at',
    'void_reason',
    'void_entry_id',
    'version',
  ]);
  pgm.addConstraint(t('assignment'), 'assignment_settlement_fkey', {
    foreignKeys: { columns: 'settlement_id', references: t('settlement'), onDelete: 'RESTRICT' },
  });

  pgm.createTable(t('settlement_line'), {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    settlement_id: { type: 'uuid', notNull: true, references: t('settlement'), onDelete: 'RESTRICT' },
    sort: { type: 'integer', notNull: true },
    kind: { type: 'text', notNull: true },
    description: { type: 'text', notNull: true },
    quantity: { type: 'numeric(12,3)' },
    rate: { type: 'numeric(12,2)' },
    amount: { type: 'numeric(12,2)', notNull: true },
    incentive_rule_id: { type: 'uuid', references: t('incentive_rule'), onDelete: 'RESTRICT' },
    advance_id: { type: 'uuid', references: t('advance'), onDelete: 'RESTRICT' },
  });
  pgm.addConstraint(t('settlement_line'), 'settlement_line_valid', {
    check: `kind IN ('basic', 'incentive', 'minimum_wage_topup', 'adjustment', 'advance_recovery')
            AND CASE kind WHEN 'advance_recovery' THEN amount < 0 AND advance_id IS NOT NULL
                          WHEN 'adjustment' THEN amount <> 0
                          ELSE amount >= 0 END`,
  });
  pgm.createIndex(t('settlement_line'), 'settlement_id');
  pgm.createIndex(t('settlement_line'), 'advance_id');
  isolate(pgm, 'settlement_line', []);

  // ---- Ledger accounts ----
  pgm.sql(`
    INSERT INTO money.ledger_account (code, name, root_type, number, report_group, is_system, is_control) VALUES
      ('employee_advance', 'Advances to workers', 'asset', 1320, 'current_asset', true, true),
      ('wages_payable', 'Wages payable', 'liability', 2300, 'current_liability', true, true),
      ('incentives_expense', 'Worker incentives', 'expense', 6410, 'operating_expense', true, false)
    ON CONFLICT (code) DO NOTHING
  `);
  // Payroll posts to salaries and wages: it becomes a system account.
  pgm.sql("UPDATE money.ledger_account SET is_system = true WHERE code = 'salaries_wages'");
  pgm.sql("UPDATE money.account SET is_system = true, is_active = true WHERE code = 'salaries_wages'");
  pgm.sql('SELECT money.install_chart_of_accounts(id) FROM tenant.tenant');

  pgm.sql(`
    INSERT INTO identity.permission (code, description) VALUES
      ('payroll:read', 'View pay rates, earnings, advances, and settlements'),
      ('payroll:configure', 'Set pay rates, incentive rules, minimum wages, and payroll settings'),
      ('payroll:prepare', 'Draft settlements and record advances to workers'),
      ('payroll:approve', 'Approve or void settlements someone else prepared'),
      ('payroll:pay', 'Record payment of approved settlements')
    ON CONFLICT (code) DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql("DELETE FROM identity.permission WHERE code IN ('payroll:read', 'payroll:configure', 'payroll:prepare', 'payroll:approve', 'payroll:pay')");
  pgm.dropSchema('workforce', { cascade: true });
  pgm.sql("DELETE FROM money.account WHERE code IN ('employee_advance', 'wages_payable', 'incentives_expense')");
  pgm.sql("DELETE FROM money.ledger_account WHERE code IN ('employee_advance', 'wages_payable', 'incentives_expense')");
  pgm.sql("UPDATE money.ledger_account SET is_system = false WHERE code = 'salaries_wages'");
  pgm.sql("UPDATE money.account SET is_system = false WHERE code = 'salaries_wages'");
};
