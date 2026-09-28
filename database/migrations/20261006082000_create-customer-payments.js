/* eslint-disable camelcase */

// Collections — money received from customers (Event Catalog, Payment
// Received), from any channel: cash handed to a driver at a delivery stop
// (linked to the Logistics capture, money.customer_collection), or a UPI,
// bank transfer, or cheque received at the office.
//
// A payment is applied to invoices through customer_payment_allocation —
// oldest due first unless the payer said which invoices. Whatever isn't
// applied stays on the customer's account as credit and is applied to
// their next invoice when it's issued. fee_amount is what the channel kept
// (gateway/bank charges): the customer is credited the full amount, the
// bank receives amount − fee, and the fee is a finance cost.
//
// A bounced cheque or a charged-back UPI is a customer_payment_reversal —
// never a delete. Allocations of a reversed payment stop counting (the
// balance views exclude them), so the invoices it paid fall due again.

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

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'money', name: 'customer_payment' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: tenantColumn,
      customer_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'trading_partners', name: 'customer' },
        onDelete: 'RESTRICT',
      },
      amount: { type: 'numeric(12,2)', notNull: true },
      fee_amount: { type: 'numeric(12,2)', notNull: true, default: 0 },
      method: { type: 'text', notNull: true },
      reference: { type: 'text' },
      notes: { type: 'text' },
      collection_id: {
        type: 'uuid',
        references: { schema: 'money', name: 'customer_collection' },
        onDelete: 'RESTRICT',
      },
      received_at: { type: 'timestamptz', notNull: true },
      recorded_by: userColumn,
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  pgm.addConstraint({ schema: 'money', name: 'customer_payment' }, 'customer_payment_amounts_valid', {
    check: 'amount > 0 AND fee_amount >= 0 AND fee_amount < amount',
  });
  pgm.addConstraint({ schema: 'money', name: 'customer_payment' }, 'customer_payment_method_valid', {
    check: `method IN (${METHODS.map(literal).join(', ')})`,
  });
  // A trip collection becomes exactly one payment.
  pgm.addConstraint({ schema: 'money', name: 'customer_payment' }, 'customer_payment_one_per_collection', {
    unique: ['collection_id'],
  });
  pgm.createIndex({ schema: 'money', name: 'customer_payment' }, ['tenant_id', 'customer_id', 'received_at']);
  pgm.createIndex({ schema: 'money', name: 'customer_payment' }, ['tenant_id', 'received_at']);
  tenantIsolated(pgm, 'customer_payment');

  pgm.createTable(
    { schema: 'money', name: 'customer_payment_allocation' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: tenantColumn,
      payment_id: { type: 'uuid', notNull: true, references: { schema: 'money', name: 'customer_payment' }, onDelete: 'RESTRICT' },
      invoice_id: { type: 'uuid', notNull: true, references: { schema: 'money', name: 'invoice' }, onDelete: 'RESTRICT' },
      amount: { type: 'numeric(12,2)', notNull: true },
      allocated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  pgm.addConstraint({ schema: 'money', name: 'customer_payment_allocation' }, 'customer_payment_allocation_positive', {
    check: 'amount > 0',
  });
  pgm.createIndex({ schema: 'money', name: 'customer_payment_allocation' }, 'payment_id');
  pgm.createIndex({ schema: 'money', name: 'customer_payment_allocation' }, 'invoice_id');
  tenantIsolated(pgm, 'customer_payment_allocation');

  pgm.createTable(
    { schema: 'money', name: 'customer_payment_reversal' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: tenantColumn,
      payment_id: { type: 'uuid', notNull: true, references: { schema: 'money', name: 'customer_payment' }, onDelete: 'RESTRICT' },
      reason: { type: 'text', notNull: true },
      reversed_by: userColumn,
      reversed_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  pgm.addConstraint({ schema: 'money', name: 'customer_payment_reversal' }, 'customer_payment_reversal_once', {
    unique: ['payment_id'],
  });
  tenantIsolated(pgm, 'customer_payment_reversal');
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'money', name: 'customer_payment_reversal' });
  pgm.dropTable({ schema: 'money', name: 'customer_payment_allocation' });
  pgm.dropTable({ schema: 'money', name: 'customer_payment' });
};
