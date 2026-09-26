/* eslint-disable camelcase */

// Widens commerce.customer_order's status machine for Logistics — a
// confirmed order's delivery stop on some Trip completing is what drives
// this transition (OrdersService.markDelivered, called from
// LogisticsService, never directly by a client — Constitution I.3-I.4).

exports.shorthands = undefined;

const VALID_STATUSES = ['placed', 'confirmed', 'cancelled', 'delivered'];

exports.up = (pgm) => {
  pgm.dropConstraint({ schema: 'commerce', name: 'customer_order' }, 'customer_order_status_valid');
  pgm.addConstraint({ schema: 'commerce', name: 'customer_order' }, 'customer_order_status_valid', {
    check: `status IN (${VALID_STATUSES.map((s) => `'${s}'`).join(', ')})`,
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint({ schema: 'commerce', name: 'customer_order' }, 'customer_order_status_valid');
  pgm.addConstraint({ schema: 'commerce', name: 'customer_order' }, 'customer_order_status_valid', {
    check: "status IN ('placed', 'confirmed', 'cancelled')",
  });
};
