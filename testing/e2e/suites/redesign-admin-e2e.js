// Owner app redesign, Phase 7 — Approvals & Exceptions, Reports, Settings,
// My Profile, Workforce & Vehicles, Collections & Payments
// (docs/redesign/owner-app-redesign-plan.md). Runs at the end of the
// redesign chain, on what the driver-app suites left: the D4 trip waiting to
// be closed, a dispute, the D5 trip closed with its backhaul.
//
// The inbox lists everything waiting for the owner; a driver's expense
// beyond their authority is approved or rejected there (a rejected one is a
// close-check exception, never a pay deduction); a purchase order over its
// threshold — raised by a second owner, since nobody decides their own — is
// approved from the inbox page and confirmed at once. Reports agree with the
// books; each needs its screen's permission. Users & permissions, My
// Profile's activity, who is on a trip and a vehicle's trips.
const fs = require('fs');
const path = require('path');
const { API, BASE, DB_URL, PASSWORD, launchBrowser } = require('../lib/env');
const { Client } = require('pg');

const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`);
const SHOTS = process.env.E2E_SCREENSHOTS;

async function login(login, password = PASSWORD) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password }) });
  return (await r.json()).accessToken;
}
function client(token) {
  const call = async (method, path, body) => {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  const ok = async (method, path, body) => {
    const r = await call(method, path, body);
    if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  return { raw: call, get: (p) => ok('GET', p), post: (p, b = {}) => ok('POST', p, b), put: (p, b) => ok('PUT', p, b) };
}
const message = (r) => r.body?.error?.message ?? '';
const money = (n) => Number(n).toFixed(2);

(async () => {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const shot = async (page, name) => SHOTS && page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
  try {
    const owner = client(await login('owner@dev.morbeez.local'));
    const driver = client(await login('driver@dev.morbeez.local'));
    const customers = (await owner.get('/customers?pageSize=100')).items;
    const farmers = (await owner.get('/farmers?pageSize=100')).items;
    const products = (await owner.get('/products?pageSize=100')).items;
    const sagar = customers.find((c) => c.name === 'Hotel Sagar');
    const ramesh = farmers.find((f) => f.name === 'Ramesh Patil');
    const tomato = products.find((p) => p.name === 'Tomato');
    const van = (await owner.get('/vehicles?pageSize=100')).items.find((v) => v.registrationNumber === 'KA01D10001');
    const raju = (await owner.get('/workforce?pageSize=100')).items.find((w) => w.name === 'Raju Driver');
    if (!van || !raju) throw new Error('run the driver-app suites first');
    const rajuId = raju.employeeId ?? raju.id;
    const day = await driver.get('/logistics/trips/mine/day');
    const today = day.today;

    // ---- The inbox: what the earlier suites left waiting ----
    let inbox = await owner.get('/dashboard/approvals');
    const tripToClose = inbox.items.find((i) => i.kind === 'trip_close' && / — Raju Driver$/.test(i.subject));
    const dispute = inbox.items.find((i) => i.kind === 'dispute' && /^Hotel Sagar · /.test(i.subject));
    check('the inbox holds the trip waiting to be closed and the open dispute', !!tripToClose && !!dispute && dispute.amount === '200.00', JSON.stringify(inbox.items.map((i) => `${i.kind}:${i.subject}`)));
    check('its tab counts add up', inbox.counts.all === inbox.items.length && inbox.counts.expense + inbox.counts.price + inbox.counts.other === inbox.counts.all, JSON.stringify(inbox.counts));

    // ---- A driver's expense beyond their authority ----
    const order = await owner.post('/orders', { customerId: sagar.id, deliveryDate: today, creditTermDays: 0, confirm: true, lines: [{ productId: tomato.id, quantity: 5, unitPrice: 30 }] });
    let trip = await owner.post('/logistics/trips', { vehicleId: van.id, driverEmployeeId: rajuId, plannedDate: today, orderIds: [order.id] });
    const lastKm = Number((await driver.get('/logistics/trips/mine/day')).lastOdometerKm ?? 0);
    trip = await driver.post(`/logistics/trips/${trip.id}/start`, { version: trip.version, openingKm: lastKm + 5 });
    // Delivery + collection only (level 2): spending isn't theirs to decide.
    await db.query('UPDATE trading_partners.employee SET delegation_level = 2 WHERE id = $1', [rajuId]);
    try {
      const fuel = await driver.post(`/logistics/trips/${trip.id}/expenses`, { category: 'fuel', amount: 2500, notes: 'Diesel' });
      const toll = await driver.post(`/logistics/trips/${trip.id}/expenses`, { category: 'toll', amount: 120 });
      check('a driver below level 4 still records what they spent — waiting for the owner', fuel.needsApproval && toll.needsApproval);
      inbox = await owner.get('/dashboard/approvals');
      const items = inbox.items.filter((i) => i.kind === 'expense' && i.refs.tripId === trip.id);
      check('…and both are in the inbox, under Expense', items.length === 2 && items.every((i) => i.tab === 'expense') && items.some((i) => i.subject === 'Fuel — Raju Driver' && i.amount === '2500.00'), JSON.stringify(items.map((i) => i.subject)));

      const byDriver = await driver.raw('POST', `/logistics/trips/${trip.id}/expenses/${fuel.id}/decision`, { approve: true });
      check('a driver cannot decide their own expense', byDriver.status === 403, String(byDriver.status));
      const noReason = await owner.raw('POST', `/logistics/trips/${trip.id}/expenses/${toll.id}/decision`, { approve: false });
      check('rejecting needs a reason', noReason.status === 400 && /Say why/.test(message(noReason)), message(noReason));
      const rejected = await owner.post(`/logistics/trips/${trip.id}/expenses/${toll.id}/decision`, { approve: false, note: 'No toll on this route' });
      const approved = await owner.post(`/logistics/trips/${trip.id}/expenses/${fuel.id}/decision`, { approve: true });
      const again = await owner.post(`/logistics/trips/${trip.id}/expenses/${fuel.id}/decision`, { approve: true });
      const flip = await owner.raw('POST', `/logistics/trips/${trip.id}/expenses/${fuel.id}/decision`, { approve: false, note: 'changed my mind' });
      check('approved once — the same decision again is the same, a different one is refused', approved.decision === 'approved' && again.decision === 'approved' && flip.status === 409, `${approved.decision} ${flip.status}`);
      check('the rejected one keeps the reason', rejected.decision === 'rejected' && rejected.decisionNote === 'No toll on this route');
      inbox = await owner.get('/dashboard/approvals');
      check('decided, they leave the inbox', !inbox.items.some((i) => i.kind === 'expense' && i.refs.tripId === trip.id));
      const review = await owner.get(`/logistics/trips/${trip.id}/review`);
      const expenses = review.checklist.find((c) => c.area === 'expenses');
      check(
        "the rejected expense is the close's exception, to settle with the driver",
        expenses.status === 'exception' && expenses.detail === '₹2620.00 spent on the road, of which you rejected ₹120.00 — settle it with the driver.',
        expenses.detail,
      );
    } finally {
      await db.query('UPDATE trading_partners.employee SET delegation_level = 4 WHERE id = $1', [rajuId]);
    }

    // ---- Who is on the road, a vehicle's trips ----
    const road = await owner.get('/logistics/trips/on-the-road');
    check('on the road: the trip, its vehicle and driver', road.some((r) => r.tripId === trip.id && r.vehicleId === van.id && r.driverEmployeeId === rajuId), JSON.stringify(road));
    const vanTrips = await owner.get(`/logistics/trips/vehicles/${van.id}`);
    const km = (await db.query(
      `SELECT COALESCE(SUM(closing_km - opening_km) FILTER (WHERE closing_km IS NOT NULL AND opening_km IS NOT NULL), 0)::numeric(12,1)::text AS km,
              count(*) FILTER (WHERE started_at IS NOT NULL)::int AS trips
         FROM fulfilment.trip WHERE vehicle_id = $1 AND status <> 'cancelled'`,
      [van.id],
    )).rows[0];
    check("a vehicle's trips: how many, the KM recorded, its latest crew", vanTrips.trips === km.trips && vanTrips.km === km.km && vanTrips.current === trip.number && vanTrips.crew?.driverName === 'Raju Driver', JSON.stringify({ ...vanTrips, recent: vanTrips.recent.length, km }));

    // ---- Reports agree with the books ----
    const range = `from=${today}&to=${today}`;
    const sales = await owner.get(`/reports/sales?${range}`);
    const books = (await db.query(
      `SELECT count(*)::int AS n, COALESCE(SUM(i.amount), 0)::numeric(12,2)::text AS total
         FROM money.invoice i JOIN tenant.tenant t ON t.id = i.tenant_id
        WHERE i.tenant_id = (SELECT tenant_id FROM trading_partners.customer WHERE id = $2)
          AND i.kind IN ('sale', 'spot_sale') AND (i.issued_at AT TIME ZONE t.timezone)::date = $1::date`,
      [today, sagar.id],
    )).rows[0];
    check('the sales report: every invoice of the day, adding up to the books', sales.rows.length === books.n && sales.totals?.amount === books.total, `${sales.rows.length}/${books.n} ${sales.totals?.amount}/${books.total}`);
    const trips = await owner.get(`/reports/trips?${range}`);
    const d5 = trips.rows.find((r) => Number(r.backhaul) === 3500);
    check('the trip report shows the backhaul trip, closed, with its rent', !!d5 && d5.status === 'Closed', JSON.stringify(d5));
    const customerReport = await owner.get(`/reports/customers?${range}`);
    const sagarRow = customerReport.rows.find((r) => r.customer === 'Hotel Sagar');
    check('customer profitability: sales less the cost of the kilos is the margin', !!sagarRow && money(Number(sagarRow.sales) - Number(sagarRow.cost)) === sagarRow.margin, JSON.stringify(sagarRow));
    const vehicleReport = await owner.get(`/reports/vehicles?${range}`);
    check('the vehicle report has the van', vehicleReport.rows.some((r) => r.vehicle === 'KA01D10001'));
    const list = await owner.get('/reports/customer-list');
    // This business's customers only: the test connects past row-level security.
    const known = (await db.query(
      'SELECT count(*)::int AS n FROM trading_partners.customer WHERE NOT is_walk_in AND tenant_id = (SELECT tenant_id FROM trading_partners.customer WHERE id = $1)',
      [sagar.id],
    )).rows[0].n;
    check('the customer export: every customer, no dates needed', list.rows.length === known && list.from === null, `${list.rows.length}/${known}`);
    const forbidden = await driver.raw('GET', `/reports/sales?${range}`);
    check("a report needs its screen's permission", forbidden.status === 403, String(forbidden.status));
    const noDates = await owner.raw('GET', '/reports/sales');
    check('a report needs its dates', noDates.status === 400, String(noDates.status));

    // ---- Users & permissions ----
    const roles = await owner.get('/users/roles');
    const ownerRole = roles.find((r) => r.name === 'Owner');
    const team = await owner.get('/users/team');
    const me = team.find((m) => m.login === '+919800000001' || m.email === 'owner@dev.morbeez.local');
    check('users: every login with its roles and whose it is', !!me && me.roles.some((r) => r.name === 'Owner') && team.some((m) => m.workerName === 'Raju Driver' && m.roles.some((r) => r.name === 'Driver')), JSON.stringify(team.map((m) => `${m.login}:${m.roles.map((r) => r.name)}`)));
    const self = await owner.raw('POST', `/users/${me.userId}/roles/${ownerRole.id}/remove`);
    check('nobody takes a role off themselves', self.status === 400, message(self));
    // A placeholder number in the dev seed's range (+9198000000xx), never dialled.
    const second = await owner.post('/users', { phone: '+919800000009', email: 'second-owner@dev.morbeez.local', password: PASSWORD });
    await owner.post(`/users/${second.id}/roles`, { roleId: ownerRole.id });
    const partner = client(await login('second-owner@dev.morbeez.local'));

    // ---- A purchase order over its threshold, raised by someone else ----
    let po = await partner.post('/procurement/purchase-orders', { farmerId: ramesh.id, lines: [{ productId: tomato.id, expectedQuantity: 3000, indicativePrice: 20 }] });
    po = await partner.post(`/procurement/purchase-orders/${po.id}/confirm`, { version: po.version });
    inbox = await owner.get('/dashboard/approvals');
    const poItem = inbox.items.find((i) => i.kind === 'purchase_order' && i.refs.purchaseOrderId === po.id);
    check('a purchase order over the threshold waits in the inbox', !!poItem && poItem.amount === '60000.00' && poItem.tab === 'other' && /Ramesh Patil$/.test(poItem.subject), JSON.stringify(poItem));

    // ---- The owner app ----
    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${BASE}/login`);
      await page.fill('#login', 'owner@dev.morbeez.local');
      await page.fill('#password', PASSWORD);
      await page.click('button[type=submit]');
      await page.waitForURL((u) => !/\/login/.test(u.toString()));

      // Approvals & Exceptions: approve the purchase order right here.
      await page.goto(`${BASE}/approvals`);
      await page.waitForSelector('.inbox-row');
      const tabsText = await page.locator('.day-tabs').first().textContent();
      check('the inbox page: All, Expense, Price, Other with their counts', /All \(\d+\)/.test(tabsText) && /Other \(\d+\)/.test(tabsText), tabsText);
      await shot(page, 'p7-approvals.png');
      const row = page.locator('.inbox-row', { hasText: 'Purchase order approval' }).filter({ hasText: 'Ramesh Patil' });
      await row.getByRole('button', { name: 'Approve' }).click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Approve', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('dialog[open]'));
      const confirmed = await owner.get(`/procurement/purchase-orders/${po.id}`);
      check('approved from the inbox, the purchase order is confirmed at once', confirmed.status === 'confirmed', confirmed.status);

      // Reports: the sales report, downloaded as CSV.
      await page.goto(`${BASE}/reports`);
      await page.getByRole('button', { name: /Sales report/ }).click();
      await page.waitForSelector('.report-table tbody tr');
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).click()]);
      const csv = fs.readFileSync(await download.path(), 'utf8').replace(/^﻿/, '');
      check('the report downloads as CSV, with its header and totals', /^Date,Invoice,Customer,Route,Type,Products,Amount,Paid,Balance/.test(csv) && /\r\nTotal,/.test(csv), csv.slice(0, 120));
      await shot(page, 'p7-report-sales.png');

      // Settings → Users & permissions.
      await page.goto(`${BASE}/settings`);
      await page.waitForSelector('.link-row');
      await shot(page, 'p7-settings.png');
      await page.getByRole('button', { name: /Users & permissions/ }).click();
      await page.waitForSelector('.team-card');
      const teamCards = await page.locator('.team-card').count();
      check('settings: users and their roles', teamCards === team.length + 1, `${teamCards}`);
      await shot(page, 'p7-users.png');

      // My Profile: what I did lately.
      await page.goto(`${BASE}/account`);
      await page.getByRole('button', { name: 'View usage & activity' }).click();
      await page.waitForSelector('.activity-list li');
      const activity = await page.locator('.activity-list').textContent();
      check('my profile: what I did lately', /Updated an expense/.test(activity) && /Updated an approval/.test(activity), activity.slice(0, 200));
      await shot(page, 'p7-profile.png');

      // Workforce & Vehicles.
      await page.goto(`${BASE}/workforce`);
      await page.waitForSelector('.party-card');
      const raj = (await page.locator('.party-card', { hasText: 'Raju Driver' }).textContent()).replace(/\s+/g, ' ');
      check('workforce: the driver on a trip says so', /On trip/.test(raj), raj);
      await shot(page, 'p7-workforce.png');
      await page.goto(`${BASE}/vehicles`);
      await page.locator('.party-card', { hasText: 'KA01D10001' }).click();
      await page.waitForSelector('.detail >> text=Total trips');
      const overview = (await page.locator('.detail').textContent()).replace(/\s+/g, ' ');
      check('vehicle details: trips, KM, driver', new RegExp(`Total trips\\s*${km.trips}`).test(overview) && /Raju Driver/.test(overview), overview.slice(0, 300));
      await page.locator('.detail .trip-tabs button', { hasText: 'Trips' }).click();
      await page.waitForFunction((n) => document.querySelector('.detail')?.textContent.includes(n), trip.number);
      await page.waitForTimeout(300); // the tabs' colour fade
      await shot(page, 'p7-vehicle.png');

      // Collections & Payments: the farmers owed money.
      await page.goto(`${BASE}/collections`);
      await page.locator('.day-tabs button', { hasText: 'Farmer' }).click();
      await page.waitForSelector('.collection-card');
      const owed = await page.locator('.card-list').textContent();
      check('collections: the farmer tab lists who is owed, with Pay', /Ramesh Patil/.test(owed) && /Pay/.test(owed), owed.slice(0, 200));
      await shot(page, 'p7-collections-farmers.png');

      // Phone width: no sideways scroll on the new screens.
      await page.setViewportSize({ width: 390, height: 844 });
      let overflow = 0;
      for (const screen of ['/approvals', '/reports', '/settings', '/account']) {
        await page.goto(`${BASE}${screen}`);
        await page.waitForTimeout(400);
        overflow = Math.max(overflow, await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
      }
      check('phone width: no sideways scroll', overflow <= 0, `${overflow}px`);
      check('no errors in the browser', errors.length === 0, errors.slice(0, 3).join(' | '));
    } finally {
      await browser.close();
    }
    await owner.post(`/logistics/trips/${trip.id}/cancel`, { version: (await owner.get(`/logistics/trips/${trip.id}`)).version });
  } finally {
    await db.end();
  }
  console.log(results.join('\n'));
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);
})().catch((e) => {
  console.log(results.join('\n'));
  console.error('FAILED:', e.message);
  process.exit(1);
});
