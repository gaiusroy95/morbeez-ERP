/* eslint-disable camelcase */

// Delivery now consumes the lots reserved for an order: reserved ->
// delivered (Inventory Engine's terminal state for sold stock). Until now a
// delivered order's lots stayed 'reserved' forever, so every stock figure
// had to special-case them. A delivered lot keeps reserved_for_order_line_id
// — that link is how cost of goods finds the specific lot a line was
// filled from (Accounting Engine LOT.1).

exports.shorthands = undefined;

const LOT = { schema: 'commerce', name: 'lot' };
const WITH_DELIVERED = ['received_ungraded', 'available', 'reserved', 'delivered', 'rejected'];
const WITHOUT_DELIVERED = ['received_ungraded', 'available', 'reserved', 'rejected'];
const inList = (values) => values.map((v) => `'${v}'`).join(', ');

exports.up = (pgm) => {
  pgm.dropConstraint(LOT, 'lot_reserved_iff_flagged');
  pgm.dropConstraint(LOT, 'lot_status_valid');
  pgm.addConstraint(LOT, 'lot_status_valid', { check: `status IN (${inList(WITH_DELIVERED)})` });

  // Lots already reserved for orders that were delivered before this
  // migration existed.
  pgm.sql(`
    UPDATE commerce.lot l SET status = 'delivered', version = l.version + 1, updated_at = now()
    FROM commerce.customer_order_line ol
    JOIN commerce.customer_order o ON o.id = ol.order_id
    WHERE l.reserved_for_order_line_id = ol.id AND o.status = 'delivered' AND l.status = 'reserved'
  `);

  pgm.addConstraint(LOT, 'lot_reserved_iff_flagged', {
    check: "(status IN ('reserved', 'delivered')) = (reserved_for_order_line_id IS NOT NULL)",
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint(LOT, 'lot_reserved_iff_flagged');
  pgm.sql(`UPDATE commerce.lot SET status = 'reserved' WHERE status = 'delivered'`);
  pgm.dropConstraint(LOT, 'lot_status_valid');
  pgm.addConstraint(LOT, 'lot_status_valid', { check: `status IN (${inList(WITHOUT_DELIVERED)})` });
  pgm.addConstraint(LOT, 'lot_reserved_iff_flagged', {
    check: "(status = 'reserved') = (reserved_for_order_line_id IS NOT NULL)",
  });
};
