// Master Spec v3 P1, end to end: the owner checks and publishes a trip and
// only then does its driver see it (§7.4–7.5, §58); a change to a published
// trip must keep it publishable; the driver runs it and submits; the owner
// closes it on twelve areas (§60); the driver's access ends at the close and
// a closed trip's record keeps nothing sensitive (§7.10, §58); a purchase
// walks the §11 lifecycle on the procurement board; Home shows yesterday's
// closures (Daily operations). Makes its own driver (with an app login),
// vehicle, farmer, customer and orders, so nothing else on the day confuses it.
const path = require('path');
const { randomUUID } = require('crypto');
const { Client } = require('pg');
const { API, BASE, DB_URL, PASSWORD, launchBrowser } = require('../lib/env');

const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`);

async function login(login, password = PASSWORD) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password }) });
  const body = await r.json();
  if (!body.accessToken) throw new Error(`login ${login}: ${r.status}`);
  return body.accessToken;
}
function client(token) {
  const call = async (method, p, body) => {
    const r = await fetch(`${API}${p}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  const ok = async (method, p, body) => {
    const r = await call(method, p, body);
    if (r.status >= 300) throw new Error(`${method} ${p} -> ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  return { raw: call, get: (p) => ok('GET', p), post: (p, b = {}) => ok('POST', p, b), patch: (p, b) => ok('PATCH', p, b) };
}
const words = (r) => r.body?.error?.message ?? '';
const SIGNED = { recipientName: 'Manager', signatureData: 'data:image/png;base64,iVBORw0KGgo=' };

(async () => {
  const owner = client(await login('owner@dev.morbeez.local'));
  const stamp = randomUUID().slice(0, 4).toUpperCase();
  const today = (await owner.get('/accounting/periods')).today;
  const addDays = (d, n) => {
    const x = new Date(`${d}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };

  // ---- A driver with an app login, and everything the trip needs ----
  const phone = '9800000096'; // dev placeholder
  const worker = await owner.post('/workforce/workers', { name: `Publish Driver ${stamp}`, roleType: 'driver', phone });
  const link = await owner.post(`/workforce/workers/${worker.employeeId}/login-link`, {});
  const token = new URL(link.link).searchParams.get('token');
  const setup = await fetch(`${API}/auth/password-setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, password: 'publish-driver-password-1' }) });
  if (setup.status >= 300) throw new Error(`password setup ${setup.status}`);
  const driver = client(await login(phone, 'publish-driver-password-1'));
  const driverId = worker.employeeId;
  // Buys from farmers on the road: level 3 and up (a new driver starts at 2).
  await owner.patch(`/delegation/drivers/${driverId}`, { delegationLevel: 4, standingDelegation: true });

  const van = await owner.post('/vehicles', { registrationNumber: `KA05PB${stamp}`.slice(0, 12), capacityKg: 100, fuelType: 'diesel' });
  const tomato = (await owner.get('/products?pageSize=100')).items.find((p) => p.name === 'Tomato');
  const farmer = await owner.post('/farmers', { name: `Publish Farm ${stamp}`, contact: { phone: '+919800000097' } });
  const customer = await owner.post('/customers', { name: `Publish Mart ${stamp}`, contact: { phone: '+919800000098' }, creditLimit: 100000, paymentTermsDays: 7 });
  let po = await owner.post('/procurement/purchase-orders', { farmerId: farmer.id, pickupDate: today, lines: [{ productId: tomato.id, expectedQuantity: 30, indicativePrice: 20 }] });
  po = await owner.post(`/procurement/purchase-orders/${po.id}/confirm`, { version: po.version });
  const pickup = await owner.post(`/procurement/purchase-orders/${po.id}/pickups`, {});
  const order = await owner.post('/orders', { customerId: customer.id, deliveryDate: today, creditTermDays: 7, confirm: true, lines: [{ productId: tomato.id, quantity: 20, unitPrice: 30 }] });
  const lifecycle = async () => (await owner.get('/procurement/board?day=all')).items.find((c) => c.id === po.id)?.lifecycle;
  check('a confirmed purchase not yet on a trip is CONFIRMED', (await lifecycle()) === 'confirmed', await lifecycle());

  // ---- R1: a draft is the owner's alone ----
  let trip = await owner.post('/logistics/trips', { vehicleId: van.id, driverEmployeeId: driverId, plannedDate: today, pickupIds: [pickup.id], orderIds: [order.id] });
  check('a new trip is a draft, not published', trip.stage === 'draft' && trip.publishedAt === null, trip.stage);
  check('on the board too', (await owner.get('/logistics/trips/board?day=all')).items.find((c) => c.id === trip.id)?.stage === 'draft');
  check('…and the purchase on it is ASSIGNED', (await lifecycle()) === 'assigned', await lifecycle());
  const day0 = await driver.get('/logistics/trips/mine/day');
  check('the driver sees nothing of a draft — not in their day', !day0.trip, JSON.stringify(day0.trip?.id ?? null));
  const peek = await driver.raw('GET', `/logistics/trips/${trip.id}`);
  const peekStops = await driver.raw('GET', `/logistics/trips/${trip.id}/stops`);
  const early = await driver.raw('POST', `/logistics/trips/${trip.id}/start`, { version: trip.version, openingKm: 10 });
  check('…nor by its id: the trip, its stops and starting it all answer "not found"', peek.status === 404 && peekStops.status === 404 && early.status === 404, `${peek.status} ${peekStops.status} ${early.status}`);
  const ownerStart = await owner.raw('POST', `/logistics/trips/${trip.id}/start`, { version: trip.version });
  check("the owner can't start a draft either", ownerStart.status === 409 && /isn't published yet/.test(words(ownerStart)), words(ownerStart));

  const checked = await owner.get(`/logistics/trips/${trip.id}/check`);
  const by = Object.fromEntries(checked.checks.map((c) => [c.check, c]));
  check('the Check: driver, vehicle, date, stops, quantities, capacity, credit, collections', Object.keys(by).join() === 'driver,vehicle,date,stops,quantities,capacity,credit,collections', Object.keys(by).join());
  check('…all pass: 20 kg to deliver and 30 kg to pick up on a 100 kg van', checked.checks.every((c) => c.status === 'pass') && by.capacity.detail === 'About 30 kg of 100 kg.', JSON.stringify(checked.checks.map((c) => [c.check, c.status, c.detail])));

  // A trip whose day has passed can't be published.
  const stale = await owner.post('/logistics/trips', { vehicleId: van.id, driverEmployeeId: driverId, plannedDate: addDays(today, -1) });
  const staleCheck = await owner.get(`/logistics/trips/${stale.id}/check`);
  const stalePublish = await owner.raw('POST', `/logistics/trips/${stale.id}/publish`, { version: stale.version });
  check('a failed check stops publishing, saying why', staleCheck.checks.find((c) => c.check === 'date').status === 'fail' && stalePublish.status === 409 && /has passed/.test(words(stalePublish)), words(stalePublish));
  await owner.post(`/logistics/trips/${stale.id}/cancel`, { version: stale.version });

  const wrongVersion = await owner.raw('POST', `/logistics/trips/${trip.id}/publish`, { version: trip.version + 5 });
  check('publishing a version the owner never checked is refused', wrongVersion.status === 409, `${wrongVersion.status}`);
  const published = await owner.post(`/logistics/trips/${trip.id}/publish`, { version: trip.version });
  check('published: its stage, when and by whom — its version unchanged', published.stage === 'published' && !!published.publishedAt && !!published.publishedBy && published.version === trip.version, JSON.stringify({ s: published.stage, v: published.version }));
  const twice = await owner.raw('POST', `/logistics/trips/${trip.id}/publish`, { version: trip.version });
  check('published once', twice.status === 409 && /already published/.test(words(twice)), words(twice));
  const day1 = await driver.get('/logistics/trips/mine/day');
  check('now it is in the driver’s day, with its stops', day1.trip?.id === trip.id && (await driver.get(`/logistics/trips/${trip.id}/stops`)).length === 2, day1.trip?.id ?? 'none');

  // A change to a published trip must keep it publishable.
  const heavy = await owner.post('/orders', { customerId: customer.id, deliveryDate: today, creditTermDays: 7, confirm: true, lines: [{ productId: tomato.id, quantity: 150, unitPrice: 30 }] });
  const tooMuch = await owner.raw('POST', `/logistics/trips/${trip.id}/stops/delivery`, { orderId: heavy.id });
  check('adding 150 kg to a published 100 kg van is refused — the driver already has the trip', tooMuch.status === 409 && /would break it/.test(words(tooMuch)) && /170 kg/.test(words(tooMuch)), words(tooMuch));
  check('…and nothing was added', (await owner.get(`/logistics/trips/${trip.id}/stops`)).length === 2);
  await owner.post(`/orders/${heavy.id}/cancel`, { version: heavy.version }).catch(() => null);

  // ---- The driver runs it (as the phone does: reads the odometer, arrives, completes) ----
  trip = await driver.post(`/logistics/trips/${trip.id}/start`, { version: trip.version, openingKm: Math.ceil(Number(day1.lastOdometerKm ?? 0)) + 10 });
  const opening = Number(trip.openingKm);
  const stops = await driver.get(`/logistics/trips/${trip.id}/stops`);
  const farm = stops.find((s) => s.stopType === 'pickup');
  const shop = stops.find((s) => s.stopType === 'delivery');
  await driver.post(`/logistics/trips/${trip.id}/stops/${farm.id}/arrive`, {});
  check('at the farm: PICKUP', (await lifecycle()) === 'pickup', await lifecycle());
  await driver.post(`/logistics/trips/${trip.id}/stops/${farm.id}/complete-pickup`, { lines: [{ productId: tomato.id, outcome: 'accepted', netQuantity: 20 }] });
  check('20 kg of the 30 expected: PARTIALLY PICKED', (await lifecycle()) === 'partially_picked', await lifecycle());
  await driver.post(`/logistics/trips/${trip.id}/start-deliveries`, {});
  await driver.post(`/logistics/trips/${trip.id}/stops/${shop.id}/arrive`, {});
  await driver.post(`/logistics/trips/${trip.id}/stops/${shop.id}/complete-delivery`, SIGNED);
  await driver.post(`/logistics/trips/${trip.id}/closing-km`, { closingKm: opening + 42 });
  const handover = await driver.get(`/logistics/trips/${trip.id}/handover`);
  trip = await driver.post(`/logistics/trips/${trip.id}/complete`, { version: (await driver.get(`/logistics/trips/${trip.id}`)).version, cashDeclared: Number(handover.expected) });
  check('submitted by the driver', trip.stage === 'submitted', trip.stage);

  // ---- R3: twelve areas ----
  const review = await owner.get(`/logistics/trips/${trip.id}/review`);
  const areas = Object.fromEntries((review.checklist ?? []).map((c) => [c.area, c]));
  check('the close checks twelve areas', ['procurement', 'deliveries', 'load', 'returns', 'collections', 'handover', 'expenses', 'workforce', 'workload', 'vehicle', 'exceptions', 'accounting'].every((a) => areas[a]) && review.checklist.length === 12,
    Object.keys(areas).join());
  check('…each passes on a trip that went to plan', review.checklist.every((c) => c.status === 'pass'), JSON.stringify(review.checklist.filter((c) => c.status !== 'pass')));
  check('…saying what it found: the driver’s work, both stops’ times, 42 km', /work on this trip is recorded/.test(areas.workforce.detail) && areas.workload.detail === 'Arrival and completion times recorded at all 2 stops.' && areas.vehicle.detail.startsWith('42 km'),
    `${areas.workforce.detail} | ${areas.workload.detail} | ${areas.vehicle.detail}`);
  const closed = await owner.post(`/logistics/trips/${trip.id}/reconcile`, { version: trip.version, cashReturned: Number(handover.expected) });
  check('closed as a pass', closed.outcome === 'pass' && closed.checklist.length === 12, closed.outcome);

  // ---- R4: the driver's access ends at the close ----
  const day2 = await driver.get('/logistics/trips/mine/day');
  check('a closed trip leaves the driver’s day (the phone keeps only the day’s trip, DRV.3)', day2.trip?.id !== trip.id, day2.trip?.id ?? 'none');
  const liveStops = await driver.raw('GET', `/logistics/trips/${trip.id}/stops`);
  const liveCollections = await driver.raw('GET', `/logistics/trips/${trip.id}/collections`);
  check('its stops and collections are closed to the driver', liveStops.status === 409 && /is closed/.test(words(liveStops)) && liveCollections.status === 409, `${liveStops.status} ${liveCollections.status}`);
  const summary = await driver.get(`/logistics/trips/${trip.id}/summary`);
  check('its record stays: the summary, without phones, addresses, pins, QR or what customers owe',
    summary.closed?.at && summary.stops.length === 2 && summary.stops.every((s) => !s.party || (s.party.phone === null && s.party.address === null && s.party.latitude === null && !s.party.qrToken)) && summary.collections === null,
    JSON.stringify(summary.stops.map((s) => s.party?.phone)));
  const incentives = await driver.raw('GET', `/logistics/trips/${trip.id}/incentives`);
  const record = await driver.raw('GET', `/logistics/trips/${trip.id}`);
  check('…and its incentives and the trip itself', incentives.status === 200 && record.status === 200, `${incentives.status} ${record.status}`);
  const ownerStops = await owner.get(`/logistics/trips/${trip.id}/stops`);
  check('the owner still sees everything', ownerStops.some((s) => s.party?.phone), '');

  // ---- R7: yesterday at a glance (the close moved to yesterday, as if the owner closed it then) ----
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  try {
    await db.query("UPDATE fulfilment.trip_reconciliation SET reconciled_at = reconciled_at - interval '1 day' WHERE trip_id = $1", [trip.id]);
  } finally {
    await db.end();
  }
  const home = await owner.get('/dashboard/home?period=today');
  check('Home: yesterday’s closures — passed, cash, shortfalls', home.yesterday.date === addDays(today, -1) && home.yesterday.closed >= 1 && home.yesterday.pass >= 1, JSON.stringify(home.yesterday));

  // ---- The owner app ----
  const draft = await owner.post('/logistics/trips', { vehicleId: van.id, driverEmployeeId: driverId, plannedDate: today });
  const out = process.env.E2E_SCREENSHOTS;
  const browser = await launchBrowser();
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    await page.goto(`${BASE}/login`);
    await page.fill('#login', 'owner@dev.morbeez.local');
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL((u) => !/\/login/.test(u.toString()));

    await page.goto(`${BASE}/logistics?open=${draft.id}`);
    await page.getByText('Draft — not published').waitFor();
    await page.getByRole('button', { name: 'Check & publish' }).click();
    await page.locator('.trip-checks li').first().waitFor();
    const checksText = (await page.locator('.trip-checks').textContent()).replace(/\s+/g, ' ');
    check('Trips: a draft says so; Check & publish lists every check (no stops is only a warning)', /No stops/.test(checksText) && (await page.locator('.trip-checks li').count()) === 8, checksText.slice(0, 200));
    if (out) await page.screenshot({ path: path.join(out, 'p1-trip-check.png') });
    // Wait for the publish itself — another trip's card already reads "Published".
    const [answer] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/logistics/trips/${draft.id}/publish`) && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Publish to the driver' }).click(),
    ]);
    await page.locator('.detail', { hasText: 'Published' }).waitFor();
    check('…published from the page', answer.ok() && (await owner.get(`/logistics/trips/${draft.id}`)).stage === 'published', String(answer.status()));
    if (out) await page.screenshot({ path: path.join(out, 'p1-trip-published.png'), fullPage: true });

    await page.goto(`${BASE}/procurement`);
    await page.locator('.list-card', { hasText: `Publish Farm ${stamp}` }).first().click();
    await page.getByText('Where it stands').waitFor();
    const panel = (await page.locator('.detail').textContent()).replace(/\s+/g, ' ');
    check('Procurement: the purchase says where it stands (§11)', /Where it stands\s*Partially picked/.test(panel), panel.slice(0, 200));
    if (out) await page.screenshot({ path: path.join(out, 'p1-procurement-lifecycle.png'), fullPage: true });

    await page.goto(`${BASE}/dashboard`);
    await page.getByRole('heading', { name: 'Yesterday' }).waitFor();
    const y = (await page.locator('.yesterday-card').textContent()).replace(/\s+/g, ' ');
    check('Home: yesterday, at a glance', /trip\(s\) closed/.test(y) && /pass/.test(y), y);
    if (out) await page.screenshot({ path: path.join(out, 'p1-home-yesterday.png'), fullPage: true });
  } finally {
    await browser.close();
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
