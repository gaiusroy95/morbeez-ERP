/* eslint-disable camelcase */

exports.shorthands = undefined;

const PERMISSIONS = [
  ['customers:read', 'View customer records'],
  ['customers:write', 'Create, update, archive, or restore customer records'],
  ['farmers:read', 'View farmer records'],
  ['farmers:write', 'Create, update, archive, or restore farmer records'],
  ['products:read', 'View product records'],
  ['products:write', 'Create, update, archive, or restore product records'],
  ['vehicles:read', 'View vehicle records'],
  ['vehicles:write', 'Create, update, archive, or restore vehicle records'],
  ['workforce:read', 'View employee records'],
  ['workforce:write', 'Create, update, archive, or restore employee records'],
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
