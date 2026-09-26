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
