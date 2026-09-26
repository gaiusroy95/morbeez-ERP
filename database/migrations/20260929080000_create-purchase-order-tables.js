/* eslint-disable camelcase */

// Procurement context (Domain Model, Tier 02 — Commerce): the buying
// decision, start to goods-received handoff. Status values match the
// Procurement lifecycle already defined in Workflow States exactly
// (placed, confirmed, cancelled, received, graded, closed) — "awaiting
// approval" is deliberately not a seventh status; it's a property of a
// placed order (approval_request_id set and not yet resolved), checked
// at the placed -> confirmed transition, not a state of its own.

exports.shorthands = undefined;

const VALID_STATUSES = ['placed', 'confirmed', 'cancelled', 'received', 'graded', 'closed'];

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'commerce', name: 'purchase_order' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'tenant', name: 'tenant' },
        onDelete: 'RESTRICT',
      },
      farmer_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'trading_partners', name: 'farmer' },
        onDelete: 'RESTRICT',
      },
      status: { type: 'text', notNull: true, default: 'placed' },
      expected_delivery_date: { type: 'date' },
      // Set when Approvals says this order's estimated value needs
      // sign-off before it can be confirmed (System Architecture,
      // Approvals). Null means either no approval was required, or none
      // has been requested yet.
      approval_request_id: { type: 'uuid', references: { schema: 'approvals', name: 'approval_request' }, onDelete: 'RESTRICT' },
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
  pgm.addConstraint({ schema: 'commerce', name: 'purchase_order' }, 'purchase_order_status_valid', {
    check: `status IN (${VALID_STATUSES.map((s) => `'${s}'`).join(', ')})`,
  });
  pgm.createIndex({ schema: 'commerce', name: 'purchase_order' }, ['tenant_id', 'status']);
  pgm.createIndex({ schema: 'commerce', name: 'purchase_order' }, ['tenant_id', 'farmer_id']);
  pgm.sql('ALTER TABLE commerce.purchase_order ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE commerce.purchase_order FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY purchase_order_tenant_isolation ON commerce.purchase_order
      USING (tenant_id = current_tenant_id())
  `);

  pgm.createTable(
    { schema: 'commerce', name: 'purchase_order_line' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      purchase_order_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'commerce', name: 'purchase_order' },
        onDelete: 'CASCADE',
      },
      product_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'trading_partners', name: 'product' },
        onDelete: 'RESTRICT',
      },
      expected_quantity: { type: 'numeric(12,3)', notNull: true },
      // The agreed rate at ordering time — distinct from lot.unit_cost,
      // the grade-adjusted final rate fixed at grading (Accounting
      // Engine, LOT.2). This is the "Purchase rates" the order was
      // placed against, not necessarily what's finally paid.
      indicative_price: { type: 'numeric(12,2)', notNull: true },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  pgm.addConstraint({ schema: 'commerce', name: 'purchase_order_line' }, 'purchase_order_line_quantity_positive', {
    check: 'expected_quantity > 0',
  });
  pgm.addConstraint({ schema: 'commerce', name: 'purchase_order_line' }, 'purchase_order_line_price_nonnegative', {
    check: 'indicative_price >= 0',
  });
  pgm.createIndex(
    { schema: 'commerce', name: 'purchase_order_line' },
    'purchase_order_id',
  );
  // No RLS of its own — reachable only by joining through purchase_order,
  // which is itself RLS-protected (same pattern as identity.role_permission).
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'commerce', name: 'purchase_order_line' });
  pgm.dropTable({ schema: 'commerce', name: 'purchase_order' });
};
