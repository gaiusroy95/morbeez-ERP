// Master data the e2e suites start from: one customer, two farmers, two
// products, a vehicle, a driver and two locations for the dev tenant that
// database/seeds creates. Every transaction is created by the suites through
// the API and the owner app.
const { Client } = require('pg');
const { DB_URL } = require('./lib/env');

(async () => {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  const one = async (sql, params = []) => (await c.query(sql, params)).rows[0];
  const t = await one(`SELECT id FROM tenant.tenant WHERE name = 'Dev Wholesaler Co.'`);
  const u = await one(`SELECT id FROM identity.app_user WHERE tenant_id = $1 AND email = 'owner@dev.morbeez.local'`, [t.id]);
  const by = [t.id, u.id];
  const mk = async (table, cols, vals) =>
    one(
      `INSERT INTO ${table} (tenant_id, created_by, ${cols.join(', ')}) VALUES ($1, $2, ${cols.map((_, i) => `$${i + 3}`).join(', ')}) RETURNING id`,
      [...by, ...vals],
    );

  await mk('trading_partners.customer', ['name', 'credit_limit', 'payment_terms_days'], ['Hotel Sagar', 60000, 7]);
  await mk('trading_partners.farmer', ['name'], ['Ramesh Patil']);
  await mk('trading_partners.farmer', ['name'], ['Lakshmi Devi']);
  await mk('trading_partners.product', ['name', 'base_uom', 'base_price'], ['Tomato', 'kg', 32]);
  await mk('trading_partners.product', ['name', 'base_uom', 'base_price'], ['Onion', 'kg', 30]);
  const vehicle = await mk('trading_partners.vehicle', ['registration_number', 'capacity_kg', 'fuel_type'], ['MH12AB4521', 1500, 'diesel']);
  await mk('trading_partners.employee', ['name', 'role_type'], ['Suresh Kale', 'driver']);
  await mk('stock.location', ['name', 'type'], ['Main warehouse', 'warehouse']);
  await mk('stock.location', ['name', 'type'], ['Cold room', 'warehouse']);
  console.log('seeded master data; vehicle', vehicle.id);
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
