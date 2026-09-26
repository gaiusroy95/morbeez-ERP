/* eslint-disable camelcase */

// Configuring the approval matrix (rules, limits) is a genuine RBAC
// question — gated by these two static permissions. Deciding an
// individual request is not: that's the dynamic role/limit/delegation
// check in ApprovalsService, not a static permission (see
// modules/approvals/approvals.service.ts).

exports.shorthands = undefined;

const PERMISSIONS = [
  ['approvals:read', 'View approval rules, limits, requests, and delegations'],
  ['approvals:manage', 'Create or change approval rules and role limits'],
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
