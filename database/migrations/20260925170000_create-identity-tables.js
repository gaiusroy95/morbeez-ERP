/* eslint-disable camelcase */

// Users context (Domain Model, Tier 00): identity, authentication, and
// access — not employment. app_user, role, and auth_session are
// tenant-scoped with RLS; permission is a global catalog; role_permission
// and user_role are pure join tables with no tenant_id of their own,
// protected transitively through the tables they join.
//
// role.tenant_id is NOT NULL here — every role belongs to exactly one
// tenant. The Production Database document left room for global "template"
// roles (nullable tenant_id); this migration doesn't implement that yet,
// to avoid getting RLS-with-NULL semantics wrong on the first pass. Each
// tenant gets its own copy of the standard roles at provisioning time
// instead (seeded in database/seeds/, not here).

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'identity', name: 'permission' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      code: { type: 'text', notNull: true, unique: true },
      description: { type: 'text', notNull: true },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  // Global catalog, no RLS — every tenant sees the same permission codes
  // (Production Database, Section 01: "Global tables").

  pgm.createTable(
    { schema: 'identity', name: 'role' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'tenant', name: 'tenant' },
        onDelete: 'RESTRICT',
      },
      name: { type: 'text', notNull: true },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  pgm.addConstraint('role', 'role_tenant_name_unique', {
    unique: ['tenant_id', 'name'],
    schema: 'identity',
  });
  pgm.createIndex({ schema: 'identity', name: 'role' }, 'tenant_id');
  pgm.sql('ALTER TABLE identity.role ENABLE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY role_tenant_isolation ON identity.role
      USING (tenant_id = current_tenant_id())
  `);

  pgm.createTable(
    { schema: 'identity', name: 'role_permission' },
    {
      role_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'identity', name: 'role' },
        onDelete: 'CASCADE',
      },
      permission_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'identity', name: 'permission' },
        onDelete: 'CASCADE',
      },
    },
  );
  pgm.addConstraint('role_permission', 'role_permission_pk', {
    primaryKey: ['role_id', 'permission_id'],
    schema: 'identity',
  });
  // No tenant_id, no RLS of its own — a mapping row is only ever reachable
  // by first joining through identity.role, which is itself RLS-protected.

  pgm.createTable(
    { schema: 'identity', name: 'app_user' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'tenant', name: 'tenant' },
        onDelete: 'RESTRICT',
      },
      email: { type: 'citext', notNull: true },
      password_hash: { type: 'text', notNull: true },
      status: { type: 'text', notNull: true, default: 'active' }, // active | deactivated
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  pgm.sql('CREATE EXTENSION IF NOT EXISTS citext'); // case-insensitive email comparison/uniqueness
  pgm.addConstraint('app_user', 'app_user_tenant_email_unique', {
    unique: ['tenant_id', 'email'],
    schema: 'identity',
  });
  pgm.createIndex({ schema: 'identity', name: 'app_user' }, 'tenant_id');
  pgm.sql('ALTER TABLE identity.app_user ENABLE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY app_user_tenant_isolation ON identity.app_user
      USING (tenant_id = current_tenant_id())
  `);

  pgm.createTable(
    { schema: 'identity', name: 'user_role' },
    {
      user_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'identity', name: 'app_user' },
        onDelete: 'CASCADE',
      },
      role_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'identity', name: 'role' },
        onDelete: 'CASCADE',
      },
    },
  );
  pgm.addConstraint('user_role', 'user_role_pk', {
    primaryKey: ['user_id', 'role_id'],
    schema: 'identity',
  });

  pgm.createTable(
    { schema: 'identity', name: 'auth_session' },
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
        notNull: true,
        references: { schema: 'identity', name: 'app_user' },
        onDelete: 'CASCADE',
      },
      refresh_token_hash: { type: 'text', notNull: true, unique: true },
      device_info: { type: 'text' },
      issued_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      expires_at: { type: 'timestamptz', notNull: true },
      revoked_at: { type: 'timestamptz' },
    },
  );
  pgm.createIndex({ schema: 'identity', name: 'auth_session' }, 'tenant_id');
  pgm.createIndex({ schema: 'identity', name: 'auth_session' }, 'user_id');
  pgm.sql('ALTER TABLE identity.auth_session ENABLE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY auth_session_tenant_isolation ON identity.auth_session
      USING (tenant_id = current_tenant_id())
  `);

  // The one legitimate cross-tenant read in the whole system: at login,
  // the tenant isn't known yet, so there is no app.tenant_id to scope by
  // (RLS would return zero rows, correctly, for every login attempt).
  // A single, named, SECURITY DEFINER function is the narrow, auditable
  // exception — not a blanket bypass, not a second application role, and
  // not a policy that quietly allows cross-tenant reads from anywhere else
  // (Constitution V.1's defense-in-depth: removing any one layer must not
  // make cross-tenant access possible — this is the layer that
  // deliberately, visibly, does the lookup, and only this lookup).
  //
  // Known gap, tracked rather than hidden: this function is only a true
  // RLS bypass once the application connects as a role distinct from the
  // migration-owning role. Today they're the same role, so the owner's
  // default RLS exemption already covers this — the function documents
  // and narrows intent now, and becomes load-bearing once
  // infrastructure/terraform provisions a separate, least-privilege
  // runtime database role.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION identity.find_user_for_login(p_email citext)
    RETURNS TABLE (
      id uuid,
      tenant_id uuid,
      email citext,
      password_hash text,
      status text
    )
    SECURITY DEFINER
    SET search_path = identity, pg_temp
    LANGUAGE sql
    STABLE
    AS $$
      SELECT id, tenant_id, email, password_hash, status
      FROM identity.app_user
      WHERE email = p_email;
    $$;
  `);

  // Same problem, same shape of exception: a presented refresh token has
  // no tenant attached to it until the matching session is found. Nothing
  // else about auth_session is exempt from RLS — only this one lookup,
  // by the token's hash, which is itself unguessable.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION identity.find_session_by_token_hash(p_hash text)
    RETURNS TABLE (
      id uuid,
      tenant_id uuid,
      user_id uuid,
      expires_at timestamptz,
      revoked_at timestamptz
    )
    SECURITY DEFINER
    SET search_path = identity, pg_temp
    LANGUAGE sql
    STABLE
    AS $$
      SELECT id, tenant_id, user_id, expires_at, revoked_at
      FROM identity.auth_session
      WHERE refresh_token_hash = p_hash;
    $$;
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP FUNCTION IF EXISTS identity.find_session_by_token_hash(text)');
  pgm.sql('DROP FUNCTION IF EXISTS identity.find_user_for_login(citext)');
  pgm.dropTable({ schema: 'identity', name: 'auth_session' });
  pgm.dropTable({ schema: 'identity', name: 'user_role' });
  pgm.dropTable({ schema: 'identity', name: 'app_user' });
  pgm.dropTable({ schema: 'identity', name: 'role_permission' });
  pgm.dropTable({ schema: 'identity', name: 'role' });
  pgm.dropTable({ schema: 'identity', name: 'permission' });
};
