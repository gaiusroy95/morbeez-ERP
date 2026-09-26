/* eslint-disable camelcase */

// A new schema, not in the original bootstrap migration's list — approvals
// is a deliberate extension to the Domain Model (no "Approvals" bounded
// context existed there), the same way Cost Allocation and the Accounting
// Engine's Agent table were added after the fact when a real need showed
// up. Cross-cutting: what needs approval, who can give it, and monetary
// limits apply across future Procurement, Finance, and Vehicles work, not
// to one context alone.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createSchema('approvals', { ifNotExists: true });
  pgm.sql('GRANT USAGE ON SCHEMA approvals TO morbeez_app');
  pgm.sql(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA approvals TO morbeez_app`,
  );
  pgm.sql(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA approvals
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO morbeez_app`,
  );
};

exports.down = (pgm) => {
  pgm.sql('ALTER DEFAULT PRIVILEGES IN SCHEMA approvals REVOKE ALL ON TABLES FROM morbeez_app');
  pgm.sql('REVOKE ALL ON ALL TABLES IN SCHEMA approvals FROM morbeez_app');
  pgm.sql('REVOKE ALL ON SCHEMA approvals FROM morbeez_app');
  pgm.dropSchema('approvals', { ifExists: true, cascade: true });
};
