/* eslint-disable camelcase */

// Closes out a trip's cash float — one per trip (UNIQUE trip_id), and,
// like money.farmer_settlement, a historical fact recorded once and never
// edited.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'fulfilment', name: 'trip_reconciliation' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      trip_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'fulfilment', name: 'trip' },
        onDelete: 'RESTRICT',
      },
      advance_amount: { type: 'numeric(12,2)', notNull: true },
      total_expenses: { type: 'numeric(12,2)', notNull: true },
      cash_returned: { type: 'numeric(12,2)', notNull: true },
      variance: { type: 'numeric(12,2)', notNull: true },
      notes: { type: 'text' },
      reconciled_by: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'identity', name: 'app_user' },
        onDelete: 'RESTRICT',
      },
      reconciled_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  pgm.addConstraint('trip_reconciliation', 'trip_reconciliation_one_per_trip', {
    unique: ['trip_id'],
    schema: 'fulfilment',
  });
  pgm.addConstraint('trip_reconciliation', 'trip_reconciliation_amounts_nonnegative', {
    check: 'advance_amount >= 0 AND total_expenses >= 0 AND cash_returned >= 0',
    schema: 'fulfilment',
  });
  // Insert + read only — same posture as money.farmer_settlement.
  pgm.sql('REVOKE UPDATE, DELETE ON fulfilment.trip_reconciliation FROM morbeez_app');
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'fulfilment', name: 'trip_reconciliation' });
};
