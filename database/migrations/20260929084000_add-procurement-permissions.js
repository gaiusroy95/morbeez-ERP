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

exports.up = (pgm) => {
  for (const [code, description] of PERMISSIONS) {
    pgm.sql(
      `INSERT INTO identity.permission (code, description) VALUES ($1, $2)
       ON CONFLICT (code) DO NOTHING`,
      [code, description],
    );
  }
};

exports.down = (pgm) => {
  const codes = PERMISSIONS.map(([code]) => code);
  pgm.sql(`DELETE FROM identity.permission WHERE code = ANY($1)`, [codes]);
};
