/* eslint-disable camelcase */

// Phone-number sign-in and the free trial.
//
// 1. A login is a mobile number (E.164, Indian mobiles: +91 then 10 digits
//    starting 6-9) or an email, or both. The phone is unique across every
//    tenant for the same reason the email is (app_user_email_unique,
//    Security Audit SA-01): sign-in has no tenant yet, so one number must
//    resolve to one account. Existing logins keep their emails.
//
// 2. identity.find_user_for_login_by_phone is the phone twin of
//    find_user_for_login: the same narrow SECURITY DEFINER exception to RLS,
//    readable by the owner role through app_user_definer_lookup (see the
//    managed-postgres-owner migration), executable by morbeez_app only.
//
// 3. A business signing itself up gets 30 days free (trial_ends_at, set by
//    the API at signup). After that, until subscribed_until is in the
//    future, the API accepts reads only. Both NULL — every business that
//    existed before this migration, and any the team sets up on a deal —
//    means no limit.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE identity.app_user
      ALTER COLUMN email DROP NOT NULL,
      ADD COLUMN phone text,
      ADD CONSTRAINT app_user_phone_format CHECK (phone IS NULL OR phone ~ '^\\+91[6-9][0-9]{9}$'),
      ADD CONSTRAINT app_user_has_login CHECK (email IS NOT NULL OR phone IS NOT NULL),
      ADD CONSTRAINT app_user_phone_unique UNIQUE (phone)
  `);

  pgm.sql(`
    CREATE FUNCTION identity.find_user_for_login_by_phone(p_phone text)
    RETURNS TABLE (
      id uuid,
      tenant_id uuid,
      email citext,
      phone text,
      password_hash text,
      status text
    )
    SECURITY DEFINER
    SET search_path = identity, pg_temp
    LANGUAGE sql
    STABLE
    AS $$
      SELECT id, tenant_id, email, phone, password_hash, status
      FROM identity.app_user
      WHERE phone = p_phone;
    $$
  `);
  pgm.sql('REVOKE ALL ON FUNCTION identity.find_user_for_login_by_phone(text) FROM PUBLIC');
  pgm.sql('GRANT EXECUTE ON FUNCTION identity.find_user_for_login_by_phone(text) TO morbeez_app');

  pgm.sql(`
    ALTER TABLE tenant.tenant
      ADD COLUMN trial_ends_at timestamptz,
      ADD COLUMN subscribed_until timestamptz
  `);
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE tenant.tenant DROP COLUMN subscribed_until, DROP COLUMN trial_ends_at');
  pgm.sql('DROP FUNCTION identity.find_user_for_login_by_phone(text)');
  // Refuses (NOT NULL) while any login has only a phone — deliberately:
  // rolling back must not silently delete someone's only way in.
  pgm.sql(`
    ALTER TABLE identity.app_user
      DROP CONSTRAINT app_user_phone_unique,
      DROP CONSTRAINT app_user_has_login,
      DROP CONSTRAINT app_user_phone_format,
      DROP COLUMN phone,
      ALTER COLUMN email SET NOT NULL
  `);
};
