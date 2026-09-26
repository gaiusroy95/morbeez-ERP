/* eslint-disable camelcase */

// Domain Model, Trading Partners & Catalog tier: what can be bought or
// sold, and in what units (Constitution II.2 — unit-of-measure is
// centralized, never ad hoc). category_id/product_category from the
// Production Database catalog is a documented follow-up — this pass uses
// a plain text category, not a normalized FK, to avoid standing up a
// table this module doesn't yet need.

exports.shorthands = undefined;

const VALID_UOMS = ['kg', 'g', 'crate', 'bag', 'dozen', 'unit'];

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'trading_partners', name: 'product' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'tenant', name: 'tenant' },
        onDelete: 'RESTRICT',
      },
      name: { type: 'text', notNull: true },
      category: { type: 'text' },
      base_uom: { type: 'text', notNull: true },
      base_price: { type: 'numeric(10,2)', notNull: true, default: 0 },
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

  pgm.addConstraint('product', 'product_base_uom_valid', {
    check: `base_uom IN (${VALID_UOMS.map((u) => `'${u}'`).join(', ')})`,
    schema: 'trading_partners',
  });
  pgm.addConstraint('product', 'product_base_price_nonnegative', {
    check: 'base_price >= 0',
    schema: 'trading_partners',
  });
  pgm.addConstraint('product', 'product_status_valid', {
    check: "status IN ('active', 'archived')",
    schema: 'trading_partners',
  });

  pgm.createIndex({ schema: 'trading_partners', name: 'product' }, ['tenant_id', 'name']);
  pgm.sql('ALTER TABLE trading_partners.product ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE trading_partners.product FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY product_tenant_isolation ON trading_partners.product
      USING (tenant_id = current_tenant_id())
  `);
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'trading_partners', name: 'product' });
};
