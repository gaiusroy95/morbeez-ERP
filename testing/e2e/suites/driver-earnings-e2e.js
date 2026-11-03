// Driver app V1, Phase D7 — the incentive engine V1.18 and the driver's
// earnings (docs/redesign/driver-app-v1-plan.md; client spec §24–§25; the
// client's answers 7 and 8). The owner switches the ten incentives on, each
// a percentage of its base, with a km/l target; nothing is paid before.
// The dev driver (on a daily wage) runs a trip: a farm, a regular shop and a
// new customer, cash collected, a backhaul paid, a full tank with its bill.
// Before the close the trip's incentives are an estimate; when the owner
// closes it they're worked out from the trip's data and kept — each with its
// base, percentage and why. My Earnings shows fixed pay and each incentive;
// the week's settlement pays them; once paid, the driver says they got it.
// The owner app shows the rules and the trip's incentives. Runs last in the
// redesign chain.
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
  const upload = async (path, photoType) => {
    const form = new FormData();
    form.append('photoType', photoType);
    const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
    form.append('file', new Blob([jpeg], { type: 'image/jpeg' }), 'photo.jpg');
    const r = await fetch(`${API}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
    if (r.status >= 300) throw new Error(`upload ${path} -> ${r.status}`);
    return r.json();
  };
  return { raw: call, get: (p) => ok('GET', p), post: (p, b = {}, h) => ok('POST', p, b, h), put: (p, b) => ok('PUT', p, b), upload };
}
const message = (r) => r.body?.error?.message ?? '';
const key = () => ({ 'idempotency-key': randomUUID() });
const pct = (amount, percent) => (Math.round(Number(amount) * Number(percent)) / 100).toFixed(2);

(async () => {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  try {
    const owner = client(await login('owner@dev.morbeez.local'));
    const accountant = client(await login('accountant@dev.morbeez.local'));
    const driver = client(await login('driver@dev.morbeez.local'));
    const customers = (await owner.get('/customers?pageSize=100')).items;
    const sagar = customers.find((c) => c.name === 'Hotel Sagar');
    const ramesh = (await owner.get('/farmers?pageSize=100')).items.find((f) => f.name === 'Ramesh Patil');
    const tomato = (await owner.get('/products?pageSize=100')).items.find((p) => p.name === 'Tomato');
    const van = (await owner.get('/vehicles?pageSize=100')).items.find((v) => v.registrationNumber === 'KA01D10001');
    const raju = (await owner.get('/workforce?pageSize=100')).items.find((w) => w.name === 'Raju Driver');
    if (!van || !raju) throw new Error('run the driver-app suites first (the dev driver and the van)');
    const rajuId = raju.employeeId ?? raju.id;
    let day = await driver.get('/logistics/trips/mine/day');
    const today = day.today;
    const monday = day.weekFrom;

    // ---- The owner's rules ----
    const before = await owner.get('/workforce/payroll/driver-incentives');
    check('every incentive off until the owner switches it on — each with what it is a percentage of', before.version === 0 && before.rules.length === 10 && before.rules.every((r) => !r.enabled) && /collected/.test(before.rules[0].base), JSON.stringify(before.rules.map((r) => `${r.kind}:${r.enabled}`)));
    const c0 = before.conditions;
    check(
      'the eligibility conditions start where the client confirmed the bases',
      c0?.minCollected === '0.00' && c0.minCrates === 1 && c0.qualityShortAllowed === 0 && c0.performanceSkipsAllowed === 0 && c0.dataQualityNeeds.km && c0.dataQualityNeeds.deliveryPhotos && c0.dataQualityNeeds.bills && c0.completionOnException === false,
      JSON.stringify(c0),
    );
    const rules = before.rules.map((r) => ({ kind: r.kind, enabled: true, percent: Number(r.suggestedPercent) }));
    // The owner's own conditions: a collection incentive only from ₹1,000 collected.
    const conditions = { minCollected: 1000, minCrates: 1, qualityShortAllowed: 0, performanceSkipsAllowed: 0, dataQualityNeeds: { km: true, deliveryPhotos: true, bills: true }, completionOnException: false };
    const noCrates = await owner.raw('PUT', '/workforce/payroll/driver-incentives', { version: 0, rules, targetKmPerLitre: 8.5, nightFrom: '21:00', nightUntil: '05:00', conditions: { ...conditions, minCrates: 0 } });
    check('a condition out of range is refused', noCrates.status === 400, `${noCrates.status} ${message(noCrates)}`);
    const noTarget = await owner.raw('PUT', '/workforce/payroll/driver-incentives', { version: 0, rules, nightFrom: '21:00', nightUntil: '05:00' });
    check('the mileage incentive needs a km/l target', noTarget.status === 400 && /km\/l target/.test(message(noTarget)), message(noTarget));
    const byDriver = await driver.raw('PUT', '/workforce/payroll/driver-incentives', { version: 0, rules, targetKmPerLitre: 8.5, nightFrom: '21:00', nightUntil: '05:00' });
    check('a driver sets none of it', byDriver.status === 403, String(byDriver.status));
    const saved = await owner.put('/workforce/payroll/driver-incentives', { version: 0, rules, targetKmPerLitre: 8.5, nightFrom: '21:00', nightUntil: '05:00', conditions });
    const stale = await owner.raw('PUT', '/workforce/payroll/driver-incentives', { version: 0, rules, targetKmPerLitre: 8.5, nightFrom: '21:00', nightUntil: '05:00' });
    check('the owner switches all ten on, with a ₹1,000 collection minimum — saved once, a stale save refused', saved.version === 1 && saved.rules.every((r) => r.enabled) && saved.targetKmPerLitre === '8.50' && saved.conditions?.minCollected === '1000.00' && stale.status === 409, `${saved.version} ${JSON.stringify(saved.conditions)} ${stale.status}`);
    const percent = Object.fromEntries(saved.rules.map((r) => [r.kind, r.percent]));

    // ---- The driver's daily wage ----
    const worker = await owner.get(`/workforce/workers/${rajuId}`);
    if (!(worker.currentRate?.payBasis === 'daily' && worker.currentRate.rate === '1200.00')) {
      await owner.post(`/workforce/workers/${rajuId}/pay-rates`, { payBasis: 'daily', rate: 1200, effectiveFrom: monday });
    }

    // ---- A trip: a farm, a regular shop, a new customer ----
    const newcomer = await owner.post('/customers', { name: 'D7 Corner Mess', contact: { phone: '+919800000051' }, place: 'Hunsur', creditLimit: 100000, paymentTermsDays: 0 });
    let po = await owner.post('/procurement/purchase-orders', { farmerId: ramesh.id, lines: [{ productId: tomato.id, expectedQuantity: 30, indicativePrice: 20 }] });
    po = await owner.post(`/procurement/purchase-orders/${po.id}/confirm`, { version: po.version });
    const pickup = await owner.post(`/procurement/purchase-orders/${po.id}/pickups`, {});
    const regular = await owner.post('/orders', { customerId: sagar.id, deliveryDate: today, creditTermDays: 0, confirm: true, lines: [{ productId: tomato.id, quantity: 20, unitPrice: 30 }] });
    const first = await owner.post('/orders', { customerId: newcomer.id, deliveryDate: today, creditTermDays: 0, confirm: true, lines: [{ productId: tomato.id, quantity: 5, unitPrice: 30 }] });
    let trip = await owner.post('/logistics/trips', { vehicleId: van.id, driverEmployeeId: rajuId, plannedDate: today, pickupIds: [pickup.id], orderIds: [regular.id, first.id] });
    const opening = Math.ceil(Number(day.lastOdometerKm ?? 0)) + 10;
    // The owner filled the tank before the trip; the driver fills it again on the road.
    await owner.post('/fleet/fuel', { vehicleId: van.id, filledOn: today, litres: 40, amount: 3700, odometerKm: opening, paidFrom: 'cash_on_hand' });
    trip = await driver.post(`/logistics/trips/${trip.id}/start`, { version: trip.version, openingKm: opening });
    const base = `/logistics/trips/${trip.id}`;
    const stops = await driver.get(`${base}/stops`);
    const farm = stops.find((s) => s.stopType === 'pickup');
    const shops = stops.filter((s) => s.stopType === 'delivery');
    const backhaul = await owner.post(`${base}/backhauls`, { pickupPlace: 'Hunsur', dropPlace: 'Gundlupet Base', rent: 3000 });
    await driver.post(`${base}/backhauls/${backhaul.id}/accept`);

    await driver.post(`${base}/stops/${farm.id}/complete-pickup`, { lines: [{ productId: tomato.id, outcome: 'accepted', netQuantity: 30 }] });
    await driver.post(`${base}/start-deliveries`);
    for (const shop of shops) {
      await driver.upload(`${base}/stops/${shop.id}/photos`, 'pod');
      await driver.post(`${base}/stops/${shop.id}/complete-delivery`, { recipientName: 'Manager', allUnloaded: true, qrToken: shop.party.qrToken });
    }
    const sagarStop = shops.find((s) => s.party.id === sagar.id);
    const newStop = shops.find((s) => s.party.id === newcomer.id);
    await driver.post(`${base}/stops/${sagarStop.id}/collections`, { amount: 600, method: 'cash' }, key());
    await driver.post(`${base}/stops/${newStop.id}/collections`, { amount: 150, method: 'cash' }, key());
    const fillId = randomUUID();
    await driver.post(`${base}/expenses`, { id: fillId, category: 'fuel', amount: 2775, litres: 30, ratePerLitre: 92.5, odometerKm: opening + 300, fuelType: 'diesel', fullTank: true }, key());
    await driver.upload(`${base}/expenses/${fillId}/photos`, 'bill');
    for (const step of ['pickup_reached', 'loaded', 'drop_reached', 'completed']) {
      if (step === 'loaded') await driver.upload(`${base}/backhauls/${backhaul.id}/photos`, 'load');
      if (step === 'completed') await driver.upload(`${base}/backhauls/${backhaul.id}/photos`, 'drop');
      await driver.post(`${base}/backhauls/${backhaul.id}/steps`, { step });
    }
    await driver.post(`${base}/backhauls/${backhaul.id}/payment`, { method: 'cash', amount: 3000 });
    trip = await driver.post(`${base}/closing-km`, { closingKm: opening + 320 });

    // ---- Before the close: an estimate ----
    const estimate = await driver.get(`${base}/incentives`);
    const est = Object.fromEntries(estimate.lines.map((l) => [l.kind, l]));
    check(
      'before the close the trip’s incentives are an estimate — the backhaul’s worked out already; ₹750 collected is under the owner’s ₹1,000',
      estimate.final === false && est.backhaul?.amount === pct(3000, percent.backhaul) && est.collection?.amount === '0.00' && est.collection.detail === '₹750.00 collected — less than ₹1000.00' && est.completion?.detail === 'If the owner closes the trip as a pass',
      JSON.stringify(estimate.lines.map((l) => `${l.kind}:${l.amount}`)),
    );

    // ---- Handover; the owner closes it ----
    trip = await driver.get(base);
    const handover = await driver.get(`${base}/handover`);
    trip = await driver.post(`${base}/complete`, { version: trip.version, cashDeclared: Number(handover.expected) });
    const closed = await owner.post(`${base}/reconcile`, { version: trip.version, cashReturned: Number(handover.expected), exceptionNote: 'Checked on the phone' });
    const kept = await driver.get(`${base}/incentives`);
    const k = Object.fromEntries(kept.lines.map((l) => [l.kind, l]));
    const passed = closed.outcome === 'pass';
    check(
      'closed: worked out from the trip and kept — each with its base and why (the collection minimum not met, nothing for it)',
      kept.final === true &&
        k.collection.base === '0.00' && k.collection.amount === '0.00' && k.collection.detail === '₹750.00 collected — less than ₹1000.00' &&
        k.backhaul.base === '3000.00' && k.backhaul.amount === pct(3000, percent.backhaul) &&
        k.new_customer.base === '150.00' && k.new_customer.detail === '1 new customer(s), first delivery ₹150.00' &&
        k.quality.base === '750.00' && k.performance.base === '750.00',
      JSON.stringify(kept.lines.map((l) => `${l.kind}:${l.base}×${l.percent}%=${l.amount}`)),
    );
    check(
      'mileage: the fuel saved against 8.5 km/l, full tank to full tank — 300 km on 30 L, 5.294 L saved at ₹92.50',
      k.mileage.base === '489.70' && k.mileage.amount === pct(489.7, percent.mileage),
      `${k.mileage.base} ${k.mileage.detail}`,
    );
    check(
      "on the day's ₹1,200: records complete, and the close — a pass pays it, an exception doesn't",
      k.data_quality.base === '1200.00' && k.data_quality.amount === pct(1200, percent.data_quality) && k.completion.amount === (passed ? pct(1200, percent.completion) : '0.00'),
      `${closed.outcome} dq=${k.data_quality.amount} (${k.data_quality.detail}) c=${k.completion.amount}`,
    );
    check('no crates brought back, nothing for them', k.crates.amount === '0.00' && k.crates.detail === 'No crates brought back', k.crates.detail);
    const total = kept.lines.reduce((s, l) => s + Number(l.amount), 0).toFixed(2);
    check('…and the total adds up', kept.total === total, `${kept.total} ${total}`);
    const rows = (await db.query('SELECT count(*)::int AS n FROM workforce.trip_incentive WHERE trip_id = $1', [trip.id])).rows[0].n;
    check('kept once, one row an incentive', rows === 10, String(rows));

    // ---- My Earnings ----
    const earnings = await driver.get('/logistics/trips/mine/earnings?period=week');
    const line = (kind) => earnings.lines.find((l) => l.kind === kind);
    check(
      "My Earnings: the week's fixed pay and each incentive — calculated, never entered",
      Number(earnings.fixedPay) >= 1200 && earnings.lines.length === 10 && Number(line('backhaul').amount) >= Number(k.backhaul.amount) && earnings.total === (Number(earnings.fixedPay) + Number(earnings.incentives)).toFixed(2) && earnings.rules.length === 10,
      JSON.stringify({ fixed: earnings.fixedPay, inc: earnings.incentives, est: earnings.estimated, total: earnings.total }),
    );
    const badPeriod = await driver.raw('GET', '/logistics/trips/mine/earnings?period=year');
    check('today, this week or this month', badPeriod.status === 400, String(badPeriod.status));
    const ownerCannot = await driver.raw('GET', '/workforce/payroll/driver-incentives');
    check("the driver doesn't read the owner's rules — only what they earned", ownerCannot.status === 403, String(ownerCannot.status));

    // ---- The week's pay ----
    const preview = (await owner.get(`/workforce/earnings?from=${monday}&to=${today}`)).find((p) => p.employeeId === rajuId);
    const paid = (preview?.lines ?? []).filter((l) => l.kind === 'incentive' && l.description.includes(trip.number));
    check(
      "the week's pay carries the trip's incentives, each by name and trip",
      paid.some((l) => l.description === `Backhaul incentive — trip ${trip.number}` && l.amount === k.backhaul.amount) && paid.length === kept.lines.filter((l) => Number(l.amount) > 0).length,
      JSON.stringify(paid.map((l) => `${l.description}:${l.amount}`)),
    );
    const [draft] = await owner.post('/workforce/settlements', { from: monday, to: today, employeeIds: [rajuId] });
    const linked = (await db.query('SELECT count(*)::int AS n FROM workforce.trip_incentive WHERE trip_id = $1 AND settlement_id = $2', [trip.id, draft.id])).rows[0].n;
    check('drafted, the settlement takes them — they can’t be paid twice', linked === 10, String(linked));
    const notYet = await driver.raw('POST', `/logistics/trips/mine/settlements/${draft.id}/received`);
    const approved = await accountant.post(`/workforce/settlements/${draft.id}/approve`, { version: draft.version });
    const mineApproved = (await driver.get('/logistics/trips/mine/settlements')).find((s) => s.id === draft.id);
    check('the driver sees it once approved, with its lines — and can’t say "received" before it’s paid', mineApproved?.status === 'approved' && mineApproved.lines.some((l) => l.description.startsWith('Backhaul incentive')) && notYet.status === 409, `${mineApproved?.status} ${notYet.status}`);
    await accountant.post(`/workforce/settlements/${draft.id}/pay`, { version: approved.version, paidFrom: 'bank', reference: 'NEFT D7' });
    const received = await driver.post(`/logistics/trips/mine/settlements/${draft.id}/received`);
    const again = await driver.post(`/logistics/trips/mine/settlements/${draft.id}/received`);
    check('paid — the driver says they got it; saying it again changes nothing', received.status === 'paid' && !!received.receivedAt && again.receivedAt === received.receivedAt, `${received.status} ${received.receivedAt}`);
    const ownerView = await owner.get(`/workforce/settlements/${draft.id}`);
    check('the owner sees it was received', !!ownerView.receivedAt, String(ownerView.receivedAt));

    // ---- The owner app ----
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
      await page.goto(`${BASE}/login`);
      await page.fill('#login', 'owner@dev.morbeez.local');
      await page.fill('#password', PASSWORD);
      await page.click('button[type=submit]');
      await page.waitForURL((u) => !/\/login/.test(u.toString()));
      await page.goto(`${BASE}/settings`);
      await page.getByRole('button', { name: /Rates & rules/ }).click();
      await page.waitForSelector('.incentive-table');
      const ruleRows = await page.locator('.incentive-table tbody tr').count();
      const ticked = await page.locator('.incentive-table input[type=checkbox]:checked').count();
      check('Settings → Rates & rules: the ten incentives, each on with its percentage', ruleRows === 10 && ticked === 10, `${ruleRows} ${ticked}`);
      const minimum = await page.getByLabel('Collection: at least (₹) collected on the trip').inputValue();
      check('…and the eligibility conditions, as the owner saved them', (await page.getByRole('heading', { name: 'Eligibility conditions' }).count()) === 1 && minimum === '1000', minimum);
      const out = process.env.E2E_SCREENSHOTS;
      if (out) await page.screenshot({ path: path.join(out, 'd7-owner-incentive-rules.png'), fullPage: true });
      await page.goto(`${BASE}/logistics?open=${trip.id}`);
      await page.waitForFunction(() => document.querySelector('.detail')?.textContent.includes("Driver's incentives"));
      const shown = (await page.locator('.detail').textContent()).replace(/\s+/g, ' ');
      check("the trip shows its driver's incentives", /Backhaul incentive/.test(shown) && /Mileage incentive/.test(shown) && /₹3000\.00 backhaul rent received/.test(shown), shown.slice(0, 400));
      if (out) await page.locator('.detail').screenshot({ path: path.join(out, 'd7-owner-trip-incentives.png') });
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
