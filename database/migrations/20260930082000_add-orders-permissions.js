/* eslint-disable camelcase */

// Two permissions, not four — unlike Procurement, nothing about placing a
// customer order needs the same segregation of duties as grading/settling
// a farmer (no separate "who decides quality" or "who releases payment"
// role split here). Confirming an order (credit check + approval gate +
// stock reservation) is still ordinary write access, same as creating one.

exports.shorthands = undefined;

const PERMISSIONS = [
  ['orders:read', 'View customer orders'],
  ['orders:write', 'Create, confirm, and cancel customer orders'],
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
