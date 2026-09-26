/* eslint-disable camelcase */

// The Inventory Engine's own movement ledger — an insert-only historical
// record of the three kinds of stock movement this module introduces
// (shrinkage, a post-acceptance quality rejection, and a transfer between
// locations). Deliberately does NOT duplicate receive/grade/reserve/release
// — those already have a complete record in infra.audit_log via
// Procurement's own transactions; this ledger only needs to cover the new
// movement types Inventory itself orchestrates.

exports.shorthands = undefined;

const VALID_MOVEMENT_TYPES = ['shrinkage', 'rejected_post_acceptance', 'transferred'];

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'stock', name: 'inventory_movement' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'tenant', name: 'tenant' },
        onDelete: 'RESTRICT',
      },
      lot_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'commerce', name: 'lot' },
        onDelete: 'RESTRICT',
      },
      product_id: {
        // Denormalized from lot, same reasoning as lot.farmer_id —
        // product-level movement history is a direct query, not a join.
        type: 'uuid',
        notNull: true,
        references: { schema: 'trading_partners', name: 'product' },
        onDelete: 'RESTRICT',
      },
      movement_type: { type: 'text', notNull: true },
      quantity: { type: 'numeric(12,3)', notNull: true },
      reason: { type: 'text' },
      from_location_id: {
        type: 'uuid',
        references: { schema: 'stock', name: 'location' },
        onDelete: 'RESTRICT',
      },
      to_location_id: {
        type: 'uuid',
        references: { schema: 'stock', name: 'location' },
        onDelete: 'RESTRICT',
      },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      created_by: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'identity', name: 'app_user' },
        onDelete: 'RESTRICT',
      },
    },
  );
  pgm.addConstraint('inventory_movement', 'inventory_movement_type_valid', {
    check: `movement_type IN (${VALID_MOVEMENT_TYPES.map((t) => `'${t}'`).join(', ')})`,
    schema: 'stock',
  });
  pgm.addConstraint('inventory_movement', 'inventory_movement_quantity_positive', {
    check: 'quantity > 0',
    schema: 'stock',
  });
  pgm.addConstraint('inventory_movement', 'inventory_movement_transfer_has_locations', {
    check: "movement_type <> 'transferred' OR (from_location_id IS NOT NULL OR to_location_id IS NOT NULL)",
    schema: 'stock',
  });
  pgm.createIndex({ schema: 'stock', name: 'inventory_movement' }, ['tenant_id', 'lot_id']);
  pgm.createIndex({ schema: 'stock', name: 'inventory_movement' }, ['tenant_id', 'product_id', 'created_at']);
  pgm.sql('ALTER TABLE stock.inventory_movement ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE stock.inventory_movement FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY inventory_movement_tenant_isolation ON stock.inventory_movement
      USING (tenant_id = current_tenant_id())
  `);
  // A ledger entry is a historical fact, recorded once, never edited —
  // same insert-only posture as money.farmer_settlement.
  pgm.sql('REVOKE UPDATE, DELETE ON stock.inventory_movement FROM morbeez_app');
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'stock', name: 'inventory_movement' });
};
