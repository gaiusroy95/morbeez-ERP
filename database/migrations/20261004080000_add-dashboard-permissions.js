/* eslint-disable camelcase */

// Two, deliberately: operational visibility (KPIs, alerts, the operations
// overview) is something an Operations Manager needs; margin and cost of
// goods are owner-level financial detail. Splitting them lets a tenant
// grant the first without the second.

exports.shorthands = undefined;

const PERMISSIONS = [
  ['dashboard:read', 'View the owner dashboard: KPIs, alerts, and the operations overview'],
  ['dashboard:profit', 'View gross profit, cost of goods, and margin on the owner dashboard'],
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
