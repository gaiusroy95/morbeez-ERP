/* eslint-disable camelcase */

// Two permissions, matching Orders — nothing here needs a segregation of
// duties split (unlike Procurement's grade/settle).

exports.shorthands = undefined;

const PERMISSIONS = [
  ['inventory:read', 'View locations, stock summaries, and inventory movement history'],
  ['inventory:write', 'Manage locations; record shrinkage, post-acceptance rejection, and transfers'],
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
