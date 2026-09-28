/* eslint-disable camelcase */

// Finance costs, both directions.
//
//   finance_charge — interest charged TO a customer on an overdue sale
//                    invoice, at the rate their credit terms set
//                    (Accounting Engine, FC.1). Each accrual covers a
//                    period [period_start, period_end) and is billed as its
//                    own 'finance_charge' invoice, so it ages, is collected,
//                    and could be provisioned exactly like principal (FC.3).
//                    Consecutive runs pick up where the last period ended;
//                    the unique (source invoice, period_end) makes a
//                    repeated run for the same day a no-op, not a double
//                    charge.
//   finance_cost   — what finance costs the business: bank charges, loan
//                    interest, payment fees, processing fees. Fees deducted
//                    from a specific collection or payment are carried on
//                    that payment (fee_amount) instead, and reported
//                    alongside these.

exports.shorthands = undefined;

const COST_CATEGORIES = ['bank_charges', 'interest', 'payment_fee', 'loan_processing', 'other'];
const PAID_FROM = ['bank', 'cash_on_hand'];
const literal = (value) => `'${value.replace(/'/g, "''")}'`;

const tenantIsolated = (pgm, table) => {
  pgm.sql(`ALTER TABLE money.${table} ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE money.${table} FORCE ROW LEVEL SECURITY`);
  pgm.sql(`CREATE POLICY ${table}_tenant_isolation ON money.${table} USING (tenant_id = current_tenant_id())`);
  pgm.sql(`REVOKE UPDATE, DELETE ON money.${table} FROM morbeez_app`);
};

const tenantColumn = { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' };
const userColumn = { type: 'uuid', notNull: true, references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' };

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'money', name: 'finance_charge' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: tenantColumn,
      invoice_id: { type: 'uuid', notNull: true, references: { schema: 'money', name: 'invoice' }, onDelete: 'RESTRICT' },
      source_invoice_id: { type: 'uuid', notNull: true, references: { schema: 'money', name: 'invoice' }, onDelete: 'RESTRICT' },
      period_start: { type: 'date', notNull: true },
      period_end: { type: 'date', notNull: true },
      principal: { type: 'numeric(12,2)', notNull: true },
      rate_monthly_percent: { type: 'numeric(5,2)', notNull: true },
      days: { type: 'integer', notNull: true },
      amount: { type: 'numeric(12,2)', notNull: true },
      created_by: userColumn,
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  pgm.addConstraint({ schema: 'money', name: 'finance_charge' }, 'finance_charge_values_valid', {
    check: 'period_end > period_start AND days = period_end - period_start AND principal > 0 AND rate_monthly_percent > 0 AND amount > 0',
  });
  pgm.addConstraint({ schema: 'money', name: 'finance_charge' }, 'finance_charge_one_invoice', { unique: ['invoice_id'] });
  pgm.addConstraint({ schema: 'money', name: 'finance_charge' }, 'finance_charge_period_once', {
    unique: ['source_invoice_id', 'period_end'],
  });
  pgm.createIndex({ schema: 'money', name: 'finance_charge' }, ['tenant_id', 'source_invoice_id']);
  tenantIsolated(pgm, 'finance_charge');

  pgm.createTable(
    { schema: 'money', name: 'finance_cost' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: tenantColumn,
      category: { type: 'text', notNull: true },
      amount: { type: 'numeric(12,2)', notNull: true },
      paid_from: { type: 'text', notNull: true },
      description: { type: 'text', notNull: true },
      reference: { type: 'text' },
      incurred_at: { type: 'timestamptz', notNull: true },
      recorded_by: userColumn,
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  pgm.addConstraint({ schema: 'money', name: 'finance_cost' }, 'finance_cost_amount_positive', { check: 'amount > 0' });
  pgm.addConstraint({ schema: 'money', name: 'finance_cost' }, 'finance_cost_category_valid', {
    check: `category IN (${COST_CATEGORIES.map(literal).join(', ')})`,
  });
  pgm.addConstraint({ schema: 'money', name: 'finance_cost' }, 'finance_cost_paid_from_valid', {
    check: `paid_from IN (${PAID_FROM.map(literal).join(', ')})`,
  });
  pgm.createIndex({ schema: 'money', name: 'finance_cost' }, ['tenant_id', 'incurred_at']);
  tenantIsolated(pgm, 'finance_cost');
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'money', name: 'finance_cost' });
  pgm.dropTable({ schema: 'money', name: 'finance_charge' });
};
