// Driver app V1, Phase D4 — collections, return, handover
// (docs/redesign/driver-app-v1-plan.md; client spec §18–§23). Picks up the
// dev driver's trip from driver-day-e2e.js (on the road, opening KM 48650)
// and finishes it as the driver: the farm, the shop, then collections — only
// the customers delivered on the trip, with what they owe in all; partial,
// someone else paying with a UPI reference, a disputed amount that goes to
// the owner (the driver can't settle it) — the handover counting cash only,
// no handover before the closing KM, Return never below the opening KM, and
// the next trip's last reading is the closing KM. The owner sees the trip
// KM. Runs in the redesign chain after delivery-stop-e2e.js.
const { API, BASE, DB_URL, PASSWORD, launchBrowser } = require('../lib/env');
const { Client } = require('pg');

const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`);

async function login(login) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password: PASSWORD }) });
  return (await r.json()).accessToken;
}
function client(token) {
  const call = async (method, path, body, headers = {}) => {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  const ok = async (method, path, body, headers) => {
    const r = await call(method, path, body, headers);
    if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const upload = async (path, fields) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
    form.append('file', new Blob([jpeg], { type: 'image/jpeg' }), 'photo.jpg');
    const r = await fetch(`${API}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { raw: call, get: (p) => ok('GET', p), post: (p, b = {}, h) => ok('POST', p, b, h), upload };
}

