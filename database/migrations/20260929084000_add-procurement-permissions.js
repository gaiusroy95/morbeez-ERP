/* eslint-disable camelcase */

// Four, not two — grading and settlement are deliberately separable from
// ordinary purchase-order write access. A tenant can hand "create and
// confirm orders" to Operations Manager while keeping "who decides what
// grade this is" and "who releases payment" with different people —
// segregation of duties, the same spirit as Accounting Engine's CN.4 and
// this session's own approval framework.

exports.shorthands = undefined;

const PERMISSIONS = [
  ['procurement:read', 'View purchase orders, pickups, and lots'],
  ['procurement:write', 'Create, confirm, cancel purchase orders; schedule and complete pickups; record goods received'],
  ['procurement:grade', 'Grade a received lot — assign quality, accept/reject quantity, fix unit cost'],
  ['procurement:settle', 'Record a farmer settlement against a graded lot'],
];

// Constants from this file, never user input — quoted as SQL literals
// because pgm.sql's second argument is a {name} template map, not bind
// parameters.
const literal = (value) => `'${value.replace(/'/g, "''")}'`;

exports.up = (pgm) => {
  const rows = PERMISSIONS.map(([code, description]) => `(${literal(code)}, ${literal(description)})`);
  pgm.sql(
    `INSERT INTO identity.permission (code, description) VALUES ${rows.join(', ')}
     ON CONFLICT (code) DO NOTHING`,
  );
};

exports.down = (pgm) => {
  const codes = PERMISSIONS.map(([code]) => literal(code));
  pgm.sql(`DELETE FROM identity.permission WHERE code IN (${codes.join(', ')})`);
};
