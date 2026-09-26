/* eslint-disable camelcase */

// Splits Logistics' write access in two: planning (creating trips, adding
// stops, starting/cancelling) is a dispatcher's job and gets its own
// permission; executing a trip's own stops/expenses stays under
// logistics:write, now additionally gated by trip ownership
// (LogisticsService's trip-access check) — a driver's token authorizes
// their own trips only, not "every trip" the way logistics:write alone
// used to read.

exports.shorthands = undefined;

const PERMISSIONS = [
  ['logistics:dispatch', "Plan trips: create, add stops, start, cancel, and view every driver's trips"],
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
