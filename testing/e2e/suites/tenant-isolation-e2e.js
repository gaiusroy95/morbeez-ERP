// One business never sees or touches another's rows — checked on the real
// database, as the app's own role (morbeez_app), for every table at once
// (Constitution: RLS on every table; Master Spec v3 §58 and P0). Run after
// the chains have filled the dev business's tables. A second business signs
// up; inside its session:
//   - every table with tenant_id shows none of the dev business's rows;
//   - a line, a stop or a stop photo can't be attached to the dev business's
//     order, trip or stop (a foreign key ignores RLS; the tenant trigger doesn't);
// and, as a guard for later migrations, no table with tenant_id goes without
// forced row-level security, and the tables without a tenant are only the
// known global ones.
const { Client } = require('pg');
const { API, DB_URL } = require('../lib/env');

const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`);
const APP_DB_URL = process.env.APP_DATABASE_URL;
// Not one business's data, by design (database/scripts/schema-report.js keeps the same list).
const NO_TENANT = ['identity.permission', 'money.ledger_account', 'tenant.tenant'];

(async () => {
  if (!APP_DB_URL) throw new Error('APP_DATABASE_URL (the morbeez_app connection) is needed');
  const admin = new Client({ connectionString: DB_URL });
  const app = new Client({ connectionString: APP_DB_URL });
  await admin.connect();
  await app.connect();
  try {
    // ---- A second business ----
    const phone = '+919800000095'; // dev placeholder
    const password = 'a-long-isolation-password-1';
    const signup = await fetch(`${API}/tenants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ businessName: 'Isolation Check Traders', ownerPhone: phone, ownerPassword: password }),
    });
    let tokens = await signup.json();
    // Run again on the same database: the business is already there — sign in.
    if (signup.status === 409) {
      const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: phone, password }) });
      tokens = await r.json();
    }
    check('a second business signs up (or signed up on an earlier run)', (signup.status === 201 || signup.status === 409) && !!tokens.accessToken, `${signup.status}`);
    const me = await (await fetch(`${API}/tenants/me`, { headers: { authorization: `Bearer ${tokens.accessToken}` } })).json();
    const other = me.id;
    const dev = (await admin.query(`SELECT tenant_id FROM identity.app_user WHERE email = 'owner@dev.morbeez.local'`)).rows[0].tenant_id;
    check('two different businesses', !!other && other !== dev, `${other} vs ${dev}`);

    // ---- The guard: every tenant table has forced RLS ----
    const tables = (
      await admin.query(`
        SELECT n.nspname || '.' || c.relname AS t, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
               EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped) AS has_tenant
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'public') AND n.nspname NOT LIKE 'pg_temp%'
         ORDER BY 1`)
    ).rows;
    const unprotected = tables.filter((t) => t.has_tenant && !(t.rls && t.forced)).map((t) => t.t);
    check('every table with tenant_id has row-level security, forced', unprotected.length === 0, unprotected.join(', ') || `${tables.filter((t) => t.has_tenant).length} tables`);
    const tenantless = tables.filter((t) => !t.has_tenant).map((t) => t.t);
    const unexpected = tenantless.filter((t) => !NO_TENANT.includes(t));
    check('the only tables without a tenant are the global ones', unexpected.length === 0, unexpected.join(', ') || tenantless.join(', '));

    // The dev business has rows where it matters, so the next checks mean something.
    const devRows = {};
    for (const t of ['commerce.customer_order_line', 'commerce.purchase_order_line', 'fulfilment.trip_stop', 'fulfilment.trip_stop_photo', 'fulfilment.trip_stop_pod', 'fulfilment.trip_expense', 'fulfilment.trip_reconciliation']) {
      devRows[t] = (await admin.query(`SELECT count(*)::int AS n FROM ${t} WHERE tenant_id = $1`, [dev])).rows[0].n;
    }
    check('the dev business has order lines and trip stops to hide', devRows['commerce.customer_order_line'] > 0 && devRows['fulfilment.trip_stop'] > 0, JSON.stringify(devRows));

    // ---- Inside the second business's session ----
    const asOther = async (work) => {
      await app.query('BEGIN');
      try {
        await app.query("SELECT set_config('app.tenant_id', $1, true)", [other]);
        return await work();
      } finally {
        await app.query('ROLLBACK');
      }
    };
    const leaks = [];
    let looked = 0;
    for (const t of tables.filter((x) => x.has_tenant)) {
      const readable = (await admin.query("SELECT has_table_privilege('morbeez_app', $1, 'SELECT') AS ok", [t.t])).rows[0].ok;
      if (!readable) continue;
      looked++;
      const n = await asOther(async () => (await app.query(`SELECT count(*)::int AS n FROM ${t.t} WHERE tenant_id <> $1`, [other])).rows[0].n);
      if (n > 0) leaks.push(`${t.t}: ${n}`);
    }
    check("the second business sees none of the dev business's rows, in any table", leaks.length === 0, leaks.join('; ') || `${looked} tables looked at`);

    // ---- Nothing attaches across businesses ----
    const order = (await admin.query('SELECT id FROM commerce.customer_order WHERE tenant_id = $1 LIMIT 1', [dev])).rows[0].id;
    const product = (await admin.query('SELECT id FROM trading_partners.product WHERE tenant_id = $1 LIMIT 1', [dev])).rows[0].id;
    const trip = (await admin.query('SELECT id FROM fulfilment.trip WHERE tenant_id = $1 LIMIT 1', [dev])).rows[0].id;
    const stop = (await admin.query('SELECT id FROM fulfilment.trip_stop WHERE tenant_id = $1 LIMIT 1', [dev])).rows[0].id;
    const refused = async (sql, params) =>
      asOther(async () => {
        await app.query('SAVEPOINT attempt');
        try {
          await app.query(sql, params);
          return 'inserted';
        } catch (e) {
          await app.query('ROLLBACK TO SAVEPOINT attempt');
          return e.code;
        }
      });
    const line = await refused('INSERT INTO commerce.customer_order_line (order_id, product_id, quantity, unit_price) VALUES ($1, $2, 1, 1)', [order, product]);
    const lineWithTenant = await refused('INSERT INTO commerce.customer_order_line (order_id, product_id, quantity, unit_price, tenant_id) VALUES ($1, $2, 1, 1, $3)', [order, product, other]);
    const user = (await admin.query('SELECT id FROM identity.app_user WHERE tenant_id = $1 LIMIT 1', [other])).rows[0].id;
    const tripStop = await refused("INSERT INTO fulfilment.trip_stop (trip_id, sequence_number, stop_type) VALUES ($1, 99, 'delivery')", [trip]);
    const photo = await refused("INSERT INTO fulfilment.trip_stop_photo (trip_stop_id, photo_type, storage_key, content_type, size_bytes, created_by) VALUES ($1, 'pod', 'x', 'image/jpeg', 1, $2)", [stop, user]);
    // Refused by the tenant trigger (23503) or by RLS (42501) — not by a typo in the test.
    const attempts = { line, lineWithTenant, tripStop, photo };
    check("a line, a stop or a photo can't be attached to another business's order, trip or stop", Object.values(attempts).every((c) => c === '23503' || c === '42501'), JSON.stringify(attempts));
    // The same inserts inside the dev business go through — the trigger only refuses the foreign parent.
    const own = await (async () => {
      await app.query('BEGIN');
      try {
        await app.query("SELECT set_config('app.tenant_id', $1, true)", [dev]);
        const r = await app.query('INSERT INTO commerce.customer_order_line (order_id, product_id, quantity, unit_price) VALUES ($1, $2, 1, 1) RETURNING tenant_id', [order, product]);
        return r.rows[0].tenant_id;
      } catch (e) {
        return e.code;
      } finally {
        await app.query('ROLLBACK');
      }
    })();
    check("inside its own business the same line goes in, and takes the order's tenant", own === dev, String(own));
  } finally {
    await admin.end();
    await app.end();
  }
  finish();
})().catch((e) => {
  console.log(results.join('\n'));
  console.error('FAILED:', e.message);
  process.exit(1);
});

function finish() {
  console.log(results.join('\n'));
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);
  process.exit(0);
}
