/* eslint-disable camelcase */

// Three, matching Procurement's split: ordinary trip planning/execution
// (logistics:write) is separated from cash reconciliation
// (logistics:reconcile) — the same segregation-of-duties reasoning as
// Procurement's grade/settle split (Accounting Engine CN.4).

exports.shorthands = undefined;

const PERMISSIONS = [
  ['logistics:read', 'View trips, stops, expenses, and reconciliations'],
  ['logistics:write', 'Plan trips, manage stops, complete pickups/deliveries, record expenses'],
  ['logistics:reconcile', "Reconcile a trip's cash advance against its expenses"],
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
