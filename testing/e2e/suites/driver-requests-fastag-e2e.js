// What a driver asks the office for from the road (D10) — an advance, a new
// customer, a higher credit limit — and the owner's decision on each in the
// Approvals inbox, which does the thing itself: the advance paid through
// payroll, the customer created with its map pin, the limit set. Then the
// FASTag: the vehicle's tag, a recharge, tolls the driver pays by tag on a
// trip (off the tag's balance, never the driver's cash), a charge no trip
// recorded, and the owner told when it runs low.
// Runs last in the redesign chain: needs the driver-app suites' drivers and van.
const path = require('path');
const { API, BASE, PASSWORD, launchBrowser } = require('../lib/env');
const { randomUUID } = require('crypto');

const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`);

async function login(login) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password: PASSWORD }) });
  return (await r.json()).accessToken;
}
function client(token) {
  const call = async (method, path, body, headers = {}) => {
    const r = await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  const ok = async (method, path, body, headers) => {
    const r = await call(method, path, body, headers);
    if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  return { raw: call, get: (p) => ok('GET', p), post: (p, b = {}, h) => ok('POST', p, b, h), put: (p, b) => ok('PUT', p, b) };
}
const words = (r) => r.body?.error?.message ?? '';
const key = () => ({ 'idempotency-key': randomUUID() });

(async () => {
  const owner = client(await login('owner@dev.morbeez.local'));
  const driver = client(await login('driver@dev.morbeez.local'));
  const customers = (await owner.get('/customers?pageSize=100')).items;
  const sagar = customers.find((c) => c.name === 'Hotel Sagar');
  const tomato = (await owner.get('/products?pageSize=100')).items.find((p) => p.name === 'Tomato');
  const van = (await owner.get('/vehicles?pageSize=100')).items.find((v) => v.registrationNumber === 'KA01D10001');
  const raju = (await owner.get('/workforce?pageSize=100')).items.find((w) => w.name === 'Raju Driver');
  if (!van || !raju) throw new Error('run the driver-app suites first (the dev drivers and the van)');
  const rajuId = raju.employeeId ?? raju.id;
  const day = await driver.get('/logistics/trips/mine/day');
  const today = day.today;

  // A trip on the road: what the requests are made from, and the tolls paid on.
  const order = await owner.post('/orders', { customerId: sagar.id, deliveryDate: today, creditTermDays: 0, confirm: true, lines: [{ productId: tomato.id, quantity: 5, unitPrice: 30 }] });
  let trip = await owner.post('/logistics/trips', { vehicleId: van.id, driverEmployeeId: rajuId, plannedDate: today, orderIds: [order.id], advanceAmount: 1000 });
  let opening = Math.ceil(Number(day.lastOdometerKm ?? 0)) + 10;
  const tryStart = await driver.raw('POST', `/logistics/trips/${trip.id}/start`, { version: trip.version, openingKm: opening });
  if (tryStart.status === 400 && /last reading, ([\d.]+) km/.test(words(tryStart))) {
    opening = Math.ceil(Number(words(tryStart).match(/last reading, ([\d.]+) km/)[1])) + 10;
    trip = await driver.post(`/logistics/trips/${trip.id}/start`, { version: trip.version, openingKm: opening });
  } else if (tryStart.status >= 300) throw new Error(`start -> ${tryStart.status} ${words(tryStart)}`);
  else trip = tryStart.body;

  // ---- An advance ----
  const advanceId = randomUUID();
  const asked = await driver.post('/driver-requests/mine', { id: advanceId, kind: 'advance', tripId: trip.id, amount: 1500, reason: 'Tyre puncture at Gundlupet, need cash for the repair' });
  check('a driver asks for an advance from the road', asked.status === 'pending' && asked.amount === '1500.00' && asked.tripNumber === trip.number, JSON.stringify({ s: asked.status, a: asked.amount }));
  const resent = await driver.raw('POST', '/driver-requests/mine', { id: advanceId, kind: 'advance', tripId: trip.id, amount: 1500, reason: 'sent again from the queue' });
  check('sent again from the phone’s queue, it’s the same request', resent.status < 300 && resent.body.id === advanceId && resent.body.reason === asked.reason, `${resent.status}`);
  const changed = await driver.raw('POST', '/driver-requests/mine', { id: advanceId, kind: 'advance', amount: 3000, reason: 'more' });
  check('the same id for a different request is refused in words', changed.status === 409 && words(changed).length > 0, `${changed.status} ${words(changed)}`);
  const noAmount = await driver.raw('POST', '/driver-requests/mine', { kind: 'advance', reason: 'cash' });
  check('an advance without an amount is refused in words', noAmount.status === 400 && /how much/i.test(words(noAmount)), `${noAmount.status} ${words(noAmount)}`);

  let inbox = await owner.get('/dashboard/approvals');
  const item = inbox.items.find((i) => i.key === `driver_request:${advanceId}`);
  check('the owner’s Approvals inbox lists it under Expense', item?.kind === 'driver_request' && item.tab === 'expense' && item.refs.requestKind === 'advance' && item.amount === '1500.00' && item.by === 'Raju Driver',
    JSON.stringify(item));
  const alerts = await owner.get('/alerts?limit=50');
  check('the owner is alerted', alerts.some((a) => a.kind === 'driver_request' && a.title === 'Raju Driver asks for an advance of ₹1,500'), JSON.stringify(alerts.slice(0, 2).map((a) => a.title)));
  const over = await owner.raw('POST', `/driver-requests/${advanceId}/decision`, { approve: true, amount: 2000 });
  check('paying more than was asked is refused', over.status === 400, `${over.status} ${words(over)}`);
  const advancesBefore = (await owner.get(`/workforce/advances`)).filter((a) => a.employeeId === rajuId).length;
  const paid = await owner.post(`/driver-requests/${advanceId}/decision`, { approve: true, amount: 1000, paidFrom: 'bank', note: 'Sent by UPI' });
  const advancesAfter = (await owner.get(`/workforce/advances`)).filter((a) => a.employeeId === rajuId);
  check('approved, the advance is paid through payroll — for what the owner agreed', paid.status === 'approved' && paid.resultRef && advancesAfter.length === advancesBefore + 1 && advancesAfter.some((a) => a.id === paid.resultRef && Number(a.amount) === 1000),
    JSON.stringify({ s: paid.status, ref: paid.resultRef, n: advancesAfter.length }));
  const twice = await owner.raw('POST', `/driver-requests/${advanceId}/decision`, { approve: true });
  check('a request is decided once', twice.status === 409, `${twice.status} ${words(twice)}`);
  let mine = await driver.get('/logistics/trips/mine/approvals');
  const seenByDriver = mine.items.find((a) => a.id === advanceId);
  check('the driver sees it approved, with the owner’s word', seenByDriver?.kind === 'advance' && seenByDriver.status === 'approved' && seenByDriver.note === 'Sent by UPI', JSON.stringify(seenByDriver));

  // ---- Refused ----
  const refuseId = randomUUID();
  await driver.post('/driver-requests/mine', { id: refuseId, kind: 'advance', amount: 500, reason: 'Lunch money' });
  const noReason = await owner.raw('POST', `/driver-requests/${refuseId}/decision`, { approve: false });
  check('refusing needs a reason — the driver reads it', noReason.status === 400, `${noReason.status} ${words(noReason)}`);
  await owner.post(`/driver-requests/${refuseId}/decision`, { approve: false, note: 'Take it from the trip advance' });
  mine = await driver.get('/logistics/trips/mine/approvals');
  const refused = mine.items.find((a) => a.id === refuseId);
  check('the driver sees it rejected, and why', refused?.status === 'rejected' && refused.note === 'Take it from the trip advance', JSON.stringify(refused));

  // ---- A new customer ----
  const shopId = randomUUID();
  const shopName = `Sri Krishna Stores ${shopId.slice(0, 4)}`;
  await driver.post('/driver-requests/mine', { id: shopId, kind: 'new_customer', tripId: trip.id, customer: { name: shopName, phone: '9800000041', place: 'Gundlupet', latitude: 11.80871, longitude: 76.68834 }, reason: 'Wants 20 kg tomato daily' });
  inbox = await owner.get('/dashboard/approvals');
  check('a new customer waits under Other', inbox.items.some((i) => i.key === `driver_request:${shopId}` && i.tab === 'other' && i.subject.includes(shopName)), '');
  const shop = await owner.post(`/driver-requests/${shopId}/decision`, { approve: true, paymentTermsDays: 7 });
  const created = await owner.get(`/customers/${shop.resultRef}`);
  const pins = await owner.get('/logistics/pins');
  const pin = pins.find((p) => p.refId === shop.resultRef);
  check('approved, the customer is created as the driver described', created.name === shopName && created.contact.phone === '9800000041' && created.place === 'Gundlupet' && created.paymentTermsDays === 7, JSON.stringify({ n: created.name, p: created.contact, t: created.paymentTermsDays }));
  check('…with the map pin the driver dropped', pin && Number(pin.latitude) === 11.80871 && Number(pin.longitude) === 76.68834, JSON.stringify(pin));

  // ---- A credit limit ----
  const limitId = randomUUID();
  const wrongCustomer = await driver.raw('POST', '/driver-requests/mine', { kind: 'credit_limit', customerId: randomUUID(), amount: 5000, reason: 'x x x' });
  check('a limit for a customer who isn’t there is refused', wrongCustomer.status === 404, `${wrongCustomer.status}`);
  await driver.post('/driver-requests/mine', { id: limitId, kind: 'credit_limit', customerId: sagar.id, amount: 80000, reason: 'Big wedding order this week' });
  inbox = await owner.get('/dashboard/approvals');
  const limitItem = inbox.items.find((i) => i.key === `driver_request:${limitId}`);
  check('the inbox shows the limit now and the limit asked', /Hotel Sagar ₹60,000 → ₹80,000/.test(limitItem?.subject ?? ''), limitItem?.subject);
  await owner.post(`/driver-requests/${limitId}/decision`, { approve: true });
  const sagarNow = await owner.get(`/customers/${sagar.id}`);
  check('approved, the customer’s credit limit is set', Number(sagarNow.creditLimit) === 80000, sagarNow.creditLimit);

  // ---- FASTag ----
  const tagBase = `/fleet/vehicles/${van.id}/fastag`;
  const empty = await owner.get(tagBase);
  check('a vehicle without a tag shows none, at nothing', empty.tagId === null && empty.balance === '0.00' && empty.entries.length === 0, JSON.stringify({ t: empty.tagId, b: empty.balance }));
  await owner.put(tagBase, { tagId: '34161FA820328E4E00000B21', issuer: 'ICICI FASTag', lowBalance: 300 });
  const recharged = await owner.post(`${tagBase}/recharges`, { amount: 1000, rechargedOn: today, paidFrom: 'bank', reference: 'UPI 4421' });
  check('a recharge puts money on the tag', recharged.balance === '1000.00' && recharged.entries[0].kind === 'recharge', recharged.balance);

  const base = `/logistics/trips/${trip.id}`;
  const toll = await driver.post(`${base}/expenses`, { id: randomUUID(), category: 'toll', amount: 150, notes: 'Mysuru plaza', paidBy: 'fastag' }, key());
  check('a toll paid by FASTag is recorded as such', toll.paidBy === 'fastag', toll.paidBy);
  const fuel = await driver.raw('POST', `${base}/expenses`, { category: 'fuel', amount: 500, paidBy: 'fastag' }, key());
  check('fuel can’t be paid by FASTag', fuel.status === 400 && /toll or parking/.test(words(fuel)), `${fuel.status} ${words(fuel)}`);
  await driver.post(`${base}/expenses`, { id: randomUUID(), category: 'parking', amount: 40, notes: 'Market', paidBy: 'cash' }, key());
  const handover = await driver.get(`${base}/handover`);
  check('the driver’s handover counts only the cash spent, not the tag', Number(handover.expenses) === 40, JSON.stringify({ expenses: handover.expenses }));
  let tag = await owner.get(tagBase);
  check('the toll comes off the tag’s balance, with its trip', tag.balance === '850.00' && tag.entries.some((e) => e.kind === 'toll' && e.amount === '-150.00' && e.tripNumber === trip.number), JSON.stringify({ b: tag.balance, e: tag.entries.map((e) => e.kind) }));
  let low = (await owner.get('/alerts?limit=50')).filter((a) => a.kind === 'fastag_low');
  check('no warning while it’s above the threshold', low.length === 0, String(low.length));
  await driver.post(`${base}/expenses`, { id: randomUUID(), category: 'toll', amount: 600, notes: 'Walayar', paidBy: 'fastag' }, key());
  low = (await owner.get('/alerts?limit=50')).filter((a) => a.kind === 'fastag_low');
  check('below the threshold the owner is told to recharge', low.length === 1 && low[0].title === 'FASTag low on KA01D10001' && low[0].detail.includes('₹250'), JSON.stringify(low.map((a) => a.detail)));
  tag = await owner.post(`${tagBase}/charges`, { amount: 50, chargedOn: today, notes: 'Nanjangud plaza, not noted on a trip' });
  low = (await owner.get('/alerts?limit=50')).filter((a) => a.kind === 'fastag_low');
  check('a charge from the statement comes off too — and the warning isn’t repeated before a recharge', tag.balance === '200.00' && tag.low && low.length === 1, `${tag.balance} ${low.length}`);
  const noNote = await owner.raw('POST', `${tagBase}/charges`, { amount: 10, chargedOn: today, notes: '' });
  check('a charge says what it was', noNote.status === 400, `${noNote.status}`);
  const fleet = (await owner.get('/fleet/vehicles')).find((v) => v.vehicleId === van.id);
  check('the vehicle list shows the tag low', fleet?.fastag?.balance === '200.00' && fleet.fastag.low && fleet.issues.some((i) => i.startsWith('FASTag balance low')), JSON.stringify(fleet?.fastag));
  const myVan = await driver.get('/logistics/trips/mine/vehicle');
  check('the driver’s Vehicle screen shows the tag’s balance', myVan.vehicle?.fastag?.balance === '200.00' && myVan.vehicle.fastag.low === true, JSON.stringify(myVan.vehicle?.fastag));
  const expenses = await owner.get(`${base}/expenses`);
  check('the trip’s expenses say which were paid by FASTag', expenses.filter((e) => e.paidBy === 'fastag').length === 2 && expenses.filter((e) => e.paidBy === 'cash').length === 1, JSON.stringify(expenses.map((e) => e.paidBy)));

  // ---- The owner app: a request in Approvals, the tag on the vehicle ----
  const pendingId = randomUUID();
  await driver.post('/driver-requests/mine', { id: pendingId, kind: 'advance', tripId: trip.id, amount: 2500, reason: 'Diesel ran short near Hunsur' });
  const out = process.env.E2E_SCREENSHOTS;
  const browser = await launchBrowser();
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    await page.goto(`${BASE}/login`);
    await page.fill('#login', 'owner@dev.morbeez.local');
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL((u) => !/\/login/.test(u.toString()));

    await page.goto(`${BASE}/approvals`);
    const row = page.locator('.inbox-row[data-kind="driver_request"]', { hasText: 'Diesel ran short' });
    await row.waitFor();
    const rowText = (await row.textContent()).replace(/\s+/g, ' ');
    check('Approvals: the driver’s advance request, with why', /Advance request/.test(rowText) && /Raju Driver/.test(rowText) && /2,500/.test(rowText), rowText.slice(0, 200));
    if (out) await page.screenshot({ path: path.join(out, 'rt-approvals-driver-request.png'), fullPage: true });
    await row.getByRole('button', { name: 'Approve' }).click();
    await page.locator('dialog').getByText('Why: Diesel ran short near Hunsur').waitFor();
    if (out) await page.screenshot({ path: path.join(out, 'rt-approve-advance.png') });
    await page.locator('dialog').getByLabel('Amount to pay').fill('2000');
    await page.locator('dialog').getByRole('button', { name: 'Approve' }).click();
    await row.waitFor({ state: 'detached' });
    const decided = await owner.get(`/driver-requests/${pendingId}`);
    check('…approved from the dialog, for less than asked', decided.status === 'approved' && decided.amount === '2500.00' && !!decided.resultRef, decided.status);

    await page.goto(`${BASE}/vehicles`);
    await page.getByText('KA01D10001').first().click();
    await page.locator('.detail .fastag-balance').waitFor();
    const tagText = (await page.locator('.detail .fastag-balance').textContent()).replace(/\s+/g, ' ');
    check('Vehicles: the FASTag balance, low, with the tag', /200/.test(tagText) && /Recharge needed/.test(tagText) && /34161FA820328E4E00000B21/.test(tagText), tagText);
    if (out) await page.locator('.detail').screenshot({ path: path.join(out, 'rt-vehicle-fastag.png') });
  } finally {
    await browser.close();
  }

  console.log(results.join('\n'));
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);
})().catch((e) => {
  console.log(results.join('\n'));
  console.error('FAILED:', e.message);
  process.exit(1);
});
