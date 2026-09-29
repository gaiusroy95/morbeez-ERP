// Checks a database restored from backup is complete and usable (restore
// drill, Constitution VII.7). Runs inside the VPC as a one-off task on the
// migration image, against the restored copy: DATABASE_URL is production's
// owner connection string and DRILL_HOST replaces its host.
//
// Exits non-zero if anything is wrong, and prints one JSON line the drill
// workflow puts in its summary.
// Resolved from the working directory (apps/backend in the image), where pg is installed.
const { Client } = require(require.resolve('pg', { paths: [process.cwd()] }));

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  url.hostname = process.env.DRILL_HOST;
  const db = new Client({ connectionString: url.toString() });
  await db.connect();
  const one = async (sql) => (await db.query(sql)).rows[0];
  const problems = [];

  const migrations = await one('SELECT count(*)::int AS n, max(name) AS latest FROM pgmigrations');
  const counts = await one(`SELECT
      (SELECT count(*) FROM tenant.tenant)::int AS tenants,
      (SELECT count(*) FROM identity.app_user)::int AS users,
      (SELECT count(*) FROM money.ledger_entry)::int AS ledger_entries,
      (SELECT count(*) FROM money.invoice)::int AS invoices`);
  if (counts.tenants === 0) problems.push('no tenants in the restored copy');

  // The books must balance, entry by entry (Accounting Engine DE.1).
  const unbalanced = await one(`
    SELECT count(*)::int AS n FROM (
      SELECT entry_id FROM money.ledger_line GROUP BY entry_id HAVING SUM(debit) <> SUM(credit)
    ) x`);
  if (unbalanced.n > 0) problems.push(`${unbalanced.n} unbalanced ledger entries`);

  // How far behind the source the copy is: the recovery point actually achieved.
  const newest = await one(`SELECT max(created_at) AS at FROM infra.audit_log`);

  // Tenant isolation survived the restore.
  const unprotected = await one(`
    SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE c.relkind = 'r' AND ns.nspname NOT IN ('pg_catalog', 'information_schema', 'public')
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
      AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`);
  if (unprotected.n > 0) problems.push(`${unprotected.n} tenant tables without forced RLS`);

  await db.end();
  const result = {
    ok: problems.length === 0,
    problems,
    migrations: migrations.n,
    latestMigration: migrations.latest,
    ...counts,
    newestAuditRecord: newest.at,
  };
  console.log(JSON.stringify(result));
  if (!result.ok) process.exit(1);
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, problems: [e.message] }));
  process.exit(1);
});
