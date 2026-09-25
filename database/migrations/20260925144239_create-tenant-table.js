/* eslint-disable camelcase */

// The one table nothing else is: no tenant_id of its own, no RLS policy,
// because it IS the tenant (Production Database, Section 01 / Section 04).
// Deliberately the only business table in this pass of "set up dev
// infrastructure" — it's what makes the migrate → seed pipeline provable
// end to end; the remaining 66 tables are a separate, later piece of work.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'tenant', name: 'tenant' },
    {
      id: {
        type: 'uuid',
        primaryKey: true,
        default: pgm.func('gen_random_uuid()'),
      },
      name: { type: 'text', notNull: true },
      plan: { type: 'text', notNull: true, default: 'standard' },
      currency: { type: 'text', notNull: true, default: 'INR' },
      timezone: { type: 'text', notNull: true, default: 'Asia/Kolkata' },
      tax_registration: { type: 'text' },
      branding: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'tenant', name: 'tenant' });
};
