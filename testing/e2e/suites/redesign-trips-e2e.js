// Owner app redesign, Phase 4 — Routes and Trips (docs/redesign): routes
// with their customers and farmers in visiting order, a trip planned by
// route (its orders and its farmers' pickups loaded for the day), its
// number and crew, the stops in route order, the Trips list, quantities
// product by product, the vehicle counted at closing, the crew's trip work,
// and the Create Trip form, trip details and Routes screen on a phone.
// Runs after the procurement and orders suites, on the seeded business.
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
  return { raw: call, get: (p) => ok('GET', p), post: (p, b = {}) => ok('POST', p, b), patch: (p, b) => ok('PATCH', p, b), put: (p, b) => ok('PUT', p, b) };
}
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

(async () => {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const browser = await launchBrowser();
  try {
    const owner = client(await login('owner@dev.morbeez.local'));
    const customers = (await owner.get('/customers?pageSize=100')).items;
    const farmers = (await owner.get('/farmers?pageSize=100')).items;
    const products = (await owner.get('/products?pageSize=100')).items;
    const vehicles = (await owner.get('/vehicles?pageSize=100')).items;
    const workers = (await owner.get('/workforce?pageSize=100')).items;
    const sagar = customers.find((c) => c.name === 'Hotel Sagar');
    const ramesh = farmers.find((f) => f.name === 'Ramesh Patil');
    const lakshmi = farmers.find((f) => f.name === 'Lakshmi Devi');
    const tomato = products.find((p) => p.name === 'Tomato');
    const onion = products.find((p) => p.name === 'Onion');
    const truck = vehicles.find((v) => v.registrationNumber === 'MH12AB4521');
    const suresh = workers.find((w) => w.name === 'Suresh Kale');
    const tz = (await db.query('SELECT timezone FROM tenant.tenant WHERE id = (SELECT tenant_id FROM trading_partners.customer WHERE id = $1)', [sagar.id])).rows[0].timezone;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    const tomorrow = addDays(today, 1);
    const fresh = await owner.post('/customers', { name: 'Fresh Mart', place: 'Nanjangud', creditLimit: 500000, paymentTermsDays: 15 });
    const packer = await owner.post('/workforce', { name: 'Mahesh Packer', roleType: 'warehouse' });
    const loader = await owner.post('/workforce', { name: 'Anil Loader', roleType: 'other' });

    // ---- Routes with stops in visiting order ----
    const route = await owner.post('/routes', { name: 'Gundlupet Route' });
    const stops = await owner.put(`/routes/${route.id}/stops`, {
      stops: [
        { kind: 'farmer', partyId: ramesh.id },
        { kind: 'customer', partyId: fresh.id },
        { kind: 'customer', partyId: sagar.id },
      ],
    });
    check('a route keeps its customers and farmers in visiting order', stops.map((s) => s.name).join(' → ') === 'Ramesh Patil → Fresh Mart → Hotel Sagar' && stops[0].kind === 'farmer', stops.map((s) => s.name).join(' → '));
    const listed = (await owner.get('/routes')).find((r) => r.id === route.id);
    check('…and counts them', listed.customers === 2 && listed.farmers === 1, JSON.stringify(listed));
    check("a customer on it has it as their usual route", (await owner.get(`/customers/${sagar.id}`)).routeId === route.id);
    const other = await owner.post('/routes', { name: 'Hunsur Side' });
    const moved = await owner.patch(`/customers/${fresh.id}`, { version: fresh.version, routeId: other.id });
    const afterMove = await owner.get(`/routes/${route.id}/stops`);
    check("changing a customer's usual route moves them off the old route", moved.routeId === other.id && !afterMove.some((s) => s.partyId === fresh.id), afterMove.map((s) => s.name).join(', '));
    await owner.put(`/routes/${route.id}/stops`, {
      stops: [
        { kind: 'farmer', partyId: ramesh.id },
        { kind: 'customer', partyId: fresh.id },
        { kind: 'customer', partyId: sagar.id },
      ],
    });
    check('…and putting them on a route takes them off the other', (await owner.get(`/routes/${other.id}/stops`)).length === 0 && (await owner.get(`/customers/${fresh.id}`)).routeId === route.id);
    check('a party only once on a route', (await owner.raw('PUT', `/routes/${route.id}/stops`, { stops: [{ kind: 'customer', partyId: sagar.id }, { kind: 'customer', partyId: sagar.id }] })).status === 400);
    check('an unknown party is refused', (await owner.raw('PUT', `/routes/${route.id}/stops`, { stops: [{ kind: 'farmer', partyId: '00000000-0000-4000-8000-000000000000' }] })).status === 400);
    const renamed = await owner.patch(`/routes/${other.id}`, { name: 'Hunsur Highway' });
    check('a route can be renamed', renamed.name === 'Hunsur Highway');
    check('…but not to a name already used', (await owner.raw('PATCH', `/routes/${other.id}`, { name: 'gundlupet route' })).status === 409);

    // ---- Stock, orders and pickups for the day ----
    // A lot is reserved whole for one order line: one graded lot per order.
    async function gradedLot(product, qty) {
      let po = await owner.post('/procurement/purchase-orders', { farmerId: lakshmi.id, lines: [{ productId: product.id, expectedQuantity: qty, indicativePrice: 20 }] });
      po = await owner.post(`/procurement/purchase-orders/${po.id}/confirm`, { version: po.version });
      await owner.post(`/procurement/purchase-orders/${po.id}/receive-goods`, { lines: [{ productId: product.id, receivedQuantity: qty }] });
      for (const lot of await owner.get(`/procurement/purchase-orders/${po.id}/lots`)) {
        await owner.post(`/procurement/lots/${lot.id}/grade`, { version: lot.version, acceptedQuantity: qty, rejectedQuantity: 0, unitCost: 20 });
      }
    }
    await gradedLot(tomato, 300);
    await gradedLot(onion, 200);
    const plan = { deliveryDate: today, driverEmployeeId: suresh.id, vehicleId: truck.id, confirm: true };
    const toSagar = await owner.post('/orders', { ...plan, customerId: sagar.id, lines: [{ productId: tomato.id, quantity: 300, unitPrice: 30 }] });
    const toFresh = await owner.post('/orders', { ...plan, customerId: fresh.id, lines: [{ productId: onion.id, quantity: 200, unitPrice: 28 }] });
    const notYet = await owner.post('/orders', { customerId: sagar.id, deliveryDate: today, lines: [{ productId: tomato.id, quantity: 25, unitPrice: 30 }] });
    check('orders for the day take the route from their customer', toSagar.routeId === route.id && toFresh.routeId === route.id && toSagar.status === 'confirmed' && toFresh.status === 'confirmed');
    const fromRamesh = await owner.post('/procurement/purchase-orders', {
      farmerId: ramesh.id, pickupDate: today, pickupTime: '07:00', driverEmployeeId: suresh.id, vehicleId: truck.id, confirm: true,
      lines: [{ productId: tomato.id, expectedQuantity: 500, indicativePrice: 22 }],
    });
    const fromLakshmi = await owner.post('/procurement/purchase-orders', {
      farmerId: lakshmi.id, pickupDate: today, confirm: true, driverEmployeeId: suresh.id, vehicleId: truck.id,
      lines: [{ productId: onion.id, expectedQuantity: 100, indicativePrice: 18 }],
    });
    const rameshPickup = (await owner.get(`/procurement/purchase-orders/${fromRamesh.id}/pickups`))[0];
    const lakshmiPickup = (await owner.get(`/procurement/purchase-orders/${fromLakshmi.id}/pickups`))[0];

    // ---- What a trip on the route could carry ----
    const loaded = await owner.get(`/logistics/trips/plan?date=${today}&routeId=${route.id}&vehicleId=${truck.id}`);
    const planOrder = (id) => loaded.orders.find((o) => o.id === id);
    check("the route's orders for the day load, in visiting order", loaded.orders.map((o) => o.customerName).join(',').startsWith('Fresh Mart,Hotel Sagar') && !!planOrder(toFresh.id) && !!planOrder(toSagar.id), loaded.orders.map((o) => `${o.customerName}:${o.status}`).join(', '));
    check('…an order not confirmed yet is shown, as placed', planOrder(notYet.id)?.status === 'placed');
    check('…with each order’s kg', planOrder(toSagar.id).kg === '300.000' && planOrder(toFresh.id).kg === '200.000');
    check("the route's farmers' pickups load; other farmers' are offered apart", loaded.pickups.some((p) => p.pickupId === rameshPickup.id) && loaded.otherPickups.some((p) => p.pickupId === lakshmiPickup.id) && !loaded.pickups.some((p) => p.pickupId === lakshmiPickup.id));
    check("the vehicle's capacity and what's on it come with the plan", loaded.vehicle?.registrationNumber === 'MH12AB4521' && Number(loaded.vehicle.capacityKg) > 0 && loaded.vehicle.stockKg === '0.000', JSON.stringify(loaded.vehicle));

    // ---- Create the trip ----
    const refused = await owner.raw('POST', '/logistics/trips', { vehicleId: truck.id, driverEmployeeId: suresh.id, plannedDate: today, orderIds: [notYet.id] });
    check('an order not confirmed can’t go on a trip', refused.status === 409 && /not confirmed/.test(refused.body?.error?.message ?? ''), refused.body?.error?.message);
    check("the driver can't also be the packer", (await owner.raw('POST', '/logistics/trips', { vehicleId: truck.id, driverEmployeeId: suresh.id, packerEmployeeId: suresh.id })).status === 400);
    const trip = await owner.post('/logistics/trips', {
      plannedDate: today,
      routeId: route.id,
      vehicleId: truck.id,
      driverEmployeeId: suresh.id,
      packerEmployeeId: packer.id,
      loaderEmployeeId: loader.id,
      orderIds: [toSagar.id, toFresh.id],
      pickupIds: [rameshPickup.id],
    });
    check('the trip is numbered for its day', new RegExp(`^T-${today.replace(/-/g, '')}-\\d{3}$`).test(trip.number), trip.number);
    check('…with its route and crew', trip.routeId === route.id && trip.packerEmployeeId === packer.id && trip.loaderEmployeeId === loader.id);
    const tripStops = await owner.get(`/logistics/trips/${trip.id}/stops`);
    check("its stops are in the route's visiting order", tripStops.map((s) => s.party?.name).join(' → ') === 'Ramesh Patil → Fresh Mart → Hotel Sagar', tripStops.map((s) => s.party?.name).join(' → '));
    const next = await owner.post('/logistics/trips', { vehicleId: truck.id, driverEmployeeId: suresh.id, plannedDate: today });
    check("the day's numbers run on", Number(next.number.slice(-3)) === Number(trip.number.slice(-3)) + 1, `${trip.number} → ${next.number}`);
    const twice = await owner.raw('POST', `/logistics/trips/${next.id}/stops/delivery`, { orderId: toSagar.id });
    check('an order on one trip can’t go on another', twice.status === 409 && twice.body?.error?.message.includes(trip.number), twice.body?.error?.message);
    const twicePickup = await owner.raw('POST', `/logistics/trips/${next.id}/stops/pickup`, { pickupId: rameshPickup.id });
    check('…nor a pickup', twicePickup.status === 409);
    await owner.post(`/logistics/trips/${next.id}/cancel`, { version: next.version });
    const reloaded = await owner.get(`/logistics/trips/plan?date=${today}&routeId=${route.id}`);
    check("what's on a trip is no longer offered", !reloaded.orders.some((o) => o.id === toSagar.id || o.id === toFresh.id) && !reloaded.pickups.some((p) => p.pickupId === rameshPickup.id));

    // ---- The Trips list ----
    const board = await owner.get('/logistics/trips/board?day=today');
    const card = board.items.find((c) => c.id === trip.id);
    check("today's list has the trip with its route, parties, kg, vehicle and driver", card && card.routeName === 'Gundlupet Route' && card.customers === 2 && card.farmers === 1 && card.kg === '500.000' && card.vehicle === 'MH12AB4521' && card.driverName === 'Suresh Kale' && card.stops === 3, JSON.stringify(card));
    check('a cancelled trip is not on Today', !board.items.some((c) => c.id === next.id));
    for (const [q, label] of [[trip.number, 'number'], ['gundlupet', 'route'], ['ramesh', 'farmer'], ['fresh mart', 'customer'], ['MH12', 'vehicle']]) {
      const found = await owner.get(`/logistics/trips/board?day=all&q=${encodeURIComponent(q)}`);
      check(`search finds it by ${label}`, found.items.some((c) => c.id === trip.id), `${q}: ${found.items.length}`);
    }

    // ---- On the road, then the quantities ----
    await owner.post(`/logistics/trips/${trip.id}/start`, { version: (await owner.get(`/logistics/trips/${trip.id}`)).version });
    const [pickupStop, freshStop, sagarStop] = tripStops;
    await owner.post(`/logistics/trips/${trip.id}/stops/${pickupStop.id}/complete-pickup`, { weights: [{ productId: tomato.id, netQuantity: 480 }] });
    await owner.post(`/logistics/trips/${trip.id}/stops/${freshStop.id}/complete-delivery`, { recipientName: 'Manager', signatureData: 'data:image/png;base64,iVBORw0KGgo=' });
    await owner.post(`/logistics/trips/${trip.id}/stops/${sagarStop.id}/skip`, { reason: 'Shop closed' });
    const q = await owner.get(`/logistics/trips/${trip.id}/quantities`);
    const row = (name) => q.rows.find((r) => r.product === name);
    check(
      'tomato: loaded 300, picked up 480, none delivered (the shop was closed) → 780 should be on the vehicle',
      row('Tomato')?.loaded === '300.000' && row('Tomato').procured === '480.000' && row('Tomato').delivered === '0.000' && row('Tomato').toDeliver === '0.000' && row('Tomato').expected === '780.000',
      JSON.stringify(row('Tomato')),
    );
    check('onion: loaded 200, delivered 200 → none left', row('Onion')?.expected === '0.000' && row('Onion').delivered === '200.000', JSON.stringify(row('Onion')));
    check('not counted yet', q.balanced === null && q.totalsKg.expected === '780.000');
    const running = await owner.get(`/logistics/trips/${trip.id}`);
    await owner.post(`/logistics/trips/${trip.id}/complete`, { version: running.version, cashDeclared: 0 });
    const crew = await db.query('SELECT employee_id, notes FROM workforce.assignment WHERE trip_id = $1 ORDER BY notes NULLS FIRST', [trip.id]);
    check("the driver, packer and loader each have the trip on their work", crew.rows.length === 3 && crew.rows.some((r) => r.employee_id === packer.id) && crew.rows.some((r) => r.employee_id === loader.id), crew.rows.map((r) => r.notes ?? 'driver').join(', '));

    // ---- Closing: the vehicle counted ----
    const submitted = await owner.get(`/logistics/trips/${trip.id}`);
    const counted = [{ productId: tomato.id, quantity: 770 }];
    const noReason = await owner.raw('POST', `/logistics/trips/${trip.id}/reconcile`, { version: submitted.version, cashReturned: 0, closingStock: counted });
    check('closing with exceptions (a stop skipped, the count off) needs a reason', noReason.status === 409 && /load/.test(noReason.body?.error?.message ?? ''), noReason.body?.error?.message);
    const closed = await owner.post(`/logistics/trips/${trip.id}/reconcile`, { version: submitted.version, cashReturned: 0, closingStock: counted, exceptionNote: 'Ten kg spoiled' });
    const load = closed.checklist.find((c) => c.area === 'load');
    check('…recorded as a load exception, product by product', closed.outcome === 'approved_exception' && /Tomato on the vehicle: counted 770 kg, expected 780 kg \(10 kg short\)/.test(load.detail), load.detail);
    check('the count is kept with the closure', closed.closingStock?.find((c) => c.productId === tomato.id)?.counted === '770.000' && closed.closingStock.length === 2);
    const afterClose = await owner.get(`/logistics/trips/${trip.id}/quantities`);
    check('…and the quantities show it: not in balance, 10 kg short', afterClose.balanced === false && afterClose.rows.find((r) => r.product === 'Tomato').difference === '-10.000');
    check(
      '…770 kg came back to the store, 10 kg written off',
      afterClose.rows.find((r) => r.product === 'Tomato').returned === '770.000' && afterClose.rows.find((r) => r.product === 'Tomato').writtenOff === '10.000',
      JSON.stringify(afterClose.rows.find((r) => r.product === 'Tomato')),
    );

    // ---- Another business sees none of it ----
    const otherPhone = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
    const signup = await fetch(`${API}/tenants`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ businessName: 'Other Haulage', ownerPhone: otherPhone, ownerPassword: 'another-password-1' }) });
    const them = client((await signup.json()).accessToken);
    check("another business's trips list and routes are empty", (await them.get('/logistics/trips/board?day=all')).counts.all === 0 && (await them.get('/routes')).length === 0);
    check("…and it can't touch this business's route", (await them.raw('PUT', `/routes/${route.id}/stops`, { stops: [] })).status === 404);
    const theirPlan = await them.get(`/logistics/trips/plan?date=${today}&routeId=${route.id}`);
    check("…nor see this business's orders or pickups when planning", theirPlan.orders.length + theirPlan.otherOrders.length + theirPlan.pickups.length + theirPlan.otherPickups.length === 0);

    // Tomorrow's orders on the route, for the form: one confirmed, one not.
    await gradedLot(tomato, 60);
    const tmrOrder = await owner.post('/orders', { ...plan, deliveryDate: tomorrow, customerId: sagar.id, lines: [{ productId: tomato.id, quantity: 60, unitPrice: 31 }] });
    await owner.post('/orders', { customerId: fresh.id, deliveryDate: tomorrow, lines: [{ productId: onion.id, quantity: 999, unitPrice: 25 }] });

    // ---- The phone screens ----
    const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/login`);
    await page.fill('#login', 'owner@dev.morbeez.local');
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL((u) => !/\/login/.test(u.toString()));
    await page.goto(`${BASE}/logistics`);
    await page.waitForSelector('.list-card', { timeout: 20000 });
    const tabs = await page.locator('.day-tabs button').allInnerTexts();
    check('tabs show Today / Tomorrow / All with counts', /^Today \(\d+\)$/.test(tabs[0]) && /^Tomorrow \(\d+\)$/.test(tabs[1]) && /^All \(\d+\)$/.test(tabs[2]), tabs.join(' | '));
    const shown = (await page.locator('.list-card', { hasText: trip.number }).textContent()).replace(/\s+/g, ' ');
    check('the card reads like the design', /Gundlupet Route/.test(shown) && /2 Customers · 1 Farmer/.test(shown) && /500 kg/.test(shown) && /Suresh Kale/.test(shown) && /MH12AB4521/.test(shown) && /Completed/.test(shown), shown);
    await page.fill('.search-filter input', 'gundlupet');
    await page.waitForTimeout(800);
    const titles = await page.locator('.list-card-title').allInnerTexts();
    check('search narrows the cards', titles.length > 0 && titles.every((x) => /Gundlupet/.test(x)), titles.join(', '));
    await page.fill('.search-filter input', '');

    // The closed trip's details: tabs, quantities.
    await page.locator('.list-card', { hasText: trip.number }).click();
    await page.waitForFunction((n) => document.querySelector('.detail')?.textContent.includes(n) && /Gundlupet Route/.test(document.querySelector('.detail').textContent), trip.number);
    const overview = (await page.locator('.detail').textContent()).replace(/\s+/g, ' ');
    check('trip details open on the overview: route, crew, counts, stops timeline', /Gundlupet Route/.test(overview) && /Mahesh Packer/.test(overview) && /Anil Loader/.test(overview) && /Ramesh Patil/.test(overview) && /2 of 3 done|3 of 3 done/.test(overview), overview.slice(0, 300));
    await page.locator('.detail').getByRole('button', { name: 'Quantities', exact: true }).click();
    await page.waitForSelector('.qty-table');
    const qtyText = (await page.locator('.detail').textContent()).replace(/\s+/g, ' ');
    check('the Quantities tab has the reconciliation table and the count', /Quantity Reconciliation \(kg\)/.test(qtyText) && /780/.test(qtyText) && /770/.test(qtyText) && /not in balance/.test(qtyText), qtyText.slice(0, 400));
    await page.locator('.detail').getByRole('button', { name: 'Stops', exact: true }).click();
    const stopsText = (await page.locator('.detail').textContent()).replace(/\s+/g, ' ');
    check('the Stops tab lists each stop and why one was skipped', /Shop closed/.test(stopsText) && /Fresh Mart/.test(stopsText), stopsText.slice(0, 300));
    await page.locator('.detail').getByRole('button', { name: 'Close', exact: true }).click();

    // Create Trip on the form: tomorrow, by route.
    await page.getByRole('button', { name: 'Create Trip' }).click();
    const dialog = () => page.locator('dialog[open]').last();
    await dialog().getByLabel('Trip Date').fill(tomorrow);
    await dialog().getByLabel('Route', { exact: true }).click();
    await dialog().locator('.picker-search').fill('Gundlupet');
    await dialog().getByRole('option', { name: 'Gundlupet Route' }).click();
    await page.waitForFunction(() => /Delivery Orders \(1\)/.test(document.querySelector('dialog[open]')?.textContent ?? ''), null, { timeout: 15000 });
    const sagarRow = dialog().locator('.plan-row', { hasText: 'Hotel Sagar' });
    const freshRow = dialog().locator('.plan-row', { hasText: 'Fresh Mart' });
    check("the route's confirmed order for the day is loaded and ticked", await sagarRow.locator('input').isChecked());
    check('…one not confirmed yet is shown, greyed, with why', (await freshRow.locator('input').isDisabled()) && /Not confirmed yet/.test(await freshRow.textContent()));
    check('the driver and vehicle planned on the orders are filled in', (await dialog().getByLabel('Driver', { exact: true }).inputValue()) === suresh.id && (await dialog().getByLabel('Vehicle', { exact: true }).inputValue()) === truck.id);
    await dialog().getByLabel('Packer (optional)').selectOption({ label: 'Mahesh Packer' });
    await page.waitForFunction(() => /Fits the vehicle|More than the vehicle/.test(document.querySelector('dialog[open] .qty-check')?.textContent ?? ''), null, { timeout: 15000 });
    const quantity = (await dialog().locator('.qty-check').textContent()).replace(/\s+/g, ' ');
    check('the quantity check adds up the load against the vehicle', /Delivery\s*60 kg/.test(quantity) && /Fits the vehicle/.test(quantity), quantity);
    await dialog().getByRole('button', { name: 'Review Trip →' }).click();
    await dialog().getByRole('heading', { name: 'Review Trip' }).waitFor();
    const review = (await dialog().textContent()).replace(/\s+/g, ' ');
    check('Review Trip lists the stops in order with the crew', /Hotel Sagar/.test(review) && /Mahesh Packer/.test(review) && /Stops, in visiting order \(1\)/.test(review), review.slice(0, 300));
    await dialog().getByRole('button', { name: 'Create Trip', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 0, null, { timeout: 15000 });
    await page.waitForFunction((d) => /T-\d{8}-\d{3}/.test(document.querySelector('.detail')?.textContent ?? '') && document.querySelector('.detail').textContent.includes('Hotel Sagar'), tomorrow, { timeout: 15000 });
    const created = (await owner.get('/logistics/trips/board?day=tomorrow')).items.find((c) => c.routeName === 'Gundlupet Route');
    check('the trip is created for tomorrow with its delivery', created && created.customers === 1 && created.stops === 1 && created.number.includes(tomorrow.replace(/-/g, '')), JSON.stringify(created));
    const createdTrip = await owner.get(`/logistics/trips/${created.id}`);
    check('…with the packer', createdTrip.packerEmployeeId === packer.id);
    void tmrOrder;

    // The Routes screen: move a stop and it sticks.
    await page.goto(`${BASE}/routes`);
    await page.locator('.list-card', { hasText: 'Gundlupet Route' }).click();
    await page.waitForSelector('.route-stops li');
    await page.getByRole('button', { name: 'Move Ramesh Patil down' }).click();
    await page.waitForFunction(() => document.querySelector('.route-stops li strong')?.textContent === 'Fresh Mart', null, { timeout: 10000 });
    const order = (await owner.get(`/routes/${route.id}/stops`)).map((s) => s.name).join(' → ');
    check('the Routes screen reorders the stops', order === 'Fresh Mart → Ramesh Patil → Hotel Sagar', order);
    check('no page errors', errors.length === 0, errors.join('; '));
  } catch (e) {
    check('flow', false, e.message.split('\n')[0]);
  } finally {
    await browser.close();
    await db.end();
  }
  console.log(results.join('\n'));
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);
})();
