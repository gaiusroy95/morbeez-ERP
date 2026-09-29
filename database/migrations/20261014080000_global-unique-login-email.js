/* eslint-disable camelcase */

// One login per email address, across every tenant (Security Audit SA-01).
//
// app_user_tenant_email_unique only made an email unique *within* a tenant,
// but login has no tenant yet — identity.find_user_for_login looks the email
// up across all of them and takes the first row. Anyone could sign up a new
// business with someone else's email and, once the victim's row moved in
// the heap (any UPDATE, such as a password change), take over what that
// email resolves to and lock the real user out.

exports.up = (pgm) => {
  // Fail with a readable message rather than a bare unique violation if
  // an environment already holds duplicates — they need a human decision
  // about which account keeps the address, not an automatic merge.
  pgm.sql(`
    DO $$
    DECLARE dupes text;
    BEGIN
      SELECT string_agg(email::text, ', ') INTO dupes
      FROM (SELECT email FROM identity.app_user GROUP BY email HAVING count(*) > 1) d;
      IF dupes IS NOT NULL THEN
        RAISE EXCEPTION 'These emails have logins in more than one tenant; resolve them before migrating: %', dupes;
      END IF;
    END $$;
  `);
  pgm.addConstraint({ schema: 'identity', name: 'app_user' }, 'app_user_email_unique', { unique: ['email'] });
};

exports.down = (pgm) => {
  pgm.dropConstraint({ schema: 'identity', name: 'app_user' }, 'app_user_email_unique');
};
