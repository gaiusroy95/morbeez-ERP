/* eslint-disable camelcase */

// Receivables. An invoice is issued when an order is delivered — not when
// it's placed, since the final quantity is only known at delivery (Domain
// Model, Finance; Event Catalog, Invoice Issued) — or when a finance charge
// accrues on an overdue invoice (Accounting Engine, FC.1). Its due date is
// fixed at issue from the customer's payment terms then in force, so a
// later change to terms never re-dates an existing invoice.
//
// invoice_counter hands out gap-free, per-tenant, per-kind numbers
// (INV-000001, FC-000001) — the one table here the app may UPDATE.
// Invoices and their lines are insert + read only: what an invoice says
// never changes once issued.

exports.shorthands = undefined;

const KINDS = ['sale', 'finance_charge'];
const literal = (value) => `'${value.replace(/'/g, "''")}'`;

const tenantIsolated = (pgm, table) => {
  pgm.sql(`ALTER TABLE money.${table} ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE money.${table} FORCE ROW LEVEL SECURITY`);
  pgm.sql(`CREATE POLICY ${table}_tenant_isolation ON money.${table} USING (tenant_id = current_tenant_id())`);
};

const tenantColumn = { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' };

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'money', name: 'invoice_counter' },
    {
      tenant_id: { ...tenantColumn, primaryKey: true },
      kind: { type: 'text', primaryKey: true },
      last_number: { type: 'integer', notNull: true, default: 0 },
    },
  );
  pgm.addConstraint({ schema: 'money', name: 'invoice_counter' }, 'invoice_counter_kind_valid', {
    check: `kind IN (${KINDS.map(literal).join(', ')})`,
  });
  tenantIsolated(pgm, 'invoice_counter');
  pgm.sql('REVOKE DELETE ON money.invoice_counter FROM morbeez_app');

  pgm.createTable(
    { schema: 'money', name: 'invoice' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: tenantColumn,
      invoice_number: { type: 'text', notNull: true },
      kind: { type: 'text', notNull: true },
      customer_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'trading_partners', name: 'customer' },
        onDelete: 'RESTRICT',
      },
      order_id: { type: 'uuid', references: { schema: 'commerce', name: 'customer_order' }, onDelete: 'RESTRICT' },
      source_invoice_id: { type: 'uuid', references: { schema: 'money', name: 'invoice' }, onDelete: 'RESTRICT' },
      issued_at: { type: 'timestamptz', notNull: true },
      due_date: { type: 'date', notNull: true },
      amount: { type: 'numeric(12,2)', notNull: true },
      created_by: { type: 'uuid', notNull: true, references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  pgm.addConstraint({ schema: 'money', name: 'invoice' }, 'invoice_kind_valid', {
    check: `kind IN (${KINDS.map(literal).join(', ')})`,
  });
  pgm.addConstraint({ schema: 'money', name: 'invoice' }, 'invoice_amount_positive', { check: 'amount > 0' });
  pgm.addConstraint({ schema: 'money', name: 'invoice' }, 'invoice_kind_references', {
    check:
      "(kind = 'sale' AND order_id IS NOT NULL AND source_invoice_id IS NULL) OR " +
      "(kind = 'finance_charge' AND order_id IS NULL AND source_invoice_id IS NOT NULL)",
  });
  pgm.addConstraint({ schema: 'money', name: 'invoice' }, 'invoice_number_unique', {
    unique: ['tenant_id', 'invoice_number'],
  });
  // One sale invoice per order — delivery can't invoice twice.
  pgm.addConstraint({ schema: 'money', name: 'invoice' }, 'invoice_one_per_order', { unique: ['order_id'] });
  pgm.createIndex({ schema: 'money', name: 'invoice' }, ['tenant_id', 'customer_id', 'due_date']);
  tenantIsolated(pgm, 'invoice');
  pgm.sql('REVOKE UPDATE, DELETE ON money.invoice FROM morbeez_app');

  pgm.createTable(
    { schema: 'money', name: 'invoice_line' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: tenantColumn,
      invoice_id: { type: 'uuid', notNull: true, references: { schema: 'money', name: 'invoice' }, onDelete: 'RESTRICT' },
      order_line_id: {
        type: 'uuid',
        references: { schema: 'commerce', name: 'customer_order_line' },
        onDelete: 'RESTRICT',
      },
      product_id: { type: 'uuid', references: { schema: 'trading_partners', name: 'product' }, onDelete: 'RESTRICT' },
      description: { type: 'text', notNull: true },
      quantity: { type: 'numeric(12,3)', notNull: true },
      unit_price: { type: 'numeric(12,2)', notNull: true },
      amount: { type: 'numeric(12,2)', notNull: true },
    },
  );
  pgm.addConstraint({ schema: 'money', name: 'invoice_line' }, 'invoice_line_amount_nonnegative', {
    check: 'quantity > 0 AND unit_price >= 0 AND amount >= 0',
  });
  pgm.createIndex({ schema: 'money', name: 'invoice_line' }, 'invoice_id');
  tenantIsolated(pgm, 'invoice_line');
  pgm.sql('REVOKE UPDATE, DELETE ON money.invoice_line FROM morbeez_app');
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'money', name: 'invoice_line' });
  pgm.dropTable({ schema: 'money', name: 'invoice' });
  pgm.dropTable({ schema: 'money', name: 'invoice_counter' });
};
