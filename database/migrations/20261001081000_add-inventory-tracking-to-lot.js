/* eslint-disable camelcase */

// Inventory Engine's running balance for a lot, distinct from
// accepted_quantity (the immutable fact of what grading accepted —
// Accounting Engine LOT.2 needs that number to never move). current_quantity
// starts equal to accepted_quantity at grading and is drawn down from there
// by shrinkage/rejectionPostAcceptance — never by reservation, which only
// flags a lot, it doesn't shrink it. current_location_id is nullable: a
// freshly graded lot sits nowhere in particular until Inventory transfers
// it somewhere.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns(
    { schema: 'commerce', name: 'lot' },
    {
      current_quantity: { type: 'numeric(12,3)' },
      current_location_id: {
        type: 'uuid',
        references: { schema: 'stock', name: 'location' },
        onDelete: 'RESTRICT',
      },
    },
  );

  // Backfill: every lot already graded gets its running balance
  // initialized to what grading accepted.
  pgm.sql(`
    UPDATE commerce.lot SET current_quantity = accepted_quantity
    WHERE graded_at IS NOT NULL AND current_quantity IS NULL
  `);

  pgm.addConstraint({ schema: 'commerce', name: 'lot' }, 'lot_current_quantity_set_iff_graded', {
    check: '(graded_at IS NULL AND current_quantity IS NULL) OR (graded_at IS NOT NULL AND current_quantity IS NOT NULL)',
  });
  pgm.addConstraint({ schema: 'commerce', name: 'lot' }, 'lot_current_quantity_range', {
    check: 'current_quantity IS NULL OR (current_quantity >= 0 AND current_quantity <= accepted_quantity)',
  });
  pgm.createIndex({ schema: 'commerce', name: 'lot' }, 'current_location_id');
};

exports.down = (pgm) => {
  pgm.dropConstraint({ schema: 'commerce', name: 'lot' }, 'lot_current_quantity_range');
  pgm.dropConstraint({ schema: 'commerce', name: 'lot' }, 'lot_current_quantity_set_iff_graded');
  pgm.dropColumns({ schema: 'commerce', name: 'lot' }, ['current_quantity', 'current_location_id']);
};
