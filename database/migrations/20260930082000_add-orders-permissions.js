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
