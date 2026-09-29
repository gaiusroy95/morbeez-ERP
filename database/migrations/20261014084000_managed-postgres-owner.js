/* eslint-disable camelcase */

// Makes the schema work when its owner is not a superuser — as on RDS,
// where the master user that runs migrations and owns every table is an
// ordinary role (Deployment plan, launch blocker). Locally and in CI the
// owner was a superuser, which RLS never applies to, so none of this showed.
//
// 1. current_tenant_id() treats an empty setting as "no tenant". A pooled
//    connection that ran a tenant transaction before reads app.tenant_id
//    back as '' (a transaction-local setting reverts to empty, not unset),
//    and ''::uuid is an error — which surfaced as signup failing: creating a
//    tenant installs its chart of accounts through a SECURITY DEFINER
//    trigger, whose RLS check evaluated current_tenant_id() on such a
//    connection.
//
// 2. The two sanctioned untenanted lookups — login by email and refresh by
//    token hash — are SECURITY DEFINER functions owned by the migration
//    role. With FORCE ROW LEVEL SECURITY a non-superuser owner is filtered
//    like anyone else, finding no user and no session: nobody could sign
//    in. A read-only policy for the owner role alone (the same pattern as
//    money.account's account_install) restores them; morbeez_app and
//    morbeez_ai gain nothing.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid AS $$
      SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
    $$ LANGUAGE sql STABLE;
  `);
  pgm.sql('CREATE POLICY app_user_definer_lookup ON identity.app_user FOR SELECT TO CURRENT_USER USING (true)');
  pgm.sql('CREATE POLICY auth_session_definer_lookup ON identity.auth_session FOR SELECT TO CURRENT_USER USING (true)');
};

exports.down = (pgm) => {
  pgm.sql('DROP POLICY auth_session_definer_lookup ON identity.auth_session');
  pgm.sql('DROP POLICY app_user_definer_lookup ON identity.app_user');
  pgm.sql(`
    CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid AS $$
      SELECT current_setting('app.tenant_id', true)::uuid;
    $$ LANGUAGE sql STABLE;
  `);
};
