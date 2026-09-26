/* eslint-disable camelcase */

// The collection trip that brings a farmer's produce to the warehouse —
// distinct from Goods Received/lot creation, which is what happens once
// it arrives. Vehicle and driver are optional at scheduling time (often
// assigned later, against the day's route) but required to mark a pickup
// complete.

exports.shorthands = undefined;

const VALID_STATUSES = ['scheduled', 'completed', 'cancelled'];

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'commerce', name: 'pickup' },
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
        type: 'uuid',
        notNull: true,
        references: { schema: 'trading_partners', name: 'farmer' },
        onDelete: 'RESTRICT',
      },
      vehicle_id: {
        type: 'uuid',
        references: { schema: 'trading_partners', name: 'vehicle' },
        onDelete: 'RESTRICT',
      },
      driver_employee_id: {
        type: 'uuid',
        references: { schema: 'trading_partners', name: 'employee' },
        onDelete: 'RESTRICT',
      },
      status: { type: 'text', notNull: true, default: 'scheduled' },
      scheduled_at: { type: 'timestamptz' },
      picked_up_at: { type: 'timestamptz' },
      notes: { type: 'text' },
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
  pgm.addConstraint({ schema: 'commerce', name: 'pickup' }, 'pickup_status_valid', {
    check: `status IN (${VALID_STATUSES.map((s) => `'${s}'`).join(', ')})`,
  });
  pgm.addConstraint({ schema: 'commerce', name: 'pickup' }, 'pickup_completed_requires_vehicle_and_driver', {
    check: "status <> 'completed' OR (vehicle_id IS NOT NULL AND driver_employee_id IS NOT NULL AND picked_up_at IS NOT NULL)",
  });
  pgm.createIndex({ schema: 'commerce', name: 'pickup' }, ['tenant_id', 'status']);
  pgm.createIndex({ schema: 'commerce', name: 'pickup' }, 'purchase_order_id');
  pgm.sql('ALTER TABLE commerce.pickup ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE commerce.pickup FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY pickup_tenant_isolation ON commerce.pickup
      USING (tenant_id = current_tenant_id())
  `);

  // Wired back now that commerce.pickup exists.
  pgm.sql(`
    ALTER TABLE commerce.lot
      ADD CONSTRAINT lot_pickup_fk
      FOREIGN KEY (pickup_id)
      REFERENCES commerce.pickup(id)
      ON DELETE RESTRICT
  `);
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE commerce.lot DROP CONSTRAINT lot_pickup_fk');
  pgm.dropTable({ schema: 'commerce', name: 'pickup' });
};
