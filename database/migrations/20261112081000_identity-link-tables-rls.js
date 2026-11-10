/* eslint-disable camelcase */

// Row-level security on the last two tables of a business's data without it
// (Master Spec v3 P1, found in P0): who holds which role (user_role) and what
// each role may do (role_permission). Both hang off a role, which belongs to
// one business. Sign-in reads them inside the business's own session
// (UsersRepository.findRolesAndPermissions), and a new business writes its
// roles after its session is set (TenantService), so RLS fits both.
//
// tenant_id comes from the role, kept true by tenant.inherit_tenant_id (from
// 20261111080000), with forced RLS and the standard policy. From now on a
// migration that grants a permission to existing roles inserts into
// role_permission as the non-superuser owner, which FORCE blinds: lift it
// around the insert, as below.

exports.shorthands = undefined;

const LINKS = [
  { name: 'user_role', key: ['user_id', 'role_id'] },
  { name: 'role_permission', key: ['role_id', 'permission_id'] },
];

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE identity.role NO FORCE ROW LEVEL SECURITY');
  for (const l of LINKS) {
    const table = `identity.${l.name}`;
    pgm.addColumns({ schema: 'identity', name: l.name }, {
      tenant_id: { type: 'uuid', references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' },
    });
    pgm.sql(`UPDATE ${table} x SET tenant_id = r.tenant_id FROM identity.role r WHERE r.id = x.role_id`);
    pgm.alterColumn({ schema: 'identity', name: l.name }, 'tenant_id', { notNull: true });
    pgm.sql(`
      CREATE TRIGGER ${l.name}_tenant BEFORE INSERT OR UPDATE OF tenant_id, role_id ON ${table}
        FOR EACH ROW EXECUTE FUNCTION tenant.inherit_tenant_id('identity.role', 'role_id')
    `);
    pgm.createIndex({ schema: 'identity', name: l.name }, ['tenant_id', ...l.key]);
    pgm.sql(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    pgm.sql(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    pgm.sql(`CREATE POLICY ${l.name}_tenant_isolation ON ${table} USING (tenant_id = current_tenant_id())`);
  }
  pgm.sql('ALTER TABLE identity.role FORCE ROW LEVEL SECURITY');
};

exports.down = (pgm) => {
  for (const l of [...LINKS].reverse()) {
    const table = `identity.${l.name}`;
    pgm.sql(`DROP POLICY ${l.name}_tenant_isolation ON ${table}`);
    pgm.sql(`ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY`);
    pgm.sql(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
    pgm.sql(`DROP TRIGGER ${l.name}_tenant ON ${table}`);
    pgm.dropIndex({ schema: 'identity', name: l.name }, ['tenant_id', ...l.key]);
    pgm.dropColumns({ schema: 'identity', name: l.name }, ['tenant_id']);
  }
};
