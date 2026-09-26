/* eslint-disable camelcase */

// Two permissions, matching Orders — nothing here needs a segregation of
// duties split (unlike Procurement's grade/settle).

exports.shorthands = undefined;

const PERMISSIONS = [
  ['inventory:read', 'View locations, stock summaries, and inventory movement history'],
  ['inventory:write', 'Manage locations; record shrinkage, post-acceptance rejection, and transfers'],
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
