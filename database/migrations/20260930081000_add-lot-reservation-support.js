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

  pgm.dropConstraint('lot', 'lot_status_valid', { schema: 'commerce' });
  pgm.addConstraint('lot', 'lot_status_valid', {
    check: `status IN (${VALID_STATUSES.map((s) => `'${s}'`).join(', ')})`,
    schema: 'commerce',
  });
  pgm.addConstraint('lot', 'lot_reserved_iff_flagged', {
    check: "(status = 'reserved') = (reserved_for_order_line_id IS NOT NULL)",
    schema: 'commerce',
  });
  pgm.createIndex({ schema: 'commerce', name: 'lot' }, 'reserved_for_order_line_id');
};

exports.down = (pgm) => {
  pgm.dropConstraint('lot', 'lot_reserved_iff_flagged', { schema: 'commerce' });
  pgm.dropConstraint('lot', 'lot_status_valid', { schema: 'commerce' });
  pgm.addConstraint('lot', 'lot_status_valid', {
    check: "status IN ('received_ungraded', 'available', 'rejected')",
    schema: 'commerce',
  });
  pgm.dropColumn({ schema: 'commerce', name: 'lot' }, 'reserved_for_order_line_id');
};
