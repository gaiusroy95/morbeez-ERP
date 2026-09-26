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
