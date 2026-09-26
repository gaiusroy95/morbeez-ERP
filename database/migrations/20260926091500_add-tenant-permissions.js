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
