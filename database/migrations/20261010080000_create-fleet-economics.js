/* eslint-disable camelcase */

// Vehicle economics, in a new `fleet` schema beside the vehicle record
// (trading_partners.vehicle) it extends. Domain Model: Vehicles owns the
// vehicle, its maintenance records and whether it is fit to be assigned;
// Logistics owns the day's assignment.
//
//   vehicle_profile      — owned or hired, make/model, year.
//   fuel_log             — fills: litres, amount, odometer (fuel economy and
//                          km from consecutive readings).
//   maintenance_record   — Production Database's vehicle_maintenance_record,
//                          plus kind, vendor, odometer and when the next one
//                          is due (by date or km).
//   vehicle_document     — RC, insurance, PUC, fitness, permit, road tax:
//                          number, validity; an expired mandatory one makes
//                          the vehicle unfit to be assigned to a trip.
//   vehicle_asset        — the capitalised cost (Accounting Engine VEH.1),
//                          and its depreciation method (VEH.2, "a
//                          tenant-configured schedule").
//   depreciation_entry   — Production Database's vehicle_depreciation_entry:
//                          one per vehicle per month, with the accumulated
//                          total after it; never touches the acquisition
//                          entry (VEH.2).
//   vehicle_disposal     — Production Database's vehicle_disposal (VEH.3-5):
//                          proceeds vs net book value, gain or loss.
//   vehicle_loan         — financing: principal, rate, tenure, EMI. Always
//                          booked into the bank: a lender paying the dealer
//                          directly nets to the same books (loan in, purchase out).
//   loan_payment         — each EMI, split into interest and principal.
//   hire_contract        — a hired vehicle's owner and rate (per trip, day,
//                          km or month), effective-dated.
//   hire_bill            — the owner's bill for a period, owed until paid;
//                          TDS (e.g. 194C) can be withheld at payment.
//
// Money rows are insert-only; corrections are new entries (DE.4).

exports.shorthands = undefined;

