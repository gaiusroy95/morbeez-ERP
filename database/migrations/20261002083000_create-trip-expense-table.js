/* eslint-disable camelcase */

// Ad hoc trip costs — same "reachable only through its parent trip"
// pattern as trip_stop. Ordinary DML grants (not insert-only): unlike a
// released farmer settlement or a filed reconciliation, an expense
// recorded mid-trip is a working log a dispatcher may reasonably need to
// correct before the trip is reconciled — this migration doesn't lock
// that down, though the current API surface only exposes create + list.

exports.shorthands = undefined;

const VALID_CATEGORIES = ['fuel', 'toll', 'labour', 'other'];

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'fulfilment', name: 'trip_expense' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      trip_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'fulfilment', name: 'trip' },
        onDelete: 'CASCADE',
      },
      category: { type: 'text', notNull: true },
      amount: { type: 'numeric(12,2)', notNull: true },
      notes: { type: 'text' },
      recorded_by: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'identity', name: 'app_user' },
        onDelete: 'RESTRICT',
      },
      recorded_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  pgm.addConstraint({ schema: 'fulfilment', name: 'trip_expense' }, 'trip_expense_category_valid', {
    check: `category IN (${VALID_CATEGORIES.map((c) => `'${c}'`).join(', ')})`,
  });
  pgm.addConstraint({ schema: 'fulfilment', name: 'trip_expense' }, 'trip_expense_amount_positive', {
    check: 'amount > 0',
  });
  pgm.createIndex({ schema: 'fulfilment', name: 'trip_expense' }, 'trip_id');
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'fulfilment', name: 'trip_expense' });
};
