/* eslint-disable camelcase */

// A new migration, not an edit to the earlier permission-catalog one
// (Constitution III.6 — forward-only). Newly seeded tenants automatically
// grant every current permission to their Owner role
// (UsersService.provisionOwner); existing dev tenants pick these up the
// next time database/seeds/002 runs.

exports.shorthands = undefined;

const PERMISSIONS = [
  ['tenant:read', "View this tenant's own business account details"],
  ['tenant:manage', "Update this tenant's own business account details"],
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
