/* eslint-disable camelcase */

// Read-only for now: receivables, payables, cash movements, and trip cash
// are all derived from operational facts (collections, settlements, trip
// reconciliations). Posting journals arrives with the Accounting module.

exports.shorthands = undefined;

const PERMISSIONS = [
  ['finance:read', 'View receivables, payables, cash movements, and trip cash'],
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
