/* eslint-disable camelcase */

// Closes the gap flagged (and deliberately left open) in the identity-tables
// migration: until now, the application connected as the same role that
// owns the tables, which bypasses Row-Level Security by default as table
// owner — meaning RLS was documented and correct in principle, but not
// actually enforced against the app's own queries. This migration is what
// makes it real.
//
// Two roles from here on: the migration-owning role (DATABASE_URL — DDL,
// used by node-pg-migrate and database/seeds/, both of which have a
// legitimate reason to bypass RLS) and morbeez_app (APP_DATABASE_URL — the
// NestJS application's only database credential from now on, DML-only,
// genuinely subject to RLS).

exports.shorthands = undefined;

const SCHEMAS = [
  'tenant',
  'identity',
  'trading_partners',
  'commerce',
  'stock',
  'fulfilment',
  'money',
  'ai_analytics',
  'infra',
];

// Env var, not a literal — a real password comes from the secrets manager
// in every environment but local dev (Constitution V.3), same pattern as
// JWT_SECRET. Quotes escaped defensively; this is an internal
// operator-controlled value, never end-user input.
// Never let production fall back to the dev password: a migration run with
// the secret missing would otherwise create the app role with a password
// anyone reading this file knows.
if (process.env.NODE_ENV === 'production' && !process.env.APP_DB_PASSWORD) {
  throw new Error('APP_DB_PASSWORD must be set when migrating a production database');
}
const APP_DB_PASSWORD = (process.env.APP_DB_PASSWORD || 'morbeez_app_dev_only').replace(
  /'/g,
  "''",
);

exports.up = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'morbeez_app') THEN
        CREATE ROLE morbeez_app WITH LOGIN;
      END IF;
    END
    $$;
  `);
  pgm.sql(`ALTER ROLE morbeez_app WITH PASSWORD '${APP_DB_PASSWORD}'`);

  for (const schema of SCHEMAS) {
    pgm.sql(`GRANT USAGE ON SCHEMA ${schema} TO morbeez_app`);
    // DML only — no CREATE, no ALTER, no DROP. Schema changes stay
    // something only a migration (run as the owning role) can do.
    pgm.sql(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO morbeez_app`,
    );
    // So a future migration's new table is automatically covered — no
    // per-migration grant to remember, which is exactly the kind of step
    // that gets forgotten once and quietly reopens the gap this migration
    // closes.
    pgm.sql(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema}
         GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO morbeez_app`,
    );
  }

  pgm.sql(`GRANT EXECUTE ON FUNCTION current_tenant_id() TO morbeez_app`);
  pgm.sql(
    `GRANT EXECUTE ON FUNCTION identity.find_user_for_login(citext) TO morbeez_app`,
  );
  pgm.sql(
    `GRANT EXECUTE ON FUNCTION identity.find_session_by_token_hash(text) TO morbeez_app`,
  );

  // The tables RLS was already enabled on (identity-tables migration) —
  // FORCE is what makes it apply to every role, including one that would
  // otherwise be exempt. tenant.tenant has no RLS policy at all, by
  // design (Production Database, Section 01), so it isn't listed here.
  pgm.sql('ALTER TABLE identity.app_user FORCE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE identity.role FORCE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE identity.auth_session FORCE ROW LEVEL SECURITY');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE identity.auth_session NO FORCE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE identity.role NO FORCE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE identity.app_user NO FORCE ROW LEVEL SECURITY');

  for (const schema of SCHEMAS) {
    pgm.sql(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} REVOKE ALL ON TABLES FROM morbeez_app`);
    pgm.sql(`REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM morbeez_app`);
    pgm.sql(`REVOKE ALL ON SCHEMA ${schema} FROM morbeez_app`);
  }
  pgm.sql('REVOKE EXECUTE ON FUNCTION identity.find_session_by_token_hash(text) FROM morbeez_app');
  pgm.sql('REVOKE EXECUTE ON FUNCTION identity.find_user_for_login(citext) FROM morbeez_app');
  pgm.sql('REVOKE EXECUTE ON FUNCTION current_tenant_id() FROM morbeez_app');
  pgm.sql('DROP ROLE IF EXISTS morbeez_app');
};
