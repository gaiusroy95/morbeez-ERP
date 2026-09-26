/* eslint-disable camelcase */

// The specific-identification costing unit (Accounting Engine, LOT.1) and
// the FEFO/state-tracking unit (Inventory Engine). Status here is
// deliberately narrower than the Inventory Engine's full nine-state
// machine — reserved/in_transit/damaged_hold/written_off/delivered are
// transitions later modules (Orders, Logistics, Inventory itself) will
// add once they exist; Procurement only ever produces a lot in one of
// three states: freshly received and not yet graded, available (accepted
// at grading), or rejected (at grading).

exports.shorthands = undefined;

const VALID_STATUSES = ['received_ungraded', 'available', 'rejected'];

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'commerce', name: 'lot' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'tenant', name: 'tenant' },
        onDelete: 'RESTRICT',
      },
      purchase_order_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'commerce', name: 'purchase_order' },
        onDelete: 'RESTRICT',
      },
      farmer_id: {
        // Denormalized from purchase_order — a lot outlives argument
        // changes to its PO's other lines and this makes farmer-level
        // reporting a direct query, not a join through every caller.
        type: 'uuid',
        notNull: true,
        references: { schema: 'trading_partners', name: 'farmer' },
        onDelete: 'RESTRICT',
      },
      product_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'trading_partners', name: 'product' },
        onDelete: 'RESTRICT',
      },
      pickup_id: { type: 'uuid' }, // FK added once commerce.pickup exists (next migration)
      received_quantity: { type: 'numeric(12,3)', notNull: true },
      accepted_quantity: { type: 'numeric(12,3)' }, // null until graded
      rejected_quantity: { type: 'numeric(12,3)' }, // null until graded
      grade: { type: 'text' }, // e.g. 'A' | 'B' | 'C' — null until graded
      rejection_reason: { type: 'text' },
      unit_cost: { type: 'numeric(12,2)' }, // the final, grade-adjusted rate — null until graded, then fixed for good (Accounting Engine, LOT.2)
      status: { type: 'text', notNull: true, default: 'received_ungraded' },
      received_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      graded_at: { type: 'timestamptz' },
      graded_by: { type: 'uuid', references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' },
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
  pgm.addConstraint('lot', 'lot_status_valid', {
    check: `status IN (${VALID_STATUSES.map((s) => `'${s}'`).join(', ')})`,
    schema: 'commerce',
  });
  pgm.addConstraint('lot', 'lot_received_quantity_positive', {
    check: 'received_quantity > 0',
    schema: 'commerce',
  });
  pgm.addConstraint('lot', 'lot_grading_reconciles', {
    // Only enforced once graded — the whole point of LOT.2's cost-fixed
    // discipline is that once these numbers exist, they're right.
    check: 'graded_at IS NULL OR (accepted_quantity + rejected_quantity = received_quantity)',
    schema: 'commerce',
  });
  pgm.addConstraint('lot', 'lot_unit_cost_set_iff_graded', {
    check: "(graded_at IS NULL AND unit_cost IS NULL) OR (graded_at IS NOT NULL AND (unit_cost IS NOT NULL OR status = 'rejected'))",
    schema: 'commerce',
  });
  pgm.createIndex({ schema: 'commerce', name: 'lot' }, ['tenant_id', 'status']);
  pgm.createIndex({ schema: 'commerce', name: 'lot' }, ['tenant_id', 'product_id', 'graded_at']);
  pgm.createIndex({ schema: 'commerce', name: 'lot' }, 'purchase_order_id');
  pgm.sql('ALTER TABLE commerce.lot ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE commerce.lot FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY lot_tenant_isolation ON commerce.lot
      USING (tenant_id = current_tenant_id())
  `);
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'commerce', name: 'lot' });
};
