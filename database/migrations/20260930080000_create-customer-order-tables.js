/* eslint-disable camelcase */

// Domain Model, Orders bounded context. Mirrors the purchase_order /
// purchase_order_line shape from Procurement (commerce tier, same schema)
// — a header row plus line items, no persisted total (computed on demand,
// same reasoning as purchase_order: an indicative/derived figure has no
// business being a column that can drift from its inputs).
//
// 'awaiting approval' is, again, not its own status — it's a placed order
// with approval_request_id set and not yet resolved (mirrors Procurement).

exports.shorthands = undefined;

const VALID_STATUSES = ['placed', 'confirmed', 'cancelled'];

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'commerce', name: 'customer_order' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'tenant', name: 'tenant' },
        onDelete: 'RESTRICT',
      },
      customer_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'trading_partners', name: 'customer' },
        onDelete: 'RESTRICT',
      },
      status: { type: 'text', notNull: true, default: 'placed' },
      approval_request_id: {
        type: 'uuid',
        references: { schema: 'approvals', name: 'approval_request' },
        onDelete: 'RESTRICT',
      },
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
  pgm.addConstraint({ schema: 'commerce', name: 'customer_order' }, 'customer_order_status_valid', {
    check: `status IN (${VALID_STATUSES.map((s) => `'${s}'`).join(', ')})`,
  });
  pgm.createIndex({ schema: 'commerce', name: 'customer_order' }, ['tenant_id', 'status']);
  pgm.createIndex({ schema: 'commerce', name: 'customer_order' }, ['tenant_id', 'customer_id']);
  pgm.sql('ALTER TABLE commerce.customer_order ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE commerce.customer_order FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY customer_order_tenant_isolation ON commerce.customer_order
      USING (tenant_id = current_tenant_id())
  `);

  pgm.createTable(
    { schema: 'commerce', name: 'customer_order_line' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      order_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'commerce', name: 'customer_order' },
        onDelete: 'CASCADE',
      },
      product_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'trading_partners', name: 'product' },
        onDelete: 'RESTRICT',
      },
      quantity: { type: 'numeric(12,3)', notNull: true },
      unit_price: { type: 'numeric(12,2)', notNull: true },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  pgm.addConstraint({ schema: 'commerce', name: 'customer_order_line' }, 'customer_order_line_quantity_positive', {
    check: 'quantity > 0',
  });
  pgm.addConstraint({ schema: 'commerce', name: 'customer_order_line' }, 'customer_order_line_unit_price_nonnegative', {
    check: 'unit_price >= 0',
  });
  pgm.createIndex({ schema: 'commerce', name: 'customer_order_line' }, 'order_id');
  // No RLS of its own — reachable only via its parent order (same pattern
  // as purchase_order_line).
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'commerce', name: 'customer_order_line' });
  pgm.dropTable({ schema: 'commerce', name: 'customer_order' });
};
