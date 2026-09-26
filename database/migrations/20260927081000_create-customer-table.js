/* eslint-disable camelcase */

// Domain Model, Trading Partners tier: who the wholesaler sells to.
// Scoped to the core aggregate for this pass — customer_address and
// price-tier linkage (Production Database catalog) are a documented,
// deliberate follow-up, not implemented here.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'trading_partners', name: 'customer' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'tenant', name: 'tenant' },
        onDelete: 'RESTRICT',
      },
      name: { type: 'text', notNull: true },
      contact: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
      credit_limit: { type: 'numeric(12,2)', notNull: true, default: 0 },
      payment_terms_days: { type: 'integer', notNull: true, default: 0 },
      status: { type: 'text', notNull: true, default: 'active' }, // active | archived
      version: { type: 'integer', notNull: true, default: 1 },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      created_by: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'identity', name: 'app_user' },
        onDelete: 'RESTRICT',
      },
    },
  );

  pgm.addConstraint({ schema: 'trading_partners', name: 'customer' }, 'customer_credit_limit_nonnegative', {
    check: 'credit_limit >= 0',
  });
  pgm.addConstraint({ schema: 'trading_partners', name: 'customer' }, 'customer_payment_terms_range', {
    check: 'payment_terms_days >= 0 AND payment_terms_days <= 180',
  });
  pgm.addConstraint({ schema: 'trading_partners', name: 'customer' }, 'customer_status_valid', {
    check: "status IN ('active', 'archived')",
  });

  pgm.createIndex({ schema: 'trading_partners', name: 'customer' }, ['tenant_id', 'name']);
  pgm.sql('ALTER TABLE trading_partners.customer ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE trading_partners.customer FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY customer_tenant_isolation ON trading_partners.customer
      USING (tenant_id = current_tenant_id())
  `);
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'trading_partners', name: 'customer' });
};
