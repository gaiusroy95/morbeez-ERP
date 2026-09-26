/* eslint-disable camelcase */

// Proof of delivery — one per delivery stop, filed the moment
// completeDeliveryStop succeeds. Historical fact, never edited (same
// posture as money.farmer_settlement / fulfilment.trip_reconciliation).
// signature_data is nullable because a photo (trip_stop_photo with
// photo_type = 'pod') can satisfy proof on its own — LogisticsService
// requires at least one of the two, not both.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'fulfilment', name: 'trip_stop_pod' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      trip_stop_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'fulfilment', name: 'trip_stop' },
        onDelete: 'RESTRICT',
      },
      recipient_name: { type: 'text', notNull: true },
      signature_data: { type: 'text' },
      captured_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      captured_by: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'identity', name: 'app_user' },
        onDelete: 'RESTRICT',
      },
    },
  );
  pgm.addConstraint('trip_stop_pod', 'trip_stop_pod_one_per_stop', {
    unique: ['trip_stop_id'],
    schema: 'fulfilment',
  });
  // Insert + read only — same posture as money.farmer_settlement.
  pgm.sql('REVOKE UPDATE, DELETE ON fulfilment.trip_stop_pod FROM morbeez_app');
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'fulfilment', name: 'trip_stop_pod' });
};
