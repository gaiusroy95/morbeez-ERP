// Driver app V1, Phase D3 — delivery (docs/redesign/driver-app-v1-plan.md;
// client spec §11–§14, the client's answers 3 and 5): the shop's QR (a
// new one makes the old printout stop matching), Start Trip after the
// farms, and a delivery's checklist — the customer's own QR or why there
// wasn't one, everything unloaded, a line delivered short only with its
// reason (the invoice follows what was delivered), crates left and taken
// back; crates that don't add up never block a delivery. The owner sees it
// all on the trip's Stops tab, and prints the QR from the customer's
// profile. Runs in the redesign chain, on the seeded business.
const { API, BASE, DB_URL, PASSWORD, launchBrowser } = require('../lib/env');
const { Client } = require('pg');

const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`);

async function login(login) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password: PASSWORD }) });
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
  const upload = async (path, fields) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
    form.append('file', new Blob([jpeg], { type: 'image/jpeg' }), 'photo.jpg');
    const r = await fetch(`${API}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { raw: call, get: (p) => ok('GET', p), post: (p, b = {}) => ok('POST', p, b), upload };
}

(async () => {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  try {
    const owner = client(await login('owner@dev.morbeez.local'));
    const driverApp = client(await login('driver@dev.morbeez.local'));
    const products = (await owner.get('/products?pageSize=100')).items;
    const customers = (await owner.get('/customers?pageSize=100')).items;
    const farmers = (await owner.get('/farmers?pageSize=100')).items;
    const tomato = products.find((p) => p.name === 'Tomato');
    const onion = products.find((p) => p.name === 'Onion');
    const ramesh = farmers.find((f) => f.name === 'Ramesh Patil');
    let sagar = customers.find((c) => c.name === 'Hotel Sagar');
    const leaf = await owner.post('/customers', { name: 'Green Leaf Mess', paymentTermsDays: 7, creditLimit: 50000 });

    // ---- The shop's QR ----
    check('every customer has a delivery QR token', /^[0-9A-F]{16}$/.test(sagar.qrToken ?? '') && /^[0-9A-F]{16}$/.test(leaf.qrToken ?? '') && sagar.qrToken !== leaf.qrToken, `${sagar.qrToken} ${leaf.qrToken}`);
    const oldToken = sagar.qrToken;
    sagar = await owner.post(`/customers/${sagar.id}/qr`);
    check('a new QR replaces the old one', /^[0-9A-F]{16}$/.test(sagar.qrToken) && sagar.qrToken !== oldToken, `${oldToken} → ${sagar.qrToken}`);
    const notOwner = await driverApp.raw('POST', `/customers/${sagar.id}/qr`);
    check("a driver can't make a new QR", notOwner.status === 403, String(notOwner.status));

    // ---- Crates on the vehicle ----
    const crate = await owner.post('/crates/types', { code: 'DL20', name: 'Delivery crate', replacementCost: 150 });
    const crateType = (Array.isArray(crate) ? crate : [crate]).find((c) => c.code === 'DL20');
    const day = await driverApp.get('/logistics/trips/mine/day');
    check("the driver's day lists the crate types", (day.crateTypes ?? []).some((c) => c.code === 'DL20' && c.id === crateType.id), JSON.stringify(day.crateTypes));
    const mohan = await owner.post('/workforce', { name: 'Mohan Driver', roleType: 'driver' });
    await db.query('UPDATE trading_partners.employee SET delegation_level = 4, standing_delegation = true WHERE id = $1', [mohan.id]);
    const van = await owner.post('/vehicles', { registrationNumber: 'KA01D40004', capacityKg: 2000, fuelType: 'diesel' });
    await owner.post('/crates/movements', { kind: 'purchased', lines: [{ crateTypeId: crateType.id, quantity: 50 }], cost: 7500, paidFrom: 'cash_on_hand' });
    await owner.post('/crates/movements', { kind: 'loaded', vehicleId: van.id, lines: [{ crateTypeId: crateType.id, quantity: 20 }] });

    // ---- A trip: a farm, then two shops ----
    let po = await owner.post('/procurement/purchase-orders', { farmerId: ramesh.id, lines: [{ productId: tomato.id, expectedQuantity: 200, indicativePrice: 18 }, { productId: onion.id, expectedQuantity: 100, indicativePrice: 12 }] });
    po = await owner.post(`/procurement/purchase-orders/${po.id}/confirm`, { version: po.version });
    const pickup = await owner.post(`/procurement/purchase-orders/${po.id}/pickups`, {});
    const orderA = await owner.post('/orders', { customerId: sagar.id, confirm: true, creditTermDays: 0, lines: [{ productId: tomato.id, quantity: 100, unitPrice: 30 }, { productId: onion.id, quantity: 50, unitPrice: 20 }] });
    const orderB = await owner.post('/orders', { customerId: leaf.id, confirm: true, lines: [{ productId: tomato.id, quantity: 80, unitPrice: 31 }] });
    let trip = await owner.post('/logistics/trips', { vehicleId: van.id, driverEmployeeId: mohan.id, pickupIds: [pickup.id], orderIds: [orderA.id, orderB.id] });
    const early = await owner.raw('POST', `/logistics/trips/${trip.id}/start-deliveries`);
    check("deliveries can't set off before the trip is on the road", early.status === 409, String(early.status));
    trip = await owner.post(`/logistics/trips/${trip.id}/start`, { version: trip.version });
    let stops = await owner.get(`/logistics/trips/${trip.id}/stops`);
    const farm = stops.find((s) => s.stopType === 'pickup');
    const shopA = stops.find((s) => s.orderId === orderA.id);
    const shopB = stops.find((s) => s.orderId === orderB.id);
    check("each delivery stop carries its shop's QR token, the farm none", shopA.party?.qrToken === sagar.qrToken && shopB.party?.qrToken === leaf.qrToken && !farm.party?.qrToken, JSON.stringify({ a: shopA.party?.qrToken, f: farm.party?.qrToken }));
    await owner.post(`/logistics/trips/${trip.id}/stops/${farm.id}/complete-pickup`, {
      lines: [{ productId: tomato.id, outcome: 'accepted', netQuantity: 200 }, { productId: onion.id, outcome: 'accepted', netQuantity: 100 }],
    });

    // ---- Start Trip ----
    const off = await owner.post(`/logistics/trips/${trip.id}/start-deliveries`);
    const again = await owner.post(`/logistics/trips/${trip.id}/start-deliveries`);
    check('Start Trip records when the delivery run set off — the first time only', !!off.deliveryStartedAt && again.deliveryStartedAt === off.deliveryStartedAt, `${off.deliveryStartedAt} ${again.deliveryStartedAt}`);

    // ---- Shop A: the checklist ----
    await owner.upload(`/logistics/trips/${trip.id}/stops/${shopA.id}/photos`, { photoType: 'pod' });
    const base = { recipientName: 'Manager', allUnloaded: true };
    const wrongQr = await owner.raw('POST', `/logistics/trips/${trip.id}/stops/${shopA.id}/complete-delivery`, { ...base, qrToken: `MORBEEZ:C:${oldToken}` });
    check("the shop's old QR is refused — another QR blocks the delivery", wrongQr.status === 400 && /isn't Hotel Sagar's/.test(wrongQr.body?.error?.message ?? ''), wrongQr.body?.error?.message);
    const otherShop = await owner.raw('POST', `/logistics/trips/${trip.id}/stops/${shopA.id}/complete-delivery`, { ...base, qrToken: `MORBEEZ:C:${leaf.qrToken}` });
    check("…and so is another shop's", otherShop.status === 400, String(otherShop.status));
    const notUnloaded = await owner.raw('POST', `/logistics/trips/${trip.id}/stops/${shopA.id}/complete-delivery`, { ...base, allUnloaded: false, qrToken: sagar.qrToken });
    check('a delivery not unloaded is refused', notUnloaded.status === 400 && /Unload everything/.test(notUnloaded.body?.error?.message ?? ''), notUnloaded.body?.error?.message);
    const lineOf = (order, product) => order.lines.find((l) => l.productId === product.id).id;
    const noReason = await owner.raw('POST', `/logistics/trips/${trip.id}/stops/${shopA.id}/complete-delivery`, {
      ...base,
      qrToken: sagar.qrToken,
      lines: [{ orderLineId: lineOf(orderA, onion), deliveredQuantity: 40 }],
    });
    check('a line delivered short needs its reason', noReason.status === 400 && /Say why less Onion was delivered/.test(noReason.body?.error?.message ?? ''), noReason.body?.error?.message);
    check('…and a refused delivery delivers nothing', (await owner.get(`/orders/${orderA.id}`)).status === 'confirmed');

    await owner.post(`/logistics/trips/${trip.id}/stops/${shopA.id}/complete-delivery`, {
      ...base,
      qrToken: `morbeez:c:${sagar.qrToken.toLowerCase()}`,
      lines: [{ orderLineId: lineOf(orderA, onion), deliveredQuantity: 40, shortReason: 'customer_took_less', shortNote: 'slow day' }],
      crates: [{ crateTypeId: crateType.id, dropped: 10, collected: 0 }],
    });
    stops = await owner.get(`/logistics/trips/${trip.id}/stops`);
    const a = stops.find((s) => s.id === shopA.id).delivery;
    check('the delivery keeps its checklist: QR scanned, everything unloaded, who received it', a?.qrStatus === 'scanned' && a.allUnloaded === true && a.recipientName === 'Manager', JSON.stringify(a));
    check('…what was delivered short, and why', a?.shortfalls.length === 1 && a.shortfalls[0].productName === 'Onion' && a.shortfalls[0].ordered === '50.000' && a.shortfalls[0].delivered === '40.000' && a.shortfalls[0].reason === 'customer_took_less' && a.shortfalls[0].note === 'slow day', JSON.stringify(a?.shortfalls));
    check('…and the crates left with the shop', a?.crates.dropped === 10 && a.crates.collected === 0, JSON.stringify(a?.crates));
    const deliveredA = await owner.get(`/orders/${orderA.id}`);
    check('the order is delivered as it was: 100 tomato, 40 onion', deliveredA.status === 'delivered' && deliveredA.lines.find((l) => l.productId === onion.id).deliveredQuantity === '40.000' && deliveredA.lines.find((l) => l.productId === tomato.id).deliveredQuantity === '100.000', JSON.stringify(deliveredA.lines.map((l) => l.deliveredQuantity)));
    const invoice = (await db.query("SELECT amount::text AS amount FROM money.invoice WHERE order_id = $1 AND kind = 'sale'", [orderA.id])).rows[0];
    check('…and so is the invoice: 100 × 30 + 40 × 20', invoice && Number(invoice.amount) === 3800, JSON.stringify(invoice));
    const vanCrates = (await db.query(
      `SELECT COALESCE(SUM(CASE WHEN to_kind = 'vehicle' AND to_id = $1 THEN quantity ELSE 0 END) - SUM(CASE WHEN from_kind = 'vehicle' AND from_id = $1 THEN quantity ELSE 0 END), 0)::int AS n
       FROM crates.movement WHERE crate_type_id = $2`,
      [van.id, crateType.id],
    )).rows[0].n;
    check('the vehicle holds the 10 crates left', vanCrates === 10, String(vanCrates));
    let alerts = await owner.get('/alerts?limit=50');
    const short = alerts.find((x) => x.kind === 'customer_rejection' && x.tripId === trip.id);
    check('the owner hears of the shortfall, and that the invoice follows what was delivered', short?.title === 'Delivered short to Hotel Sagar: Onion' && /40 of 50 — the customer took less \(slow day\)/.test(short?.detail ?? '') && /invoice follows what was delivered/.test(short?.detail ?? ''), JSON.stringify(short));

    // ---- Shop B: no QR, and crates that don't add up ----
    await owner.upload(`/logistics/trips/${trip.id}/stops/${shopB.id}/photos`, { photoType: 'pod' });
    await owner.post(`/logistics/trips/${trip.id}/stops/${shopB.id}/complete-delivery`, {
      ...base,
      qrNote: 'QR missing',
      crates: [{ crateTypeId: crateType.id, dropped: 30, collected: 0 }],
    });
    stops = await owner.get(`/logistics/trips/${trip.id}/stops`);
    const b = stops.find((s) => s.id === shopB.id);
    check("a missing QR doesn't stop the delivery: recorded as not scanned, with why", b.status === 'completed' && b.delivery?.qrStatus === 'not_scanned' && b.delivery.qrNote === 'QR missing', JSON.stringify(b.delivery));
    check("crates the vehicle doesn't hold aren't recorded…", b.delivery?.crates.dropped === 0, JSON.stringify(b.delivery?.crates));
    alerts = await owner.get('/alerts?limit=50');
    const crateAlert = alerts.find((x) => x.kind === 'inventory_mismatch' && x.tripId === trip.id);
    check('…the owner is told, with the driver’s count', crateAlert?.title === 'Crates at Green Leaf Mess not recorded' && /30 left/.test(crateAlert?.detail ?? '') && /holds only 10/.test(crateAlert?.detail ?? ''), JSON.stringify(crateAlert));

    // ---- The owner's screens ----
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
      await page.locator('.detail').getByRole('button', { name: 'Stops', exact: true }).click();
      await page.waitForFunction(() => /QR scanned/.test(document.querySelector('.detail')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
      const shown = (await page.locator('.detail').textContent()).replace(/\s+/g, ' ');
      check(
        "the owner's Stops tab shows each delivery's QR, shortfalls and crates",
        /QR scanned · Short: Onion 40 kg of 50 kg \(The customer took less — slow day\) · Crates 10 left, 0 back/.test(shown) && /QR not scanned — QR missing/.test(shown),
        shown.slice(0, 700),
      );
      await page.locator('.detail').getByRole('button', { name: 'Close', exact: true }).click();

      await page.goto(`${BASE}/customers?open=${sagar.id}`);
      await page.getByRole('button', { name: 'Delivery QR' }).click();
      await page.waitForSelector('.delivery-qr svg');
      const qrText = await page.locator('.delivery-qr-code').textContent();
      check("the customer's profile shows the QR to print, with its code", qrText.trim() === sagar.qrToken && (await page.locator('.delivery-qr svg rect, .delivery-qr svg path').count()) > 0, qrText);
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
