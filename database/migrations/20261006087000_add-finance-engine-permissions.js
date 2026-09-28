/* eslint-disable camelcase */

// Write-side permissions for the finance engine, split so the person who
// takes money in isn't automatically the one who pays it out, and neither
// can loosen a customer's credit on their own (Constitution V.2).

exports.shorthands = undefined;

const PERMISSIONS = [
  ['finance:collect', 'Record payments received from customers and apply them to invoices'],
  ['finance:pay', 'Record payments to farmers, including advances'],
  ['finance:manage', 'Run finance charges, record finance costs, and reverse customer payments'],
  ['customers:credit', "Change a customer's credit terms: limit, payment days, finance charges, credit hold"],
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
