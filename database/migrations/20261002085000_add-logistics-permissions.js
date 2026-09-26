/* eslint-disable camelcase */

// Three, matching Procurement's split: ordinary trip planning/execution
// (logistics:write) is separated from cash reconciliation
// (logistics:reconcile) — the same segregation-of-duties reasoning as
// Procurement's grade/settle split (Accounting Engine CN.4).

exports.shorthands = undefined;

const PERMISSIONS = [
  ['logistics:read', 'View trips, stops, expenses, and reconciliations'],
  ['logistics:write', 'Plan trips, manage stops, complete pickups/deliveries, record expenses'],
  ['logistics:reconcile', "Reconcile a trip's cash advance against its expenses"],
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
