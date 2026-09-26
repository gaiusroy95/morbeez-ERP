/* eslint-disable camelcase */

// Domain Model, Trading Partners & Catalog tier: who works for the
// tenant, and in what capacity — not the same thing as being able to log
// in (identity.app_user). user_id is nullable: not every employee has a
// login (Domain Model, Workforce). driver_profile/shift from the
// Production Database catalog are a documented follow-up.

exports.shorthands = undefined;

const VALID_ROLE_TYPES = ['driver', 'warehouse', 'procurement', 'finance', 'other'];

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'trading_partners', name: 'employee' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'tenant', name: 'tenant' },
        onDelete: 'RESTRICT',
      },
      user_id: {
        type: 'uuid',
        references: { schema: 'identity', name: 'app_user' },
        onDelete: 'RESTRICT',
      },
      name: { type: 'text', notNull: true },
      role_type: { type: 'text', notNull: true },
      employment_terms: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
      status: { type: 'text', notNull: true, default: 'active' }, // active | archived
      version: { type: 'integer', notNull: true, default: 1 },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      created_by: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'identity', name: 'app_user' },
        onDelete: 'RESTRICT',
      },
    },
  );

  pgm.addConstraint('employee', 'employee_role_type_valid', {
    check: `role_type IN (${VALID_ROLE_TYPES.map((v) => `'${v}'`).join(', ')})`,
    schema: 'trading_partners',
  });
  pgm.addConstraint('employee', 'employee_status_valid', {
    check: "status IN ('active', 'archived')",
    schema: 'trading_partners',
  });

  pgm.createIndex({ schema: 'trading_partners', name: 'employee' }, ['tenant_id', 'role_type']);
  pgm.sql('ALTER TABLE trading_partners.employee ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE trading_partners.employee FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY employee_tenant_isolation ON trading_partners.employee
      USING (tenant_id = current_tenant_id())
  `);
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'trading_partners', name: 'employee' });
};
