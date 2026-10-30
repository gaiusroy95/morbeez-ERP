// Driver app V1, Phase D5 — backhaul (docs/redesign/driver-app-v1-plan.md;
// client spec §16–§17, the client's answer 6). A new trip for the dev
// driver (a farm, then a cash shop); the owner offers two backhauls and the
// driver takes one of their own. The driver skips one offer (with a reason;
// the owner hears), accepts the other and runs it after the last delivery —
// pickup reached, loaded (photo), drop reached, completed (photo) — in that
// order; the driver's own one, sent twice from the phone, is one backhaul,
// and the owner cancels it. The vehicle isn't back (Return) while a backhaul
// waits or is under way; the driver doesn't hand over until the rent is
// recorded. Rent paid in cash is income at once and part of the cash to hand
// over; the owner's close checks it; the owner app shows it. Runs in the
// redesign chain after collections-return-e2e.js.
const { API, BASE, DB_URL, PASSWORD, launchBrowser } = require('../lib/env');
const { Client } = require('pg');
const path = require('path');

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
const message = (r) => r.body?.error?.message ?? '';

(async () => {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
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
    if (!van || !raju) throw new Error('run driver-day-e2e.js first (the dev driver and the van)');
    const today = (await driver.get('/logistics/trips/mine/day')).today;

    // ---- Today's next trip: a farm, then a cash shop ----
    let po = await owner.post('/procurement/purchase-orders', { farmerId: ramesh.id, lines: [{ productId: tomato.id, expectedQuantity: 30, indicativePrice: 20 }] });
    po = await owner.post(`/procurement/purchase-orders/${po.id}/confirm`, { version: po.version });
    const pickup = await owner.post(`/procurement/purchase-orders/${po.id}/pickups`, {});
    const order = await owner.post('/orders', { customerId: sagar.id, deliveryDate: today, creditTermDays: 0, confirm: true, lines: [{ productId: tomato.id, quantity: 20, unitPrice: 30 }] });
    let trip = await owner.post('/logistics/trips', { vehicleId: van.id, driverEmployeeId: raju.employeeId ?? raju.id, plannedDate: today, pickupIds: [pickup.id], orderIds: [order.id] });
    const lastKm = Number((await driver.get('/logistics/trips/mine/day')).lastOdometerKm ?? 0);
    trip = await driver.post(`/logistics/trips/${trip.id}/start`, { version: trip.version, openingKm: lastKm + 10 });
    const stops = await driver.get(`/logistics/trips/${trip.id}/stops`);
    const farm = stops.find((s) => s.stopType === 'pickup');
    const shop = stops.find((s) => s.stopType === 'delivery');
    const base = `/logistics/trips/${trip.id}/backhauls`;

    // ---- The owner offers; the driver takes one of their own ----
    const a = await owner.post(base, { pickupPlace: 'Mysuru Market', dropPlace: 'Gundlupet Base', rent: 3500, hirerName: 'Ravi Traders', notes: 'Empty crates for the depot' });
    check('the owner offers a backhaul: pickup, drop, fixed rent — waiting for the driver', a.status === 'offered' && a.offeredBy === 'owner' && a.rent === '3500.00' && a.hirerName === 'Ravi Traders', JSON.stringify(a));
    const b = await owner.post(base, { pickupPlace: 'Nanjangud', dropPlace: 'Mysuru', rent: 1200 });
    const ownId = '00000000-0000-4000-8000-0000000d5001';
    const c = await driver.post(base, { id: ownId, pickupPlace: 'Gundlupet', dropPlace: 'Begur', rent: 800, hirerName: 'Shankar' });
    const cAgain = await driver.post(base, { id: ownId, pickupPlace: 'Gundlupet', dropPlace: 'Begur', rent: 800, hirerName: 'Shankar' });
    const listed = await driver.get(base);
    check('the driver’s own backhaul is accepted as it’s added — and sent twice from the phone, it’s one', c.id === ownId && c.status === 'accepted' && c.offeredBy === 'driver' && cAgain.id === ownId && listed.length === 3, JSON.stringify({ c: c.status, n: listed.length }));
    let alerts = await owner.get('/alerts?limit=50');
    check('the owner is told the driver took one', alerts.some((x) => x.title === 'The driver took a backhaul: Gundlupet → Begur' && x.tripId === trip.id), alerts.map((x) => x.title).slice(0, 4).join(' | '));

    // ---- Accept or skip ----
    const early = await driver.raw('POST', `${base}/${a.id}/steps`, { step: 'pickup_reached' });
    check('no step before accepting', early.status === 409 && message(early) === 'Accept the backhaul first', message(early));
    const noReason = await driver.raw('POST', `${base}/${b.id}/skip`, {});
    check('a skip needs a reason', noReason.status === 400, String(noReason.status));
    const skipped = await driver.post(`${base}/${b.id}/skip`, { reason: 'Vehicle needed back early' });
    check('the driver skips an offer, saying why', skipped.status === 'skipped' && skipped.skipReason === 'Vehicle needed back early');
    alerts = await owner.get('/alerts?limit=50');
    check('…and the owner hears', alerts.some((x) => x.title === 'Backhaul skipped: Nanjangud → Mysuru' && /Vehicle needed back early/.test(x.detail)), alerts.map((x) => x.title).slice(0, 4).join(' | '));
    const lateAccept = await driver.raw('POST', `${base}/${b.id}/accept`);
    check('a skipped offer can’t be accepted after all', lateAccept.status === 409, message(lateAccept));
    let accepted = await driver.post(`${base}/${a.id}/accept`);
    const acceptedAgain = await driver.post(`${base}/${a.id}/accept`);
    check('the driver accepts the other — once, however often it’s sent', accepted.status === 'accepted' && !!accepted.acceptedAt && acceptedAgain.version === accepted.version, `${accepted.status} v${accepted.version}/${acceptedAgain.version}`);

    // ---- After the last delivery, step by step ----
    const beforeDeliveries = await driver.raw('POST', `${base}/${a.id}/steps`, { step: 'pickup_reached' });
    check('a backhaul runs on the way back: not before the last delivery', beforeDeliveries.status === 409 && /Finish the 2 stop\(s\)/.test(message(beforeDeliveries)), message(beforeDeliveries));
    await driver.post(`/logistics/trips/${trip.id}/stops/${farm.id}/complete-pickup`, { lines: [{ productId: tomato.id, outcome: 'accepted', netQuantity: 30 }] });
    await driver.post(`/logistics/trips/${trip.id}/start-deliveries`);
    await driver.upload(`/logistics/trips/${trip.id}/stops/${shop.id}/photos`, { photoType: 'pod' });
    await driver.post(`/logistics/trips/${trip.id}/stops/${shop.id}/complete-delivery`, { recipientName: 'Manager', allUnloaded: true, qrToken: shop.party.qrToken });
    await driver.post(`/logistics/trips/${trip.id}/stops/${shop.id}/collections`, { amount: 600, method: 'cash' }, { 'idempotency-key': '00000000-0000-4000-8000-0000000d5002' });

    const outOfOrder = await driver.raw('POST', `${base}/${a.id}/steps`, { step: 'drop_reached' });
    check('the steps go in order', outOfOrder.status === 409 && message(outOfOrder) === 'Pickup reached comes first', message(outOfOrder));
    // Sent later from a phone that was offline: the time it happened there.
    const reachedAt = new Date((Date.parse(accepted.acceptedAt) + Date.now()) / 2).toISOString();
    accepted = await driver.post(`${base}/${a.id}/steps`, { step: 'pickup_reached', at: reachedAt });
    check('pickup reached, at the time it happened on the phone', new Date(accepted.pickupReachedAt).toISOString() === reachedAt, accepted.pickupReachedAt);
    const noLoadPhoto = await driver.raw('POST', `${base}/${a.id}/steps`, { step: 'loaded' });
    check('the load is photographed first', noLoadPhoto.status === 409 && message(noLoadPhoto) === 'Take a photo of the load first', message(noLoadPhoto));
    const loadPhoto = await driver.upload(`${base}/${a.id}/photos`, { photoType: 'load' });
    check('the load photo is kept with the backhaul', loadPhoto.status === 201 && loadPhoto.body?.photoType === 'load', `${loadPhoto.status}`);
    const loaded = await driver.post(`${base}/${a.id}/steps`, { step: 'loaded', at: new Date(Date.parse(reachedAt) - 60 * 60 * 1000).toISOString() });
    check('a phone clock behind never dates a step before the one before it', loaded.loadedAt === accepted.pickupReachedAt, `${loaded.loadedAt} ${accepted.pickupReachedAt}`);
    await driver.post(`${base}/${a.id}/steps`, { step: 'drop_reached' });
    const noDropPhoto = await driver.raw('POST', `${base}/${a.id}/steps`, { step: 'completed' });
    check('…and so is the drop', noDropPhoto.status === 409 && message(noDropPhoto) === 'Take a photo at the drop first', message(noDropPhoto));
    await driver.upload(`${base}/${a.id}/photos`, { photoType: 'drop' });
    const future = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    const done = await driver.post(`${base}/${a.id}/steps`, { step: 'completed', at: future });
    check('completed — a phone clock ahead of time never dates it in the future', done.status === 'completed' && new Date(done.completedAt) <= new Date() && done.photos.load === 1 && done.photos.drop === 1, JSON.stringify({ s: done.status, at: done.completedAt, p: done.photos }));

    // ---- Return, then the handover ----
    const notBack = await driver.raw('POST', `/logistics/trips/${trip.id}/closing-km`, { closingKm: lastKm + 120 });
    check("the vehicle isn't back while a backhaul is under way", notBack.status === 409 && message(notBack) === 'Finish the backhaul Gundlupet → Begur first, then record Return', message(notBack));
    const driverCancel = await driver.raw('POST', `${base}/${c.id}/cancel`, {});
    check('only the owner cancels a backhaul', driverCancel.status === 403, String(driverCancel.status));
    const cancelled = await owner.post(`${base}/${c.id}/cancel`, { reason: 'Shankar called it off' });
    check('the owner calls one off', cancelled.status === 'cancelled' && cancelled.cancelReason === 'Shankar called it off');
    trip = await driver.post(`/logistics/trips/${trip.id}/closing-km`, { closingKm: lastKm + 120 });
    check('then Return', trip.closingKm !== null);
    const lateOffer = await owner.raw('POST', base, { pickupPlace: 'Mysuru', dropPlace: 'Hunsur', rent: 900 });
    check('no offers once the vehicle is back', lateOffer.status === 409 && /already back/.test(message(lateOffer)), message(lateOffer));
    trip = await driver.get(`/logistics/trips/${trip.id}`);
    const unpaid = await driver.raw('POST', `/logistics/trips/${trip.id}/complete`, { version: trip.version, cashDeclared: 600 });
    check('no handover until the rent is recorded', unpaid.status === 409 && message(unpaid) === 'Record the payment for the backhaul Mysuru Market → Gundlupet Base first, before handing over', message(unpaid));

    // ---- The rent ----
    const tooMuch = await driver.raw('POST', `${base}/${a.id}/payment`, { method: 'cash', amount: 4000 });
    check('never more than the rent', tooMuch.status === 400 && /The rent is ₹3500.00/.test(message(tooMuch)), message(tooMuch));
    await driver.upload(`${base}/${a.id}/photos`, { photoType: 'payment' });
    const paid = await driver.post(`${base}/${a.id}/payment`, { method: 'cash', amount: 3500, note: 'Received from Mr. Ravi' });
    const paidAgain = await driver.post(`${base}/${a.id}/payment`, { method: 'cash', amount: 3500 });
    const otherPayment = await driver.raw('POST', `${base}/${a.id}/payment`, { method: 'upi', amount: 3500, reference: 'UTR1' });
    check('paid in cash, with its proof — sent again it’s the same payment, a different one is refused', paid.payment?.method === 'cash' && paid.payment.amount === '3500.00' && paid.photos.payment === 1 && paidAgain.version === paid.version && otherPayment.status === 409, JSON.stringify(paid.payment));
    const posted = (await db.query(
      `SELECT l.account_code, l.debit::text, l.credit::text FROM money.ledger_line l JOIN money.ledger_entry e ON e.id = l.entry_id
        WHERE e.entry_type = 'backhaul_income_received' AND e.source_id = $1 ORDER BY l.account_code`,
      [a.id],
    )).rows;
    check('the rent is income at once — the cash is with the driver', JSON.stringify(posted) === JSON.stringify([
      { account_code: 'backhaul_income', debit: '0.00', credit: '3500.00' },
      { account_code: 'cash_with_drivers', debit: '3500.00', credit: '0.00' },
    ]), JSON.stringify(posted));
    const handover = await driver.get(`/logistics/trips/${trip.id}/handover`);
    check('the cash to hand over includes the backhaul rent paid in cash', handover.backhaulCash === '3500.00' && handover.cashCollections === '600.00' && Number(handover.expected) === Number(trip.advanceAmount) + 4100, JSON.stringify(handover));
    trip = await driver.post(`/logistics/trips/${trip.id}/complete`, { version: trip.version, cashDeclared: Number(handover.expected) });
    check('then the driver hands over', trip.status === 'completed', trip.status);

    // ---- The owner's close ----
    const review = await owner.get(`/logistics/trips/${trip.id}/review`);
    const check8 = review.checklist.find((x) => x.area === 'backhaul');
    check(
      "the owner's close checks the backhaul: done and paid, or skipped with its reason (the cancelled one left out)",
      check8?.status === 'pass' && check8.detail === 'Mysuru Market → Gundlupet Base: ₹3500.00 received by cash; Nanjangud → Mysuru: skipped (Vehicle needed back early).',
      JSON.stringify(check8),
    );
    const closed = await owner.post(`/logistics/trips/${trip.id}/reconcile`, { version: trip.version, cashReturned: Number(handover.expected) });
    check('closed as a pass, the backhaul cash in the closure', closed.outcome === 'pass' && Number(closed.variance) === 0 && closed.backhaulCash === '3500.00' && closed.checklist.length === 8, JSON.stringify({ o: closed.outcome, v: closed.variance, b: closed.backhaulCash, n: closed.checklist.length }));
    const float = (await db.query(
      `SELECT COALESCE(SUM(l.debit - l.credit), 0)::text AS net FROM money.ledger_line l JOIN money.ledger_entry e ON e.id = l.entry_id
        WHERE l.account_code = 'cash_with_drivers' AND ((e.source_type = 'backhaul' AND e.source_id = $1) OR (e.entry_type = 'trip_reconciled' AND e.source_id = $2))`,
      [a.id, closed.id],
    )).rows[0].net;
    check("the handover settles the driver's float, backhaul cash and all", Number(float) === -600 - Number(trip.advanceAmount), float);

    // ---- The owner app ----
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
      await page.locator('.trip-tabs button', { hasText: 'Backhaul' }).click();
      await page.waitForSelector('.backhaul-card');
      const shown = (await page.locator('.detail').textContent()).replace(/\s+/g, ' ');
      check(
        "the trip's Backhaul tab: each one, its steps and its payment",
        /Mysuru Market → Gundlupet Base/.test(shown) && /Paid/.test(shown) && /3,500.*received by Cash/.test(shown) && /Skipped: Vehicle needed back early/.test(shown) && /Taken by the driver on the road/.test(shown) && /Cancelled: Shankar called it off/.test(shown),
        shown.slice(0, 600),
      );
      const out = process.env.E2E_SCREENSHOTS;
      if (out) await page.locator('.detail').screenshot({ path: path.join(out, 'owner-trip-backhaul.png') });
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
