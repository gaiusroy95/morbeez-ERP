// Driver app V1, Phase D6 — expenses, approvals, trips, vehicle
// (docs/redesign/driver-app-v1-plan.md; design sheets "New Expense", "My
// Expenses", the tablet's Approvals, Trip History, Trip Details, Vehicle).
// On a new trip for the dev driver (a cash shop): below level 4 the driver
// records expenses the owner approves, rejects or leaves waiting; then
// parking, loading, a repair and two fills at the pump —
// odometer, fuel type, full tank or not, litres and rate, each checked — with
// the bill photographed. Parking is booked with tolls, a repair with the
// vehicle's repairs; the fills join the vehicle's fuel and its mileage, full
// tank to full tank; Return can't read less than the pump. Then the driver's
// own views: My Expenses (with the mileage), Approvals (what the owner
// decided and what still waits), Trip History, one trip in full, the
// vehicle (what's due and in force, nothing of its books) and the profile.
// The owner app shows the fill on the trip and in the vehicle's fuel. Runs
// last in the redesign chain.
const { API, BASE, DB_URL, PASSWORD, launchBrowser } = require('../lib/env');
const { Client } = require('pg');
const path = require('path');
const { randomUUID } = require('crypto');

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
  const upload = async (path) => {
    const form = new FormData();
    form.append('photoType', 'bill');
    const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
    form.append('file', new Blob([jpeg], { type: 'image/jpeg' }), 'bill.jpg');
    const r = await fetch(`${API}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { raw: call, get: (p) => ok('GET', p), post: (p, b = {}, h) => ok('POST', p, b, h), upload };
}
const message = (r) => r.body?.error?.message ?? '';
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

(async () => {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  try {
    const owner = client(await login('owner@dev.morbeez.local'));
    const driver = client(await login('driver@dev.morbeez.local'));
    const sagar = (await owner.get('/customers?pageSize=100')).items.find((c) => c.name === 'Hotel Sagar');
    const tomato = (await owner.get('/products?pageSize=100')).items.find((p) => p.name === 'Tomato');
    const vanRecord = (await owner.get('/vehicles?pageSize=100')).items.find((v) => v.registrationNumber === 'KA01D10001');
    const raju = (await owner.get('/workforce?pageSize=100')).items.find((w) => w.name === 'Raju Driver');
    if (!vanRecord || !raju) throw new Error('run the driver-app suites first (the dev driver and the van)');
    const rajuId = raju.employeeId ?? raju.id;
    const day = await driver.get('/logistics/trips/mine/day');
    const today = day.today;
    const van = vanRecord.id;

    // ---- Today's next trip: a cash shop ----
    const order = await owner.post('/orders', { customerId: sagar.id, deliveryDate: today, creditTermDays: 0, confirm: true, lines: [{ productId: tomato.id, quantity: 5, unitPrice: 30 }] });
    let trip = await owner.post('/logistics/trips', { vehicleId: van, driverEmployeeId: rajuId, plannedDate: today, orderIds: [order.id] });
    const opening = Math.ceil(Number(day.lastOdometerKm ?? 0)) + 10;
    trip = await driver.post(`/logistics/trips/${trip.id}/start`, { version: trip.version, openingKm: opening });
    const base = `/logistics/trips/${trip.id}/expenses`;
    // What the phone sends: each action its own key, each expense its own id.
    const keys = new Map();
    const key = (n) => ({ 'idempotency-key': keys.get(n) ?? keys.set(n, randomUUID()).get(n) });

    // ---- Below level 4, the owner decides: one approved, one rejected, one still waiting ----
    await db.query('UPDATE trading_partners.employee SET delegation_level = 2 WHERE id = $1', [rajuId]);
    let toll;
    let tea;
    let waiting;
    try {
      toll = await driver.post(base, { category: 'toll', amount: 60 }, key(20));
      tea = await driver.post(base, { category: 'other', amount: 80, notes: 'Tea for the loaders' }, key(21));
      waiting = await driver.post(base, { category: 'parking', amount: 40 }, key(22));
    } finally {
      await db.query('UPDATE trading_partners.employee SET delegation_level = 4 WHERE id = $1', [rajuId]);
    }
    await owner.post(`${base}/${toll.id}/decision`, { approve: false, note: 'No toll on this route' });
    await owner.post(`${base}/${tea.id}/decision`, { approve: true });

    // The owner's own full tank at the pump the morning the trip set off.
    await owner.post('/fleet/fuel', { vehicleId: van, filledOn: today, litres: 40, amount: 3700, odometerKm: opening, paidFrom: 'cash_on_hand' });

    // ---- The categories: parking with tolls, loading, a repair with the vehicle's repairs ----
    const parking = await driver.post(base, { category: 'parking', amount: 50, notes: 'Devaraja Market' }, key(1));
    const loading = await driver.post(base, { category: 'labour', amount: 300, notes: 'Farm loading' }, key(2));
    const repair = await driver.post(base, { category: 'repair', amount: 1200, notes: 'Tyre patch' }, key(3));
    check('parking, loading and a repair, as the driver chooses them', parking.category === 'parking' && loading.category === 'labour' && repair.category === 'repair' && parking.fuel === null && parking.photos === 0);
    const booked = (await db.query(
      `SELECT e.source_id, l.account_code FROM money.ledger_line l JOIN money.ledger_entry e ON e.id = l.entry_id
        WHERE e.entry_type = 'trip_expense_recorded' AND e.source_id = ANY($1) AND l.debit > 0`,
      [[parking.id, repair.id, loading.id]],
    )).rows;
    const accountOf = (id) => booked.find((b) => b.source_id === id)?.account_code;
    check('parking is booked with tolls, a repair with the vehicle’s repairs, loading as loading labour', accountOf(parking.id) === 'trip_expense_toll' && accountOf(repair.id) === 'repairs_maintenance' && accountOf(loading.id) === 'trip_expense_labour', JSON.stringify(booked));

    // ---- A fill at the pump ----
    const partId = randomUUID();
    const fullId = randomUUID();
    const pumpOnToll = await driver.raw('POST', base, { category: 'toll', amount: 120, odometerKm: opening + 10 }, key(4));
    check('only fuel has an odometer, a fuel type, litres and a rate', pumpOnToll.status === 400 && /Only a fuel expense/.test(message(pumpOnToll)), message(pumpOnToll));
    const halfDetails = await driver.raw('POST', base, { category: 'fuel', amount: 925, litres: 10 }, key(5));
    check('litres and the rate go together', halfDetails.status === 400 && /go together/.test(message(halfDetails)), message(halfDetails));
    const wrongBill = await driver.raw('POST', base, { category: 'fuel', amount: 1000, litres: 10, ratePerLitre: 92.5, odometerKm: opening + 150 }, key(6));
    check('the bill must be litres × rate (within a rupee)', wrongBill.status === 400 && wrongBill.body?.error?.message === "₹1000.00 doesn't match 10 L at ₹92.50 a litre (₹925.00)", message(wrongBill));
    const behind = await driver.raw('POST', base, { category: 'fuel', amount: 925, litres: 10, ratePerLitre: 92.5, odometerKm: opening - 1 }, key(7));
    check('the odometer at the pump never reads less than when the trip set off', behind.status === 400 && /when the trip set off/.test(message(behind)), message(behind));

    const part = await driver.post(base, { id: partId, category: 'fuel', amount: 925, litres: 10, ratePerLitre: 92.5, odometerKm: opening + 150, fuelType: 'diesel', fullTank: false, notes: 'IOCL Gundlupet' }, key(8));
    const partAgain = await driver.post(base, { id: partId, category: 'fuel', amount: 925, litres: 10, ratePerLitre: 92.5, odometerKm: opening + 150, fuelType: 'diesel', fullTank: false }, key(8));
    check(
      'a part fill, its pump details kept — and sent twice from the phone, it’s one',
      part.id === partId && part.fuel?.litres === '10.000' && part.fuel.ratePerLitre === '92.50' && part.fuel.fullTank === false && part.fuel.odometerKm === opening + 150 && part.fuel.fuelType === 'diesel' && partAgain.id === partId,
      JSON.stringify(part.fuel),
    );
    const sameIdOther = await driver.raw('POST', base, { id: partId, category: 'fuel', amount: 500 }, key(9));
    check('the same id with something else is refused', sameIdOther.status === 409, `${sameIdOther.status} ${message(sameIdOther)}`);
    const earlier = await driver.raw('POST', base, { category: 'fuel', amount: 925, litres: 10, ratePerLitre: 92.5, odometerKm: opening + 100 }, key(10));
    check('never below an earlier fill on the trip', earlier.status === 400 && new RegExp(`earlier fill on this trip read ${opening + 150} km`).test(message(earlier)), message(earlier));
    const full = await driver.post(base, { id: fullId, category: 'fuel', amount: 2775, litres: 30, ratePerLitre: 92.5, odometerKm: opening + 300, fuelType: 'diesel', fullTank: true }, key(11));
    check('a full tank', full.fuel?.fullTank === true && full.amount === '2775.00');

    // ---- The bill ----
    const bill = await driver.upload(`${base}/${fullId}/photos`);
    check('the bill is kept with the expense', bill.status === 201 && bill.body?.expenseId === fullId, `${bill.status} ${JSON.stringify(bill.body)}`);
    const nowhere = await driver.upload(`${base}/${randomUUID()}/photos`);
    check('…only with an expense on this trip', nowhere.status === 404, String(nowhere.status));
    const listed = await driver.get(base);
    check('the trip’s expenses carry their pump details and bills', listed.find((e) => e.id === fullId)?.photos === 1 && listed.find((e) => e.id === partId)?.fuel?.litres === '10.000', String(listed.length));

    // ---- The vehicle's fuel and mileage ----
    const fuelList = await owner.get(`/fleet/fuel?from=${today}&to=${today}&vehicleId=${van}`);
    const fill = fuelList.find((f) => f.id === fullId);
    check(
      'the driver’s fills join the vehicle’s fuel, paid from the trip’s cash',
      fuelList.filter((f) => f.tripId === trip.id && f.source === 'trip_expense').length === 2 && fill?.source === 'trip_expense' && fill.paidFrom === 'cash_with_drivers' && fill.tripId === trip.id && fill.fullTank === true && fill.litres === '30.000' && fuelList.some((f) => f.source === 'fuel_log'),
      JSON.stringify(fuelList.map((f) => `${f.source}:${f.litres}:${f.odometerKm}:${f.fullTank}`)),
    );

    // ---- Return can't read less than the pump ----
    const stops = await driver.get(`/logistics/trips/${trip.id}/stops`);
    for (const s of stops.filter((x) => x.status === 'pending')) {
      await driver.post(`/logistics/trips/${trip.id}/stops/${s.id}/skip`, { reason: 'Shop closed' });
    }
    const short = await driver.raw('POST', `/logistics/trips/${trip.id}/closing-km`, { closingKm: opening + 250 });
    check('Return can’t read less than the odometer at the pump', short.status === 400 && new RegExp(`at the pump on this trip, ${opening + 300} km`).test(message(short)), message(short));
    trip = await driver.post(`/logistics/trips/${trip.id}/closing-km`, { closingKm: opening + 320 });
    const pastReturn = await driver.raw('POST', base, { category: 'fuel', amount: 925, litres: 10, ratePerLitre: 92.5, odometerKm: opening + 400 }, key(12));
    check('…nor a fill on the trip read more than Return', pastReturn.status === 400 && /Return read/.test(message(pastReturn)), message(pastReturn));

    // ---- My Expenses ----
    const mine = await driver.get('/logistics/trips/mine/expenses');
    const onTrip = mine.items.filter((e) => e.tripId === trip.id);
    const statusOf = (cat, amount) => onTrip.find((e) => e.category === cat && e.amount === amount)?.status;
    check(
      'My Expenses: each with its trip and where it stands — the owner’s decisions, and what needed none',
      statusOf('other', '80.00') === 'approved' && statusOf('toll', '60.00') === 'rejected' && statusOf('parking', '40.00') === 'pending' && statusOf('parking', '50.00') === 'recorded' && onTrip.every((e) => e.tripNumber === trip.number),
      JSON.stringify(onTrip.map((e) => `${e.category}:${e.amount}:${e.status}`)),
    );
    const sum = (xs) => xs.reduce((s, e) => s + Math.round(Number(e.amount) * 100), 0) / 100;
    check(
      '…totals in all, on fuel and the rest',
      Number(mine.totals.all) === sum(mine.items) && Number(mine.totals.fuel) === sum(mine.items.filter((e) => e.category === 'fuel')) && Number(mine.totals.fuel) + Number(mine.totals.other) === Number(mine.totals.all),
      JSON.stringify(mine.totals),
    );
    check(
      '…and the vehicle’s mileage, full tank to full tank: the part fill counts with the full one after it',
      mine.mileage?.vehicleId === van && JSON.stringify(mine.mileage.last) === JSON.stringify({ fromKm: opening, toKm: opening + 300, km: 300, litres: '40.000', kmPerLitre: '7.50' }),
      JSON.stringify(mine.mileage),
    );
    const backwards = await driver.raw('GET', `/logistics/trips/mine/expenses?from=${today}&to=${addDays(today, -1)}`);
    const tooLong = await driver.raw('GET', `/logistics/trips/mine/expenses?from=${addDays(today, -200)}&to=${today}`);
    check('dates the right way round, half a year at most', backwards.status === 400 && tooLong.status === 400, `${backwards.status} ${tooLong.status}`);

    // ---- Hand over; Approvals ----
    trip = await driver.get(`/logistics/trips/${trip.id}`);
    const handover = await driver.get(`/logistics/trips/${trip.id}/handover`);
    const declared = Math.max(0, Number(handover.expected));
    trip = await driver.post(`/logistics/trips/${trip.id}/complete`, { version: trip.version, cashDeclared: declared, note: 'Paid the road costs from my own cash' });
    const approvals = await driver.get('/logistics/trips/mine/approvals');
    const find = (kind, pred) => approvals.items.find((i) => i.kind === kind && pred(i));
    const teaItem = find('expense', (i) => i.id === tea.id);
    const waitingItem = find('expense', (i) => i.id === waiting.id);
    const tollItem = find('expense', (i) => i.id === toll.id);
    const handed = find('handover', (i) => i.tripId === trip.id);
    const closedBefore = find('handover', (i) => i.status === 'approved');
    const dispute = find('collection', (i) => i.customerName === 'Hotel Sagar');
    check('Approvals: an expense the owner approved', teaItem?.status === 'approved' && !!teaItem.decidedAt && teaItem.detail === 'Tea for the loaders', JSON.stringify(teaItem));
    check('…one still waiting for the owner', waitingItem?.status === 'pending' && waitingItem.category === 'parking', JSON.stringify(waitingItem));
    check('…one rejected, with the owner’s reason', tollItem?.status === 'rejected' && tollItem.note === 'No toll on this route', JSON.stringify(tollItem));
    check('…the trip just handed over, waiting for the owner', handed?.status === 'pending' && Number(handed.amount) === declared && handed.detail === 'Paid the road costs from my own cash', JSON.stringify(handed));
    check('…a trip the owner closed', !!closedBefore && !!closedBefore.decidedAt, JSON.stringify(closedBefore));
    check('…and the customer’s dispute the driver raised, with its trip', !!dispute && dispute.amount === '200.00' && !!dispute.tripNumber, JSON.stringify(dispute));
    check(
      '…the counts add up, and what needed no approval isn’t there',
      approvals.counts.pending + approvals.counts.approved + approvals.counts.rejected === approvals.items.length && !approvals.items.some((i) => i.id === parking.id),
      JSON.stringify(approvals.counts),
    );

    // ---- Trip History; one trip in full ----
    const history = await driver.get('/logistics/trips/mine/history');
    const card = history.trips.find((t) => t.id === trip.id);
    check(
      'Trip History: the trip with what it did — KM, fuel, time on the road, its stops',
      card?.km === '320.0' && card.fuelLitres === '40.000' && card.delivery.total >= 1 && card.status === 'completed' && card.minutes !== null && Array.isArray(card.places),
      JSON.stringify(card),
    );
    check('…newest first, only this driver’s', history.trips.length >= 3 && history.trips.every((t, i, xs) => i === 0 || (xs[i - 1].day ?? '') >= (t.day ?? '')), String(history.trips.length));
    const summary = await driver.get(`/logistics/trips/${trip.id}/summary`);
    check(
      'Trip Details: stops, expenses, the vehicle, totals — mileage from the trip’s own km and fills',
      summary.trip.id === trip.id && summary.stops.length === stops.length && summary.expenses.length === onTrip.length && summary.totals.tolls === '150.00' && summary.totals.kmPerLitre === '8.00' && summary.vehicle.registrationNumber === 'KA01D10001' && summary.closed === null,
      JSON.stringify({ t: summary.totals, v: summary.vehicle, c: summary.closed }),
    );
    const closedTrip = history.trips.find((t) => t.status === 'reconciled');
    const closedSummary = closedTrip ? await driver.get(`/logistics/trips/${closedTrip.id}/summary`) : null;
    check('…a closed trip says when, and who closed it', !!closedSummary?.closed?.at && !!closedSummary.closed.by, JSON.stringify(closedSummary?.closed));
    const asOwner = await owner.raw('GET', `/logistics/trips/${trip.id}/summary`);
    check('the owner can open it too', asOwner.status === 200, String(asOwner.status));

    // ---- The vehicle ----
    await owner.post('/fleet/maintenance', { vehicleId: van, serviceDate: today, kind: 'service', description: 'Engine oil change', odometerKm: opening + 320, amount: 0, nextDueKm: opening + 320 + 1188 });
    await owner.post('/fleet/documents', { vehicleId: van, docType: 'insurance', docNumber: 'POL-D6', validFrom: today, validUntil: addDays(today, 180) });
    const { vehicle } = await driver.get('/logistics/trips/mine/vehicle');
    const service = vehicle?.maintenance.find((m) => m.kind === 'service');
    const insurance = vehicle?.documents.find((d) => d.docType === 'insurance');
    check(
      'Vehicle: the current KM and mileage',
      vehicle?.id === van && Number(vehicle.currentKm) === opening + 320 && vehicle.lastFullTank?.kmPerLitre === '7.50' && vehicle.averageKmPerLitre !== null,
      JSON.stringify({ km: vehicle?.currentKm, last: vehicle?.lastFullTank, avg: vehicle?.averageKmPerLitre }),
    );
    check('…what’s due: 1,188 km to the next service — due soon', service?.kmLeft === 1188 && service.state === 'due_soon' && service.description === 'Engine oil change', JSON.stringify(service));
    check('…its documents, with the days left', insurance?.daysLeft === 180 && insurance.state === 'valid', JSON.stringify(insurance));
    check('…and nothing of its books, loans or hire', vehicle && !('netBookValue' in vehicle) && !('loanOutstanding' in vehicle) && !('hireContract' in vehicle), Object.keys(vehicle ?? {}).join(','));

    // ---- Profile ----
    const profile = await driver.get('/logistics/trips/mine/profile');
    check(
      'Profile: who the driver is, the vehicle, and who to call at the business',
      profile.name === 'Raju Driver' && profile.vehicle === 'KA01D10001' && profile.businessName.length > 0 && profile.contacts.length >= 1 && profile.contacts.every((c) => /^\+91\d{10}$/.test(c.phone)),
      JSON.stringify(profile),
    );

    // ---- The owner app ----
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
      await page.goto(`${BASE}/login`);
      await page.fill('#login', 'owner@dev.morbeez.local');
      await page.fill('#password', PASSWORD);
      await page.click('button[type=submit]');
      await page.waitForURL((u) => !/\/login/.test(u.toString()));
      await page.goto(`${BASE}/logistics?open=${trip.id}`);
      await page.waitForFunction((n) => document.querySelector('.detail')?.textContent.includes(n), trip.number);
      await page.locator('.trip-tabs button', { hasText: 'Expenses' }).click();
      await page.waitForFunction(() => document.querySelector('.detail')?.textContent.includes('Parking'));
      const shown = (await page.locator('.detail').textContent()).replace(/\s+/g, ' ');
      check(
        "the trip's Expenses: the categories, a fill's pump details and its bill, the owner's decisions",
        /Parking/.test(shown) && /Loading/.test(shown) && /Repair/.test(shown) && /30 L at ₹92\.50 a litre · Full tank/.test(shown) && /10 L at ₹92\.50 a litre · Part fill/.test(shown) && /Bill photo/.test(shown) && /Rejected: No toll on this route/.test(shown),
        shown.slice(0, 700),
      );
      const out = process.env.E2E_SCREENSHOTS;
      if (out) await page.locator('.detail').screenshot({ path: path.join(out, 'owner-trip-expenses-d6.png') });
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
