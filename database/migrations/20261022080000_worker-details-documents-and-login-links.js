/* eslint-disable camelcase */

// Adding a worker properly (client feedback, Oct 2026: "No data — phone
// number, address, document attach. Send login credentials, password
// set-up link"):
//
// 1. workforce.worker_profile.address — where the worker lives.
//
// 2. workforce.worker_document — ID and licence scans (Aadhaar, driving
//    licence, PAN, a photo) kept with the worker. The file itself is in
//    object storage under storage_key; a removed document keeps its row
//    (removed_at), so who uploaded and removed what stays on record.
//
// 3. identity.password_setup — one-time links that let a staff member
//    choose their own password, instead of the owner inventing one and
//    passing it on. Only a SHA-256 of the link's token is stored: a leaked
//    database row can't be used as a link. A link expires (7 days by the
//    API) and works once.
//
//    The link is opened by someone not yet signed in, so finding it is an
//    untenanted lookup: identity.find_password_setup is a SECURITY DEFINER
//    function, the same narrow exception as login by phone, readable by the
//    owner role through password_setup_definer_lookup (see the
//    managed-postgres-owner migration), executable by morbeez_app only.

const tenantColumn = { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' };
const userColumn = { type: 'uuid', references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' };
const employeeColumn = {
  type: 'uuid',
  notNull: true,
  references: { schema: 'trading_partners', name: 'employee' },
  onDelete: 'RESTRICT',
};

const DOCUMENT_KINDS = ['aadhaar', 'driving_licence', 'pan', 'photo', 'other'];

function isolate(pgm, schema, table) {
  pgm.sql(`ALTER TABLE ${schema}.${table} ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE ${schema}.${table} FORCE ROW LEVEL SECURITY`);
  pgm.sql(`CREATE POLICY ${table}_tenant_isolation ON ${schema}.${table} USING (tenant_id = current_tenant_id())`);
}

exports.up = (pgm) => {
  pgm.addColumn({ schema: 'workforce', name: 'worker_profile' }, { address: { type: 'text' } });

  pgm.createTable({ schema: 'workforce', name: 'worker_document' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    employee_id: employeeColumn,
    kind: { type: 'text', notNull: true },
    label: { type: 'text' },
    storage_key: { type: 'text', notNull: true },
    content_type: { type: 'text', notNull: true },
    size_bytes: { type: 'integer', notNull: true },
    file_name: { type: 'text' },
    uploaded_by: { ...userColumn, notNull: true },
    uploaded_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    removed_by: userColumn,
    removed_at: { type: 'timestamptz' },
  });
  pgm.addConstraint({ schema: 'workforce', name: 'worker_document' }, 'worker_document_kind_valid', {
    check: `kind IN (${DOCUMENT_KINDS.map((k) => `'${k}'`).join(', ')})`,
  });
  pgm.createIndex({ schema: 'workforce', name: 'worker_document' }, ['tenant_id', 'employee_id']);
  isolate(pgm, 'workforce', 'worker_document');
  pgm.sql('GRANT SELECT, INSERT ON workforce.worker_document TO morbeez_app');
  pgm.sql('GRANT UPDATE (removed_by, removed_at) ON workforce.worker_document TO morbeez_app');

  pgm.createTable({ schema: 'identity', name: 'password_setup' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    user_id: { ...userColumn, notNull: true },
    token_hash: { type: 'text', notNull: true, unique: true },
    expires_at: { type: 'timestamptz', notNull: true },
    used_at: { type: 'timestamptz' },
    created_by: { ...userColumn, notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex({ schema: 'identity', name: 'password_setup' }, ['tenant_id', 'user_id']);
  isolate(pgm, 'identity', 'password_setup');
  pgm.sql('GRANT SELECT, INSERT ON identity.password_setup TO morbeez_app');
  pgm.sql('GRANT UPDATE (used_at) ON identity.password_setup TO morbeez_app');

  pgm.sql(`
    CREATE FUNCTION identity.find_password_setup(p_token_hash text)
    RETURNS TABLE (
      id uuid,
      tenant_id uuid,
      user_id uuid,
      expires_at timestamptz,
      used_at timestamptz
    )
    SECURITY DEFINER
    SET search_path = identity, pg_temp
    LANGUAGE sql
    STABLE
    AS $$
      SELECT id, tenant_id, user_id, expires_at, used_at
      FROM identity.password_setup
      WHERE token_hash = p_token_hash;
    $$
  `);
  pgm.sql('REVOKE ALL ON FUNCTION identity.find_password_setup(text) FROM PUBLIC');
  pgm.sql('GRANT EXECUTE ON FUNCTION identity.find_password_setup(text) TO morbeez_app');
  pgm.sql('CREATE POLICY password_setup_definer_lookup ON identity.password_setup FOR SELECT TO CURRENT_USER USING (true)');
};

exports.down = (pgm) => {
  pgm.sql('DROP POLICY password_setup_definer_lookup ON identity.password_setup');
  pgm.sql('DROP FUNCTION identity.find_password_setup(text)');
  pgm.dropTable({ schema: 'identity', name: 'password_setup' });
  pgm.dropTable({ schema: 'workforce', name: 'worker_document' });
  pgm.dropColumn({ schema: 'workforce', name: 'worker_profile' }, 'address');
};
