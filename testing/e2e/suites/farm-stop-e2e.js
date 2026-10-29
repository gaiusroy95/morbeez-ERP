// Driver app V1, Phase D2 — the farmer stop (docs/redesign/driver-app-v1-plan.md;
// client spec §5–§8, the client's answers 1 and 4): reaching the farm; each
// product of the purchase order accepted — weighed, or counted in bags of a
// set weight, packed in sacks, loaded onto the vehicle at the owner's rate —
// or rejected with a reason and a photo; never completed with a product
// still open; the packer and loader (the business's own workers) credited
// with the kilos loaded, once when the same person did both; the owner told
// of rejections. Runs in the redesign chain, on the seeded business, with
// its own driver, vehicle and purchase orders.
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
    // A 1×1 JPEG is enough: the API checks the type, not the picture.
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
    const farmers = (await owner.get('/farmers?pageSize=100')).items;
    const tomato = products.find((p) => p.name === 'Tomato');
    const onion = products.find((p) => p.name === 'Onion');
    const lakshmi = farmers.find((f) => f.name === 'Lakshmi Devi');
    const ramesh = farmers.find((f) => f.name === 'Ramesh Patil');
    const ginger = await owner.post('/products', { name: 'Ginger', baseUom: 'kg' });

    // ---- The crew: the business's own workers ----
    const packer = await owner.post('/workforce', { name: 'Mani Packer', roleType: 'warehouse' });
    const loader = await owner.post('/workforce', { name: 'Kumar Loader', roleType: 'warehouse' });
    const day = await driverApp.get('/logistics/trips/mine/day');
    const crewNames = (day.crew ?? []).map((c) => c.name);
    check("the driver's day lists the business's workers to pick the crew from, warehouse hands first", crewNames.includes('Mani Packer') && crewNames.includes('Kumar Loader') && day.crew[0].roleType === 'warehouse', crewNames.join(', '));

    // ---- A trip with two farms ----
    const venu = await owner.post('/workforce', { name: 'Venu Driver', roleType: 'driver' });
    await db.query('UPDATE trading_partners.employee SET delegation_level = 4, standing_delegation = true WHERE id = $1', [venu.id]);
    const van = await owner.post('/vehicles', { registrationNumber: 'KA01D30003', capacityKg: 2000, fuelType: 'diesel' });
    const purchase = async (farmer, lines) => {
      let po = await owner.post('/procurement/purchase-orders', { farmerId: farmer.id, lines });
      po = await owner.post(`/procurement/purchase-orders/${po.id}/confirm`, { version: po.version });
      return { po, pickup: await owner.post(`/procurement/purchase-orders/${po.id}/pickups`, {}) };
    };
    const first = await purchase(lakshmi, [
      { productId: tomato.id, expectedQuantity: 500, indicativePrice: 20 },
      { productId: onion.id, expectedQuantity: 300, indicativePrice: 15 },
      { productId: ginger.id, expectedQuantity: 200, indicativePrice: 60 },
    ]);
    const second = await purchase(ramesh, [{ productId: tomato.id, expectedQuantity: 100, indicativePrice: 21 }]);
    let trip = await owner.post('/logistics/trips', { vehicleId: van.id, driverEmployeeId: venu.id, pickupIds: [first.pickup.id, second.pickup.id] });
    let stops = await owner.get(`/logistics/trips/${trip.id}/stops`);
    const farmA = stops.find((s) => s.pickupId === first.pickup.id);
    const farmB = stops.find((s) => s.pickupId === second.pickup.id);

    const early = await owner.raw('POST', `/logistics/trips/${trip.id}/stops/${farmA.id}/arrive`);
    check("a stop can't be reached before the trip is on the road", early.status === 409, String(early.status));
    trip = await owner.post(`/logistics/trips/${trip.id}/start`, { version: trip.version });

    // ---- Reaching the farm ----
    const reached = await owner.post(`/logistics/trips/${trip.id}/stops/${farmA.id}/arrive`);
    const again = await owner.post(`/logistics/trips/${trip.id}/stops/${farmA.id}/arrive`);
    check('Start pickup records when the driver reached the farm — the first time only', !!reached.arrivedAt && again.arrivedAt === reached.arrivedAt, `${reached.arrivedAt} ${again.arrivedAt}`);

    // ---- Photos ----
    const why = await owner.upload(`/logistics/trips/${trip.id}/stops/${farmA.id}/photos`, { photoType: 'rejection', productId: ginger.id });
    check('a rejection photo names the product it shows', why.status === 201 && why.body?.productId === ginger.id && why.body?.photoType === 'rejection', `${why.status} ${JSON.stringify(why.body)}`);
    const loaded = await owner.upload(`/logistics/trips/${trip.id}/stops/${farmA.id}/photos`, { photoType: 'load' });
    check('…and the load is photographed', loaded.status === 201 && loaded.body?.photoType === 'load' && loaded.body?.productId === null, String(loaded.status));
    const garlic = await owner.post('/products', { name: 'Garlic', baseUom: 'kg' });
    const wrong = await owner.upload(`/logistics/trips/${trip.id}/stops/${farmA.id}/photos`, { photoType: 'rejection', productId: garlic.id });
    check("a photo can't name a product this farm doesn't supply", wrong.status === 400, String(wrong.status));

    // ---- Never completed with a product open ----
    const accepted = [
      { productId: tomato.id, outcome: 'accepted', netQuantity: 480, sacks: 10 },
      { productId: onion.id, outcome: 'accepted', measuredBy: 'bags', sacks: 7, kgPerBag: 45 },
    ];
    const open = await owner.raw('POST', `/logistics/trips/${trip.id}/stops/${farmA.id}/complete-pickup`, { lines: accepted });
    check('a farm with a product neither accepted nor rejected is refused', open.status === 400 && /Ginger still open/.test(open.body?.error?.message ?? ''), open.body?.error?.message);
    const noReason = await owner.raw('POST', `/logistics/trips/${trip.id}/stops/${farmA.id}/complete-pickup`, { lines: [...accepted, { productId: ginger.id, outcome: 'rejected' }] });
    check('a rejection needs its reason', noReason.status === 400 && /Say why Ginger/.test(noReason.body?.error?.message ?? ''), noReason.body?.error?.message);
    const stranger = await owner.raw('POST', `/logistics/trips/${trip.id}/stops/${farmA.id}/complete-pickup`, {
      lines: [...accepted, { productId: ginger.id, outcome: 'rejected', reason: 'quality_issue' }],
      packerEmployeeId: '00000000-0000-4000-8000-000000000001',
    });
    check("the packer must be one of the business's workers", stranger.status === 400, stranger.body?.error?.message);
    stops = await owner.get(`/logistics/trips/${trip.id}/stops`);
    check('…and a refused completion receives nothing', stops.find((s) => s.id === farmA.id).status === 'pending' && (await db.query('SELECT count(*)::int AS n FROM commerce.lot WHERE purchase_order_id = $1', [first.po.id])).rows[0].n === 0);

    // ---- Completed ----
    await owner.post(`/logistics/trips/${trip.id}/stops/${farmA.id}/complete-pickup`, {
      lines: [...accepted, { productId: ginger.id, outcome: 'rejected', reason: 'quality_issue', note: 'soft, black spots' }],
      packerEmployeeId: packer.id,
      loaderEmployeeId: loader.id,
    });
    stops = await owner.get(`/logistics/trips/${trip.id}/stops`);
    const farm = stops.find((s) => s.id === farmA.id).farm;
    const line = (id) => farm?.lines.find((l) => l.productId === id);
    check('the stop keeps every product: accepted by weight, by bags (7 × 45 kg), rejected with its reason', line(tomato.id)?.acceptedQuantity === '480.000' && line(tomato.id)?.sacks === 10 && line(onion.id)?.acceptedQuantity === '315.000' && line(onion.id)?.measuredBy === 'bags' && line(onion.id)?.kgPerBag === '45.000' && line(ginger.id)?.outcome === 'rejected' && line(ginger.id)?.reason === 'quality_issue' && line(ginger.id)?.note === 'soft, black spots', JSON.stringify(farm?.lines));
    check('…its crew and the kilos loaded', farm?.packer?.name === 'Mani Packer' && farm?.loader?.name === 'Kumar Loader' && farm?.loadedKg === '795.000', JSON.stringify({ p: farm?.packer, l: farm?.loader, kg: farm?.loadedKg }));

    const lots = (await db.query('SELECT product_id, accepted_quantity::text AS a, unit_cost::text AS c FROM commerce.lot WHERE purchase_order_id = $1', [first.po.id])).rows;
    const lotOf = (id) => lots.find((l) => l.product_id === id);
    check("what was accepted is received at the owner's rate; nothing for the rejected product", lotOf(tomato.id)?.a === '480.000' && Number(lotOf(tomato.id)?.c) === 20 && lotOf(onion.id)?.a === '315.000' && Number(lotOf(onion.id)?.c) === 15 && !lotOf(ginger.id), JSON.stringify(lots));
    const stock = await owner.get(`/logistics/trips/${trip.id}/vehicle-stock`);
    check('…and it is on the vehicle', stock.totalsKg.onVehicle === '795.000', JSON.stringify(stock.totalsKg));

    const work = (await db.query(
      `SELECT e.name, a.kind, a.units::text AS units, a.notes, a.trip_id FROM workforce.assignment a JOIN trading_partners.employee e ON e.id = a.employee_id
       WHERE a.employee_id = ANY($1) ORDER BY a.created_at`,
      [[packer.id, loader.id]],
    )).rows;
    check('the packer and loader are each credited with the kilos loaded, as loading work', work.length === 2 && work.every((w) => w.kind === 'loading' && w.units === '795.000') && /^Packed at Lakshmi Devi, trip T-/.test(work.find((w) => w.name === 'Mani Packer')?.notes ?? '') && /^Loaded at Lakshmi Devi/.test(work.find((w) => w.name === 'Kumar Loader')?.notes ?? ''), JSON.stringify(work));

    const alerts = await owner.get('/alerts?limit=50');
    const rejected = alerts.find((a) => a.kind === 'procurement_issue' && a.tripId === trip.id);
    check('the owner hears of the rejection, with the reason', rejected?.title === 'Rejected at Lakshmi Devi: Ginger' && /Quality issue: soft, black spots/.test(rejected?.detail ?? ''), JSON.stringify(rejected));

    const twice = await owner.raw('POST', `/logistics/trips/${trip.id}/stops/${farmA.id}/complete-pickup`, { lines: [...accepted, { productId: ginger.id, outcome: 'rejected', reason: 'other' }] });
    check('a completed farm stop is final', twice.status === 409, String(twice.status));

    // ---- The same person packs and loads ----
    await owner.post(`/logistics/trips/${trip.id}/stops/${farmB.id}/complete-pickup`, {
      lines: [{ productId: tomato.id, outcome: 'accepted', netQuantity: 98.5 }],
      packerEmployeeId: packer.id,
      loaderEmployeeId: packer.id,
    });
    const mani = (await db.query("SELECT units::text AS units, notes FROM workforce.assignment WHERE employee_id = $1 AND notes LIKE '%Ramesh Patil%'", [packer.id])).rows;
    check('one worker packing and loading is credited once', mani.length === 1 && mani[0].units === '98.500' && /^Packed and loaded at Ramesh Patil/.test(mani[0].notes), JSON.stringify(mani));
    const quiet = (await owner.get('/alerts?limit=50')).filter((a) => a.kind === 'procurement_issue' && a.tripId === trip.id);
    check('a farm with nothing rejected raises no alert', quiet.length === 1, String(quiet.length));

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
      await page.locator('.detail').getByRole('button', { name: 'Stops', exact: true }).click();
      await page.waitForFunction(() => /Loaded 795/.test(document.querySelector('.detail')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
      const shown = (await page.locator('.detail').textContent()).replace(/\s+/g, ' ');
      check(
        "the owner's Stops tab shows what each farm loaded, what it refused and why, and who packed and loaded",
        /Loaded 795 kg/.test(shown) && /Rejected: Ginger \(Quality issue — soft, black spots\)/.test(shown) && /Packed by Mani Packer, loaded by Kumar Loader/.test(shown) && /Packed and loaded by Mani Packer/.test(shown),
        shown.slice(0, 600),
      );
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
