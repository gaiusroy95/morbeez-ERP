/* eslint-disable camelcase */

// Payables and payments to farmers (Event Catalog, Lot Graded and Farmer
// Payment Made; Accounting Engine, ADV).
//
//   farmer_payable            — accrued when a lot is graded: accepted
//                               quantity × the grade-fixed unit cost
//                               (LOT.2). One per lot.
//   farmer_payment            — money paid to a farmer, for one or many
//                               lots, in full or in part.
//   farmer_payment_allocation — how a payment was applied to payables.
//
// A payment larger than what's owed leaves the remainder unapplied: a
// farmer advance (ADV.1). The farmer's next graded lot draws on it first
// (ADV.2) — an allocation dated then — and nothing is ever written off by
// default (ADV.3).
//
// Supersedes money.farmer_settlement (one full payment per lot, no
// partials, no advances); that table stays for history and takes no new
// rows.

exports.shorthands = undefined;

const METHODS = ['cash', 'upi', 'bank_transfer', 'cheque'];
const literal = (value) => `'${value.replace(/'/g, "''")}'`;

const tenantIsolated = (pgm, table) => {
  pgm.sql(`ALTER TABLE money.${table} ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE money.${table} FORCE ROW LEVEL SECURITY`);
  pgm.sql(`CREATE POLICY ${table}_tenant_isolation ON money.${table} USING (tenant_id = current_tenant_id())`);
  pgm.sql(`REVOKE UPDATE, DELETE ON money.${table} FROM morbeez_app`);
};

const tenantColumn = { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' };
const userColumn = { type: 'uuid', notNull: true, references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' };
const farmerColumn = {
  type: 'uuid',
  notNull: true,
  references: { schema: 'trading_partners', name: 'farmer' },
  onDelete: 'RESTRICT',
};

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'money', name: 'farmer_payable' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: tenantColumn,
      lot_id: { type: 'uuid', notNull: true, references: { schema: 'commerce', name: 'lot' }, onDelete: 'RESTRICT' },
      farmer_id: farmerColumn,
      amount: { type: 'numeric(12,2)', notNull: true },
      accrued_at: { type: 'timestamptz', notNull: true },
      created_by: userColumn,
    },
  );
  pgm.addConstraint({ schema: 'money', name: 'farmer_payable' }, 'farmer_payable_amount_positive', { check: 'amount > 0' });
  pgm.addConstraint({ schema: 'money', name: 'farmer_payable' }, 'farmer_payable_one_per_lot', { unique: ['lot_id'] });
  pgm.createIndex({ schema: 'money', name: 'farmer_payable' }, ['tenant_id', 'farmer_id', 'accrued_at']);
  tenantIsolated(pgm, 'farmer_payable');

  pgm.createTable(
    { schema: 'money', name: 'farmer_payment' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: tenantColumn,
      farmer_id: farmerColumn,
      amount: { type: 'numeric(12,2)', notNull: true },
      fee_amount: { type: 'numeric(12,2)', notNull: true, default: 0 },
      method: { type: 'text', notNull: true },
      reference: { type: 'text' },
      notes: { type: 'text' },
      paid_at: { type: 'timestamptz', notNull: true },
      recorded_by: userColumn,
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  pgm.addConstraint({ schema: 'money', name: 'farmer_payment' }, 'farmer_payment_amounts_valid', {
    check: 'amount > 0 AND fee_amount >= 0',
  });
  pgm.addConstraint({ schema: 'money', name: 'farmer_payment' }, 'farmer_payment_method_valid', {
    check: `method IN (${METHODS.map(literal).join(', ')})`,
  });
  pgm.createIndex({ schema: 'money', name: 'farmer_payment' }, ['tenant_id', 'farmer_id', 'paid_at']);
  pgm.createIndex({ schema: 'money', name: 'farmer_payment' }, ['tenant_id', 'paid_at']);
  tenantIsolated(pgm, 'farmer_payment');

  pgm.createTable(
    { schema: 'money', name: 'farmer_payment_allocation' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: tenantColumn,
      payment_id: { type: 'uuid', notNull: true, references: { schema: 'money', name: 'farmer_payment' }, onDelete: 'RESTRICT' },
      payable_id: { type: 'uuid', notNull: true, references: { schema: 'money', name: 'farmer_payable' }, onDelete: 'RESTRICT' },
      amount: { type: 'numeric(12,2)', notNull: true },
      allocated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  pgm.addConstraint({ schema: 'money', name: 'farmer_payment_allocation' }, 'farmer_payment_allocation_positive', {
    check: 'amount > 0',
  });
  pgm.createIndex({ schema: 'money', name: 'farmer_payment_allocation' }, 'payment_id');
  pgm.createIndex({ schema: 'money', name: 'farmer_payment_allocation' }, 'payable_id');
  tenantIsolated(pgm, 'farmer_payment_allocation');
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'money', name: 'farmer_payment_allocation' });
  pgm.dropTable({ schema: 'money', name: 'farmer_payment' });
  pgm.dropTable({ schema: 'money', name: 'farmer_payable' });
};
