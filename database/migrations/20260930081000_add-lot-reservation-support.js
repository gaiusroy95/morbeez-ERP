/* eslint-disable camelcase */

// Wires Orders' Reservation feature into Procurement's Lot — anticipated
// in commerce.lot's own original migration comment ("reserved/... are
// transitions later modules (Orders, ...) will add once they exist").
// Deliberately whole-lot: an order line claims one or more entire
// available lots (oldest received_at first) until its requested quantity
// is covered, never a fraction of one — a lot stays a single, specific-cost
// unit end to end (Accounting Engine LOT.2), so there is nothing to split.

exports.shorthands = undefined;

const VALID_STATUSES = ['received_ungraded', 'available', 'reserved', 'rejected'];

exports.up = (pgm) => {
  pgm.addColumn(
    { schema: 'commerce', name: 'lot' },
    {
      reserved_for_order_line_id: {
        type: 'uuid',
        references: { schema: 'commerce', name: 'customer_order_line' },
        onDelete: 'RESTRICT',
      },
    },
  );

  pgm.dropConstraint({ schema: 'commerce', name: 'lot' }, 'lot_status_valid');
  pgm.addConstraint({ schema: 'commerce', name: 'lot' }, 'lot_status_valid', {
    check: `status IN (${VALID_STATUSES.map((s) => `'${s}'`).join(', ')})`,
  });
  pgm.addConstraint({ schema: 'commerce', name: 'lot' }, 'lot_reserved_iff_flagged', {
    check: "(status = 'reserved') = (reserved_for_order_line_id IS NOT NULL)",
  });
  pgm.createIndex({ schema: 'commerce', name: 'lot' }, 'reserved_for_order_line_id');
};

exports.down = (pgm) => {
  pgm.dropConstraint({ schema: 'commerce', name: 'lot' }, 'lot_reserved_iff_flagged');
  pgm.dropConstraint({ schema: 'commerce', name: 'lot' }, 'lot_status_valid');
  pgm.addConstraint({ schema: 'commerce', name: 'lot' }, 'lot_status_valid', {
    check: "status IN ('received_ungraded', 'available', 'rejected')",
  });
  pgm.dropColumn({ schema: 'commerce', name: 'lot' }, 'reserved_for_order_line_id');
};