const tenantColumn = { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' };
const userColumn = { type: 'uuid', references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' };
const vehicleColumn = { type: 'uuid', notNull: true, references: { schema: 'trading_partners', name: 'vehicle' }, onDelete: 'RESTRICT' };
const entryColumn = { type: 'uuid', references: { schema: 'money', name: 'ledger_entry' }, onDelete: 'RESTRICT' };
const created = (pgm) => ({
  created_by: { ...userColumn, notNull: true },
  created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
});
const t = (name) => ({ schema: 'fleet', name });
const PAID_FROM = "('bank', 'cash_on_hand')";

function isolate(pgm, table, updatable) {
  pgm.sql(`ALTER TABLE fleet.${table} ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE fleet.${table} FORCE ROW LEVEL SECURITY`);
  pgm.sql(`CREATE POLICY ${table}_tenant_isolation ON fleet.${table} USING (tenant_id = current_tenant_id())`);
  pgm.sql(`GRANT SELECT, INSERT ON fleet.${table} TO morbeez_app`);
  if (updatable === '*') pgm.sql(`GRANT UPDATE ON fleet.${table} TO morbeez_app`);
  else if (updatable.length) pgm.sql(`GRANT UPDATE (${updatable.join(', ')}) ON fleet.${table} TO morbeez_app`);
}

exports.up = (pgm) => {
  pgm.createSchema('fleet', { ifNotExists: true });
  pgm.sql('GRANT USAGE ON SCHEMA fleet TO morbeez_app');

  pgm.createTable(t('fleet_settings'), {
    tenant_id: { ...tenantColumn, primaryKey: true },
    document_reminder_days: { type: 'integer', notNull: true, default: 30 },
    block_trips_on_expired: { type: 'boolean', notNull: true, default: true },
    version: { type: 'integer', notNull: true, default: 1 },
    updated_by: userColumn,
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(t('fleet_settings'), 'fleet_settings_valid', { check: 'document_reminder_days BETWEEN 0 AND 365' });
  isolate(pgm, 'fleet_settings', '*');

  pgm.createTable(t('vehicle_profile'), {
    vehicle_id: { ...vehicleColumn, primaryKey: true },
    tenant_id: tenantColumn,
    ownership: { type: 'text', notNull: true, default: 'owned' },
    make_model: { type: 'text' },
    manufacture_year: { type: 'integer' },
    version: { type: 'integer', notNull: true, default: 1 },
    updated_by: userColumn,
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(t('vehicle_profile'), 'vehicle_profile_valid', {
    check: "ownership IN ('owned', 'hired') AND (manufacture_year IS NULL OR manufacture_year BETWEEN 1950 AND 2100)",
  });
  isolate(pgm, 'vehicle_profile', '*');

  // ---- Fuel ----
  pgm.createTable(t('fuel_log'), {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    vehicle_id: vehicleColumn,
    filled_on: { type: 'date', notNull: true },
    litres: { type: 'numeric(10,3)', notNull: true },
    amount: { type: 'numeric(12,2)', notNull: true },
    odometer_km: { type: 'integer' },
    full_tank: { type: 'boolean', notNull: true, default: true },
    station: { type: 'text' },
    paid_from: { type: 'text', notNull: true },
    trip_id: { type: 'uuid', references: { schema: 'fulfilment', name: 'trip' }, onDelete: 'RESTRICT' },
    ledger_entry_id: entryColumn,
    ...created(pgm),
  });
  pgm.addConstraint(t('fuel_log'), 'fuel_log_valid', {
    check: `litres > 0 AND amount > 0 AND (odometer_km IS NULL OR odometer_km >= 0) AND paid_from IN ${PAID_FROM}`,
  });
  pgm.createIndex(t('fuel_log'), ['vehicle_id', 'filled_on']);
  isolate(pgm, 'fuel_log', []);

  // ---- Maintenance ----
  pgm.createTable(t('maintenance_record'), {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    vehicle_id: vehicleColumn,
    service_date: { type: 'date', notNull: true },
    kind: { type: 'text', notNull: true },
    description: { type: 'text', notNull: true },
    vendor: { type: 'text' },
    odometer_km: { type: 'integer' },
    amount: { type: 'numeric(12,2)', notNull: true },
    paid_from: { type: 'text' },
    next_due_date: { type: 'date' },
    next_due_km: { type: 'integer' },
    ledger_entry_id: entryColumn,
    ...created(pgm),
  });
  pgm.addConstraint(t('maintenance_record'), 'maintenance_record_valid', {
    check: `kind IN ('service', 'repair', 'tyres', 'battery', 'accident', 'other') AND amount >= 0
            AND (amount = 0) = (paid_from IS NULL) AND (paid_from IS NULL OR paid_from IN ${PAID_FROM})
            AND length(btrim(description)) >= 3 AND (next_due_date IS NULL OR next_due_date > service_date)`,
  });
  pgm.createIndex(t('maintenance_record'), ['vehicle_id', 'service_date']);
  isolate(pgm, 'maintenance_record', []);

  // ---- Documents ----
  pgm.createTable(t('vehicle_document'), {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    vehicle_id: vehicleColumn,
    doc_type: { type: 'text', notNull: true },
    doc_number: { type: 'text' },
    issuer: { type: 'text' },
    valid_from: { type: 'date' },
    valid_until: { type: 'date' },
    amount: { type: 'numeric(12,2)', notNull: true, default: 0 },
    paid_from: { type: 'text' },
    notes: { type: 'text' },
    ledger_entry_id: entryColumn,
    ...created(pgm),
  });
  pgm.addConstraint(t('vehicle_document'), 'vehicle_document_valid', {
    check: `doc_type IN ('registration', 'insurance', 'puc', 'fitness', 'permit', 'road_tax', 'other')
            AND amount >= 0 AND (amount = 0) = (paid_from IS NULL) AND (paid_from IS NULL OR paid_from IN ${PAID_FROM})
            AND (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from)
            AND (doc_type IN ('registration', 'other') OR valid_until IS NOT NULL)`,
  });
  pgm.createIndex(t('vehicle_document'), ['vehicle_id', 'doc_type', 'valid_until']);
  isolate(pgm, 'vehicle_document', []);

  // ---- The asset, its depreciation, its disposal ----
  pgm.createTable(t('vehicle_asset'), {
    vehicle_id: { ...vehicleColumn, primaryKey: true },
    tenant_id: tenantColumn,
    capitalized_on: { type: 'date', notNull: true },
    cost: { type: 'numeric(14,2)', notNull: true },
    salvage_value: { type: 'numeric(14,2)', notNull: true, default: 0 },
    method: { type: 'text', notNull: true },
    useful_life_months: { type: 'integer' },
    annual_rate: { type: 'numeric(5,2)' },
    funded_by: { type: 'text', notNull: true },
    opening_accumulated: { type: 'numeric(14,2)', notNull: true, default: 0 },
    ledger_entry_id: entryColumn,
    ...created(pgm),
  });
  pgm.addConstraint(t('vehicle_asset'), 'vehicle_asset_valid', {
    check: `cost > 0 AND salvage_value >= 0 AND salvage_value < cost
            AND opening_accumulated >= 0 AND opening_accumulated <= cost - salvage_value
            AND funded_by IN ('bank', 'cash_on_hand', 'owner_capital')
            AND CASE method WHEN 'straight_line' THEN useful_life_months BETWEEN 1 AND 600 AND annual_rate IS NULL
                            WHEN 'written_down' THEN annual_rate > 0 AND annual_rate <= 100 AND useful_life_months IS NULL
                            ELSE false END`,
  });
  isolate(pgm, 'vehicle_asset', []);

  pgm.createTable(t('depreciation_run'), {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    through_month: { type: 'date', notNull: true },
    total: { type: 'numeric(14,2)', notNull: true },
    ledger_entry_id: entryColumn,
    ...created(pgm),
  });
  isolate(pgm, 'depreciation_run', []);

  pgm.createTable(t('depreciation_entry'), {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    vehicle_id: vehicleColumn,
    period_month: { type: 'date', notNull: true },
    amount: { type: 'numeric(14,2)', notNull: true },
    accumulated_after: { type: 'numeric(14,2)', notNull: true },
    run_id: { type: 'uuid', notNull: true, references: t('depreciation_run'), onDelete: 'RESTRICT' },
  });
  pgm.addConstraint(t('depreciation_entry'), 'depreciation_entry_valid', {
    check: "amount >= 0 AND period_month = date_trunc('month', period_month)::date",
  });
  pgm.addConstraint(t('depreciation_entry'), 'depreciation_entry_once', { unique: ['vehicle_id', 'period_month'] });
  isolate(pgm, 'depreciation_entry', []);

  pgm.createTable(t('vehicle_disposal'), {
    vehicle_id: { ...vehicleColumn, primaryKey: true },
    tenant_id: tenantColumn,
    disposed_on: { type: 'date', notNull: true },
    method: { type: 'text', notNull: true },
    proceeds: { type: 'numeric(14,2)', notNull: true },
    received_into: { type: 'text' },
    net_book_value: { type: 'numeric(14,2)', notNull: true },
    gain_loss_amount: { type: 'numeric(14,2)', notNull: true }, // + gain, − loss
    buyer: { type: 'text' },
    ledger_entry_id: entryColumn,
    ...created(pgm),
  });
  pgm.addConstraint(t('vehicle_disposal'), 'vehicle_disposal_valid', {
    check: `method IN ('sold', 'scrapped', 'written_off') AND proceeds >= 0
            AND (proceeds = 0) = (received_into IS NULL) AND (received_into IS NULL OR received_into IN ${PAID_FROM})
            AND gain_loss_amount = proceeds - net_book_value`,
  });
  isolate(pgm, 'vehicle_disposal', []);

  // ---- Loans ----
  pgm.createTable(t('vehicle_loan'), {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    vehicle_id: vehicleColumn,
    lender: { type: 'text', notNull: true },
    account_number: { type: 'text' },
    principal: { type: 'numeric(14,2)', notNull: true },
    annual_rate: { type: 'numeric(5,2)', notNull: true },
    tenure_months: { type: 'integer', notNull: true },
    emi: { type: 'numeric(12,2)', notNull: true },
    disbursed_on: { type: 'date', notNull: true },
    first_emi_on: { type: 'date', notNull: true },
    disbursed_into: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'active' },
    ledger_entry_id: entryColumn,
    version: { type: 'integer', notNull: true, default: 1 },
    ...created(pgm),
  });
  pgm.addConstraint(t('vehicle_loan'), 'vehicle_loan_valid', {
    check: `principal > 0 AND annual_rate >= 0 AND annual_rate <= 60 AND tenure_months BETWEEN 1 AND 360 AND emi > 0
            AND first_emi_on > disbursed_on AND status IN ('active', 'closed')
            AND disbursed_into = 'bank' AND length(btrim(lender)) >= 2`,
  });
  isolate(pgm, 'vehicle_loan', ['status', 'version']);

  pgm.createTable(t('loan_payment'), {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    loan_id: { type: 'uuid', notNull: true, references: t('vehicle_loan'), onDelete: 'RESTRICT' },
    installment_no: { type: 'integer', notNull: true },
    paid_on: { type: 'date', notNull: true },
    interest: { type: 'numeric(12,2)', notNull: true },
    principal: { type: 'numeric(14,2)', notNull: true },
    paid_from: { type: 'text', notNull: true },
    reference: { type: 'text' },
    ledger_entry_id: entryColumn,
    ...created(pgm),
  });
  pgm.addConstraint(t('loan_payment'), 'loan_payment_valid', {
    check: `interest >= 0 AND principal >= 0 AND interest + principal > 0 AND installment_no >= 1 AND paid_from IN ${PAID_FROM}`,
  });
  pgm.addConstraint(t('loan_payment'), 'loan_payment_once', { unique: ['loan_id', 'installment_no'] });
  isolate(pgm, 'loan_payment', []);

  // ---- Hired vehicles ----
  pgm.createTable(t('hire_contract'), {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    vehicle_id: vehicleColumn,
    owner_name: { type: 'text', notNull: true },
    owner_pan: { type: 'text' },
    owner_phone: { type: 'text' },
    rate_basis: { type: 'text', notNull: true },
    rate: { type: 'numeric(12,2)', notNull: true },
    includes_fuel: { type: 'boolean', notNull: true, default: false },
    effective_from: { type: 'date', notNull: true },
    effective_to: { type: 'date' },
    ...created(pgm),
  });
  pgm.addConstraint(t('hire_contract'), 'hire_contract_valid', {
    check: `rate_basis IN ('per_trip', 'per_day', 'per_km', 'per_month') AND rate > 0
            AND (owner_pan IS NULL OR owner_pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$')
            AND length(btrim(owner_name)) >= 2 AND (effective_to IS NULL OR effective_to >= effective_from)`,
  });
  pgm.addConstraint(t('hire_contract'), 'hire_contract_one_per_start', { unique: ['vehicle_id', 'effective_from'] });
  isolate(pgm, 'hire_contract', ['effective_to']);

  pgm.createTable(t('hire_bill'), {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    vehicle_id: vehicleColumn,
    contract_id: { type: 'uuid', notNull: true, references: t('hire_contract'), onDelete: 'RESTRICT' },
    period_start: { type: 'date', notNull: true },
    period_end: { type: 'date', notNull: true },
    quantity: { type: 'numeric(12,3)', notNull: true },
    rate: { type: 'numeric(12,2)', notNull: true },
    amount: { type: 'numeric(14,2)', notNull: true },
    bill_reference: { type: 'text' },
    status: { type: 'text', notNull: true, default: 'unpaid' },
    accrual_entry_id: entryColumn,
    paid_on: { type: 'date' },
    paid_from: { type: 'text' },
    tds_amount: { type: 'numeric(12,2)', notNull: true, default: 0 },
    tds_section: { type: 'text' },
    payment_entry_id: entryColumn,
    version: { type: 'integer', notNull: true, default: 1 },
    ...created(pgm),
  });
  pgm.addConstraint(t('hire_bill'), 'hire_bill_valid', {
    check: `period_start <= period_end AND quantity > 0 AND rate > 0 AND amount > 0
            AND status IN ('unpaid', 'paid') AND (status = 'paid') = (paid_on IS NOT NULL)
            AND (paid_from IS NULL OR paid_from IN ${PAID_FROM})
            AND tds_amount >= 0 AND tds_amount < amount AND (tds_amount = 0) = (tds_section IS NULL)`,
  });
  pgm.createIndex(t('hire_bill'), ['vehicle_id', 'period_start']);
  isolate(pgm, 'hire_bill', ['status', 'paid_on', 'paid_from', 'tds_amount', 'tds_section', 'payment_entry_id', 'version']);

  // ---- Ledger accounts ----
  pgm.sql(`
    INSERT INTO money.ledger_account (code, name, root_type, number, report_group, is_system, is_control) VALUES
      ('vehicle_fuel', 'Vehicle fuel', 'expense', 6040, 'operating_expense', true, false),
      ('vehicle_insurance_taxes', 'Vehicle insurance, taxes and permits', 'expense', 6050, 'operating_expense', true, false),
      ('vehicle_hire_charges', 'Hired vehicle charges', 'expense', 6060, 'operating_expense', true, false),
      ('hire_payable', 'Payable to vehicle owners', 'liability', 2310, 'current_liability', true, true),
      ('vehicle_loans', 'Vehicle loans', 'liability', 2500, 'long_term_liability', true, true),
      ('loan_interest', 'Interest on vehicle loans', 'expense', 7010, 'finance_cost', true, false)
    ON CONFLICT (code) DO NOTHING
  `);
  // The engine now posts to these: system accounts; the asset ones are kept
  // by the asset register, so they take no manual journals.
  const system = "('repairs_maintenance', 'depreciation_expense', 'gain_on_disposal', 'loss_on_disposal')";
  const control = "('fixed_assets_vehicles', 'accumulated_depreciation')";
  pgm.sql(`UPDATE money.ledger_account SET is_system = true WHERE code IN ${system} OR code IN ${control}`);
  pgm.sql(`UPDATE money.ledger_account SET is_control = true WHERE code IN ${control}`);
  pgm.sql(`UPDATE money.account SET is_system = true, is_active = true WHERE code IN ${system} OR code IN ${control}`);
  pgm.sql(`UPDATE money.account SET is_control = true WHERE code IN ${control}`);
  pgm.sql('SELECT money.install_chart_of_accounts(id) FROM tenant.tenant');

  pgm.sql(`
    INSERT INTO identity.permission (code, description) VALUES
      ('fleet:finance', 'Record vehicle assets, depreciation, disposals, loans and EMIs, and hire bills and their payment')
    ON CONFLICT (code) DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql("DELETE FROM identity.permission WHERE code = 'fleet:finance'");
  pgm.dropSchema('fleet', { cascade: true });
  const added = "('vehicle_fuel', 'vehicle_insurance_taxes', 'vehicle_hire_charges', 'hire_payable', 'vehicle_loans', 'loan_interest')";
  pgm.sql(`DELETE FROM money.account WHERE code IN ${added}`);
  pgm.sql(`DELETE FROM money.ledger_account WHERE code IN ${added}`);
  pgm.sql("UPDATE money.ledger_account SET is_control = false WHERE code IN ('fixed_assets_vehicles', 'accumulated_depreciation')");
  pgm.sql("UPDATE money.account SET is_control = false WHERE code IN ('fixed_assets_vehicles', 'accumulated_depreciation')");
  pgm.sql("UPDATE money.ledger_account SET is_system = false WHERE code = 'repairs_maintenance'");
  pgm.sql("UPDATE money.account SET is_system = false WHERE code = 'repairs_maintenance'");
};
