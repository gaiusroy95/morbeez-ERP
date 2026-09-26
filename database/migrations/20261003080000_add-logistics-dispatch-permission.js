/* eslint-disable camelcase */

// Splits Logistics' write access in two: planning (creating trips, adding
// stops, starting/cancelling) is a dispatcher's job and gets its own
// permission; executing a trip's own stops/expenses stays under
// logistics:write, now additionally gated by trip ownership
// (LogisticsService's trip-access check) — a driver's token authorizes
// their own trips only, not "every trip" the way logistics:write alone
// used to read.

exports.shorthands = undefined;

const PERMISSIONS = [
  ['logistics:dispatch', "Plan trips: create, add stops, start, cancel, and view every driver's trips"],
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
