/* eslint-disable camelcase */

// Refresh-token families and device binding (Security Audit SA-04, SA-11).
//
// family_id — every session descended from one login by rotation. Presenting
// a token that was already rotated away (outside a short grace window for a
// client's own parallel refreshes) means two parties hold the chain: the
// whole family is revoked, cutting off the thief along with the owner.
// rotated_at — when this session was exchanged for its successor (null if it
// was revoked by logout or a password change instead).
// device_id — the driver app's install id, so one lost phone can be cut off
// without signing the person out everywhere (Driver App Architecture DRV.11).

const FIND_WITH_FAMILY = `
  CREATE FUNCTION identity.find_session_by_token_hash(p_hash text)
  RETURNS TABLE (
    id uuid,
    tenant_id uuid,
    user_id uuid,
    expires_at timestamptz,
    revoked_at timestamptz,
    family_id uuid,
    rotated_at timestamptz
  )
  SECURITY DEFINER
  SET search_path = identity, pg_temp
  LANGUAGE sql
  STABLE
  AS $$
    SELECT id, tenant_id, user_id, expires_at, revoked_at, family_id, rotated_at
    FROM identity.auth_session
    WHERE refresh_token_hash = p_hash;
  $$;
`;

const FIND_ORIGINAL = `
  CREATE FUNCTION identity.find_session_by_token_hash(p_hash text)
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
`;

exports.up = (pgm) => {
  pgm.addColumns({ schema: 'identity', name: 'auth_session' }, {
    family_id: { type: 'uuid' },
    rotated_at: { type: 'timestamptz' },
    device_id: { type: 'text' },
  });
  pgm.sql('UPDATE identity.auth_session SET family_id = id WHERE family_id IS NULL');
  pgm.alterColumn({ schema: 'identity', name: 'auth_session' }, 'family_id', {
    notNull: true,
    default: pgm.func('gen_random_uuid()'),
  });
  pgm.createIndex({ schema: 'identity', name: 'auth_session' }, ['tenant_id', 'family_id']);
  pgm.createIndex({ schema: 'identity', name: 'auth_session' }, ['tenant_id', 'user_id']);

  // The return type changes, so the function is replaced rather than altered —
  // and its grant goes with it.
  pgm.sql('DROP FUNCTION identity.find_session_by_token_hash(text)');
  pgm.sql(FIND_WITH_FAMILY);
  pgm.sql('GRANT EXECUTE ON FUNCTION identity.find_session_by_token_hash(text) TO morbeez_app');
};

exports.down = (pgm) => {
  pgm.sql('DROP FUNCTION identity.find_session_by_token_hash(text)');
  pgm.sql(FIND_ORIGINAL);
  pgm.sql('GRANT EXECUTE ON FUNCTION identity.find_session_by_token_hash(text) TO morbeez_app');
  pgm.dropIndex({ schema: 'identity', name: 'auth_session' }, ['tenant_id', 'user_id']);
  pgm.dropIndex({ schema: 'identity', name: 'auth_session' }, ['tenant_id', 'family_id']);
  pgm.dropColumns({ schema: 'identity', name: 'auth_session' }, ['family_id', 'rotated_at', 'device_id']);
};
