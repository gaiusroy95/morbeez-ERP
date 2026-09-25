/* eslint-disable camelcase */

// Infrastructure only — extensions, per-context schemas, and the helper
// function every RLS policy will key on. The 67-table business catalog
// (Production Database document) lands in its own, later migrations; this
// one just makes the database ready to receive them.

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

exports.up = (pgm) => {
  // gen_random_uuid() for primary keys (Production Database, Design
  // Principles — "Primary keys": time-sortable UUIDs generated app-side
  // are preferred, but pgcrypto is the fallback / dev convenience).
  pgm.sql('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  pgm.sql('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');

  // Schema-per-bounded-context (System Architecture, DB.3).
  for (const schema of SCHEMAS) {
    pgm.createSchema(schema, { ifNotExists: true });
  }

  // Every RLS policy created in later migrations reads this. The session
  // variable itself is set once per request by the backend's tenant-context
  // middleware, never accepted from a client-supplied field
  // (Constitution IV.2; Production Database, Section 01).
  pgm.sql(`
    CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid AS $$
      SELECT current_setting('app.tenant_id', true)::uuid;
    $$ LANGUAGE sql STABLE;
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP FUNCTION IF EXISTS current_tenant_id()');
  for (const schema of SCHEMAS) {
    pgm.dropSchema(schema, { ifExists: true, cascade: true });
  }
  // Extensions are left in place on down — dropping pgcrypto/pg_stat_statements
  // is rarely what you want mid-development and other schemas may depend on
  // them; a full extension teardown is a deliberate, separate action.
};
