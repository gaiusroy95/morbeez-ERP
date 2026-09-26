/* eslint-disable camelcase */

// Driver-captured photos — pickup condition, delivery/POD evidence, or an
// issue report. No tenant_id/RLS of its own, reachable only through its
// parent stop (same pattern as trip_stop/trip_expense): always looked up
// by trip_stop_id, and the trip itself is already tenant-scoped.
// storage_key is a relative path under UPLOADS_DIR in this dev-local
// implementation — swapping to S3 changes what that string means, not
// this table's shape (Technology Stack §04/05).

exports.shorthands = undefined;

const VALID_PHOTO_TYPES = ['pickup', 'delivery', 'pod', 'issue'];

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'fulfilment', name: 'trip_stop_photo' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      trip_stop_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'fulfilment', name: 'trip_stop' },
        onDelete: 'CASCADE',
      },
      photo_type: { type: 'text', notNull: true },
      storage_key: { type: 'text', notNull: true },
      content_type: { type: 'text', notNull: true },
      size_bytes: { type: 'integer', notNull: true },
      taken_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      created_by: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'identity', name: 'app_user' },
        onDelete: 'RESTRICT',
      },
    },
  );
  pgm.addConstraint({ schema: 'fulfilment', name: 'trip_stop_photo' }, 'trip_stop_photo_type_valid', {
    check: `photo_type IN (${VALID_PHOTO_TYPES.map((t) => `'${t}'`).join(', ')})`,
  });
  pgm.addConstraint({ schema: 'fulfilment', name: 'trip_stop_photo' }, 'trip_stop_photo_size_positive', {
    check: 'size_bytes > 0',
  });
  pgm.createIndex({ schema: 'fulfilment', name: 'trip_stop_photo' }, ['trip_stop_id', 'photo_type']);
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'fulfilment', name: 'trip_stop_photo' });
};
