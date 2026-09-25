/* eslint-disable camelcase */

// Reference data, not test fixture data — every environment, including
// production, needs the same permission codes to exist (Constitution
// VI.5's "never real tenant data" governs seeds/, not catalog rows like
// this one). Deliberately minimal: only what the Users context itself
// needs right now. Each bounded context registers its own permission
// codes in its own migration as it's implemented, rather than this file
// guessing at contexts that don't exist in code yet.

exports.shorthands = undefined;

const PERMISSIONS = [
  ['users:read', 'View user accounts in this tenant'],
  ['users:write', 'Create, deactivate, or reactivate user accounts'],
  ['roles:manage', 'Create roles and assign permissions to them'],
  ['roles:assign', 'Assign existing roles to users'],
];

exports.up = async (pgm) => {
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
