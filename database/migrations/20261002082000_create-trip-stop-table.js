/* eslint-disable camelcase */

// The Route — no tenant_id/RLS of its own, reachable only through its
// parent trip (same pattern as purchase_order_line / customer_order_line):
// a stop is always looked up by trip_id, and the trip itself is already
// tenant-scoped.

exports.shorthands = undefined;

const VALID_STOP_TYPES = ['pickup', 'delivery'];
const VALID_STATUSES = ['pending', 'completed', 'skipped'];

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'fulfilment', name: 'trip_stop' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      trip_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'fulfilment', name: 'trip' },
        onDelete: 'CASCADE',
      },
      sequence_number: { type: 'integer', notNull: true },
      stop_type: { type: 'text', notNull: true },
      pickup_id: {
        type: 'uuid',
        references: { schema: 'commerce', name: 'pickup' },
        onDelete: 'RESTRICT',
      },
      order_id: {
        type: 'uuid',
        references: { schema: 'commerce', name: 'customer_order' },
        onDelete: 'RESTRICT',
      },
      status: { type: 'text', notNull: true, default: 'pending' },
      arrived_at: { type: 'timestamptz' },
      completed_at: { type: 'timestamptz' },
      notes: { type: 'text' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  pgm.addConstraint('trip_stop', 'trip_stop_type_valid', {
    check: `stop_type IN (${VALID_STOP_TYPES.map((t) => `'${t}'`).join(', ')})`,
    schema: 'fulfilment',
  });
  pgm.addConstraint('trip_stop', 'trip_stop_status_valid', {
    check: `status IN (${VALID_STATUSES.map((s) => `'${s}'`).join(', ')})`,
    schema: 'fulfilment',
  });
  pgm.addConstraint('trip_stop', 'trip_stop_pickup_xor_order', {
    check: "(stop_type = 'pickup' AND pickup_id IS NOT NULL AND order_id IS NULL) OR " +
      "(stop_type = 'delivery' AND order_id IS NOT NULL AND pickup_id IS NULL)",
    schema: 'fulfilment',
  });
  pgm.addConstraint('trip_stop', 'trip_stop_sequence_unique_per_trip', {
    unique: ['trip_id', 'sequence_number'],
    schema: 'fulfilment',
  });
  pgm.createIndex({ schema: 'fulfilment', name: 'trip_stop' }, 'trip_id');
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'fulfilment', name: 'trip_stop' });
};