(async () => {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  try {
    const owner = client(await login('owner@dev.morbeez.local'));
    const driver = client(await login('driver@dev.morbeez.local'));
    const products = (await owner.get('/products?pageSize=100')).items;
    const tomato = products.find((p) => p.name === 'Tomato');

    // ---- The driver's trip from driver-day-e2e.js: on the road ----
    let day = await driver.get('/logistics/trips/mine/day');
    let trip = day.trip;
    if (!trip || trip.status !== 'in_progress') throw new Error('run driver-day-e2e.js first (the driver’s trip on the road)');
    let stops = await driver.get(`/logistics/trips/${trip.id}/stops`);
    const farm = stops.find((s) => s.stopType === 'pickup');
    const shop = stops.find((s) => s.stopType === 'delivery');
    const before = await driver.get(`/logistics/trips/${trip.id}/collections`);
    check('nothing to collect before a delivery: only delivered customers are listed', before.customers.length === 0 && before.collected.total === '0.00', JSON.stringify(before));

    await driver.post(`/logistics/trips/${trip.id}/stops/${farm.id}/complete-pickup`, { lines: [{ productId: tomato.id, outcome: 'accepted', netQuantity: 120 }] });
    await driver.post(`/logistics/trips/${trip.id}/start-deliveries`);
    await driver.upload(`/logistics/trips/${trip.id}/stops/${shop.id}/photos`, { photoType: 'pod' });
    await driver.post(`/logistics/trips/${trip.id}/stops/${shop.id}/complete-delivery`, { recipientName: 'Manager', allUnloaded: true, qrToken: shop.party.qrToken });

    // ---- Collections: the delivered customer, with all they owe ----
    let board = await driver.get(`/logistics/trips/${trip.id}/collections`);
    const sagar = board.customers.find((c) => c.name === 'Hotel Sagar');
    const owed = (await db.query(
      `SELECT (COALESCE((SELECT SUM(outstanding) FROM money.invoice_balance WHERE customer_id = $1), 0)
              - COALESCE((SELECT SUM(unapplied) FROM money.customer_credit_balance WHERE customer_id = $1), 0))::numeric(12,2)::text AS owed`,
      [shop.party.id],
    ).catch(() => ({ rows: [{ owed: null }] }))).rows[0].owed;
    check('the delivered customer is listed with their whole outstanding — more than this trip’s invoice', board.customers.length === 1 && !!sagar && Number(sagar.outstanding) >= 3000 && (owed === null || sagar.outstanding === owed) && sagar.terms === 'cash' && sagar.stopId === shop.id, JSON.stringify({ sagar, owed }));
    const whole = Number(sagar.outstanding);

    // Partial, in cash.
    await driver.post(`/logistics/trips/${trip.id}/stops/${shop.id}/collections`, { amount: 1000, method: 'cash' }, { 'idempotency-key': '00000000-0000-4000-8000-0000000d4001' });
    // Someone else, by UPI, with its reference.
    const noName = await driver.raw('POST', `/logistics/trips/${trip.id}/stops/${shop.id}/collections`, { amount: 500, method: 'upi', payer: 'third_party' });
    check('someone paying on their behalf must be named', noName.status === 400 && /say who/.test(noName.body?.error?.message ?? ''), noName.body?.error?.message);
    const upi = await driver.post(`/logistics/trips/${trip.id}/stops/${shop.id}/collections`, { amount: 500, method: 'upi', payer: 'third_party', payerName: 'Ravi (son)', reference: 'UTR4711' });
    check('…and it’s recorded who paid, with the UPI reference', upi.payer === 'third_party' && upi.payerName === 'Ravi (son)' && upi.reference === 'UTR4711' && upi.intoDriverFloat === false, JSON.stringify(upi));
    const payment = (await db.query('SELECT reference, notes FROM money.customer_payment WHERE collection_id = $1', [upi.id])).rows[0];
    check('the payment carries the reference and who paid', payment?.reference === 'UTR4711' && /Paid by Ravi \(son\)/.test(payment?.notes ?? ''), JSON.stringify(payment));
    board = await driver.get(`/logistics/trips/${trip.id}/collections`);
    const after = board.customers.find((c) => c.name === 'Hotel Sagar');
    check('a partial collection keeps them on the list, with the balance', after.collectedOnTrip === '1500.00' && Number(after.outstanding) === whole - 1500 && board.pending.customers === 1, JSON.stringify(after));
    check('collected on the trip, by how it was paid', board.collected.cash === '1000.00' && board.collected.upi === '500.00' && board.collected.total === '1500.00', JSON.stringify(board.collected));

    // A disputed amount goes to the owner.
    const dispute = await driver.post(`/logistics/trips/${trip.id}/stops/${shop.id}/disputes`, { amount: 200, reason: 'Two crates of tomato were soft' });
    const again = await driver.post(`/logistics/trips/${trip.id}/stops/${shop.id}/disputes`, { amount: 200, reason: 'Two crates of tomato were soft' });
    check('a dispute is raised on the delivery’s invoice — once, however often it’s sent', dispute.status === 'open' && Number(dispute.amount) === 200 && again.id === dispute.id, JSON.stringify({ d: dispute.id, a: again.id }));
    const closeIt = await driver.raw('POST', `/finance/disputes/${dispute.id}/close`, { version: dispute.version, outcome: 'resolved', resolution: 'ok' });
    check("the driver can't settle it — that's the owner's", closeIt.status === 403, String(closeIt.status));
    board = await driver.get(`/logistics/trips/${trip.id}/collections`);
    check('what’s disputed waits with the owner and comes off what’s pending', board.customers[0].disputed === '200.00' && Number(board.pending.amount) === whole - 1500 - 200, JSON.stringify(board.pending));
    const alerts = await owner.get('/alerts?limit=50');
    check('the owner is told of the dispute', alerts.some((a) => a.kind === 'collection_discrepancy' && a.title === 'Hotel Sagar disputes ₹200.00' && a.tripId === trip.id), alerts.map((a) => a.title).slice(0, 5).join(' | '));

    // ---- Handover counts cash only ----
    const handover = await driver.get(`/logistics/trips/${trip.id}/handover`);
    check('the handover expects the cash collected, never UPI', handover.cashCollections === '1000.00' && handover.directPayments === '500.00', JSON.stringify(handover));

    // ---- Return ----
    const early = await driver.raw('POST', `/logistics/trips/${trip.id}/complete`, { version: trip.version, cashDeclared: Number(handover.expected) });
    check('no handover before the closing KM', early.status === 409 && /closing KM/.test(early.body?.error?.message ?? ''), early.body?.error?.message);
    const low = await driver.raw('POST', `/logistics/trips/${trip.id}/closing-km`, { closingKm: 48600 });
    check('closing KM below the opening KM is refused', low.status === 400 && /below the opening KM, 48650/.test(low.body?.error?.message ?? ''), low.body?.error?.message);
    trip = await driver.post(`/logistics/trips/${trip.id}/closing-km`, { closingKm: 48842 });
    check('Return records the closing KM and when — trip KM 192', trip.closingKm === '48842.0' && !!trip.returnedAt && Number(trip.closingKm) - Number(trip.openingKm) === 192, JSON.stringify({ c: trip.closingKm, o: trip.openingKm }));

    // ---- Hand over ----
    trip = await driver.get(`/logistics/trips/${trip.id}`);
    trip = await driver.post(`/logistics/trips/${trip.id}/complete`, { version: trip.version, cashDeclared: Number(handover.expected), note: 'All collected' });
    check('handed over: the trip waits for the owner, with the cash declared', trip.status === 'completed' && Number(trip.cashDeclared) === Number(handover.expected), JSON.stringify({ s: trip.status, c: trip.cashDeclared }));
    const lateReturn = await driver.raw('POST', `/logistics/trips/${trip.id}/closing-km`, { closingKm: 48900 });
    check('a handed-over trip can’t come back again', lateReturn.status === 409, String(lateReturn.status));

    // ---- The next trip starts from the closing KM ----
    const van = (await owner.get('/vehicles?pageSize=100')).items.find((v) => v.registrationNumber === 'KA01D10001');
    const raju = (await owner.get('/workforce?pageSize=100')).items.find((w) => w.name === 'Raju Driver');
    const today = (await driver.get('/logistics/trips/mine/day')).today;
    const next = await owner.post('/logistics/trips', { vehicleId: van.id, driverEmployeeId: raju.employeeId ?? raju.id, plannedDate: today });
    day = await driver.get('/logistics/trips/mine/day');
    check("the next trip's last reading is this trip's closing KM", day.trip?.id === next.id && day.lastOdometerKm === '48842.0', JSON.stringify({ trip: day.trip?.id === next.id, km: day.lastOdometerKm }));
    await owner.post(`/logistics/trips/${next.id}/cancel`, { version: next.version });

    // ---- The owner's trip details ----
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
      await page.goto(`${BASE}/login`);
      await page.fill('#login', 'owner@dev.morbeez.local');
      await page.fill('#password', PASSWORD);
      await page.click('button[type=submit]');
      await page.waitForURL((u) => !/\/login/.test(u.toString()));
      await page.goto(`${BASE}/logistics`);
      await page.waitForSelector('.day-tabs button');
      await page.locator('.day-tabs button', { hasText: 'All' }).click();
      await page.locator('.list-card', { hasText: trip.number }).click();
      await page.waitForFunction((n) => document.querySelector('.detail')?.textContent.includes(n), trip.number);
      const shown = (await page.locator('.detail').textContent()).replace(/\s+/g, ' ');
      check("the owner's trip details show the opening, closing and trip KM", /Opening KM\s*48,?650/.test(shown) && /Closing KM\s*48,?842/.test(shown) && /Trip KM\s*192/.test(shown), shown.slice(0, 500));
    } finally {
      await browser.close();
    }
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
