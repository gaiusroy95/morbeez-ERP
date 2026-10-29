// Owner app redesign, Phase 3 — Delivery orders (docs/redesign): routes,
// the customer's place / address / usual route, order numbers, the delivery
// plan, the credit term on an order (and the invoice due date it sets),
// "Save Order" that confirms when it can, the Today/Tomorrow/All list with
// search and statuses that follow the trip, and the "Create Delivery
// Order" form on a phone. Runs after the procurement suite (its graded
// stock is what these orders reserve).
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
  return { raw: call, get: (p) => ok('GET', p), post: (p, b = {}) => ok('POST', p, b), patch: (p, b) => ok('PATCH', p, b) };
}
const dNo = (n) => `D-${String(n).padStart(5, '0')}`;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

(async () => {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const browser = await launchBrowser();
  try {
    const owner = client(await login('owner@dev.morbeez.local'));
    const customers = (await owner.get('/customers?pageSize=100')).items;
    const products = (await owner.get('/products?pageSize=100')).items;
    const vehicles = (await owner.get('/vehicles?pageSize=100')).items;
    const workers = (await owner.get('/workforce?pageSize=100')).items;
    let sagar = customers.find((c) => c.name === 'Hotel Sagar');
    const tomato = products.find((p) => p.name === 'Tomato');
    const onion = products.find((p) => p.name === 'Onion');
    const truck = vehicles.find((v) => v.registrationNumber === 'MH12AB4521');
    const suresh = workers.find((w) => w.name === 'Suresh Kale');
    const tz = (await db.query('SELECT timezone FROM tenant.tenant WHERE id = (SELECT tenant_id FROM trading_partners.customer WHERE id = $1)', [sagar.id])).rows[0].timezone;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    const tomorrow = addDays(today, 1);

    // ---- Routes ----
    const route = await owner.post('/routes', { name: 'Mysuru North' });
    check('a route is added', route.name === 'Mysuru North' && route.status === 'active');
    check('…and listed', (await owner.get('/routes')).some((r) => r.id === route.id));
    const dup = await owner.raw('POST', '/routes', { name: '  mysuru   NORTH ' });
    check('the same name twice is refused, whatever the spacing or case', dup.status === 409, dup.body?.error?.message);
    check('a route needs a name', (await owner.raw('POST', '/routes', { name: 'X' })).status === 400);

    // ---- The customer's place, address and usual route ----
    sagar = await owner.patch(`/customers/${sagar.id}`, { version: sagar.version, place: 'Mysuru', address: 'Near Mysuru Bus Stand', routeId: route.id });
    check("a customer's place, address and route are saved", sagar.place === 'Mysuru' && sagar.address === 'Near Mysuru Bus Stand' && sagar.routeId === route.id);
    const kept = await owner.patch(`/customers/${sagar.id}`, { version: sagar.version, name: 'Hotel Sagar' });
    check('…and kept when an edit leaves them out', kept.place === 'Mysuru' && kept.routeId === route.id);
    sagar = await owner.post(`/customers/${sagar.id}/credit-terms`, { version: kept.version, paymentTermsDays: 15, creditLimit: 500000 });

    // ---- An order with the plan; saving confirms it ----
    const before = await owner.get('/orders/board?day=today');
    const order = await owner.post('/orders', {
      customerId: sagar.id,
      deliveryDate: today,
      deliveryTime: '09:00',
      driverEmployeeId: suresh.id,
      vehicleId: truck.id,
      creditTermDays: 7,
      notes: 'Back gate',
      confirm: true,
      lines: [
        { productId: tomato.id, quantity: 40, unitPrice: 32 },
        { productId: onion.id, quantity: 10, unitPrice: 28 },
      ],
    });
    check('saving confirms it when the stock is in and credit allows', order.status === 'confirmed' && !order.confirmProblem, `${order.status} ${order.confirmProblem ?? ''}`);
    check('it gets a number', Number.isInteger(order.number) && order.number > 0, dNo(order.number));
    check('the plan and notes are kept', order.deliveryDate === today && order.deliveryTime === '09:00' && order.plannedDriverId === suresh.id && order.plannedVehicleId === truck.id && order.creditTermDays === 7 && order.notes === 'Back gate', JSON.stringify(order).slice(0, 300));
    check("the customer's address and route are used when none are given", order.deliveryAddress === 'Near Mysuru Bus Stand' && order.routeId === route.id);

    const second = await owner.post('/orders', { customerId: sagar.id, deliveryDate: tomorrow, deliveryAddress: 'Shop 4, APMC yard', lines: [{ productId: onion.id, quantity: 5, unitPrice: 28 }] });
    check('numbers run in order', second.number === order.number + 1, `${order.number} → ${second.number}`);
    check('without confirm it waits to be confirmed, as before', second.status === 'placed');
    check('an address given on the order wins', second.deliveryAddress === 'Shop 4, APMC yard');

    const short = await owner.post('/orders', { customerId: sagar.id, deliveryDate: today, confirm: true, lines: [{ productId: tomato.id, quantity: 5000, unitPrice: 30 }] });
    // Stock by the kilo (driver app D0): what isn't in the store comes from the day's procurement.
    check('more than the stock: still confirmed — the rest is to come', short.status === 'confirmed' && !short.confirmProblem, `${short.status} ${short.confirmProblem ?? ''}`);
    await owner.post(`/orders/${short.id}/cancel`, { version: short.version });

    // ---- Refusals ----
    const line = [{ productId: tomato.id, quantity: 1, unitPrice: 30 }];
    check('a delivery time needs a date', (await owner.raw('POST', '/orders', { customerId: sagar.id, deliveryTime: '09:00', lines: line })).status === 400);
    check('a wrong time is refused', (await owner.raw('POST', '/orders', { customerId: sagar.id, deliveryDate: today, deliveryTime: '24:10', lines: line })).status === 400);
    check('a credit term over 180 days is refused', (await owner.raw('POST', '/orders', { customerId: sagar.id, creditTermDays: 200, lines: line })).status === 400);
    check('an unknown route is refused', (await owner.raw('POST', '/orders', { customerId: sagar.id, routeId: '00000000-0000-4000-8000-000000000000', lines: line })).status === 400);

    // ---- The board ----
    const board = await owner.get('/orders/board?day=today');
    const card = board.items.find((c) => c.id === order.id);
    check("today's list has the order", !!card && board.counts.today === before.counts.today + 1, `${before.counts.today} → ${board.counts.today}`);
    check('the card shows number, customer, place, route, time, driver, vehicle', card.number === order.number && card.customerName === 'Hotel Sagar' && card.customerPlace === 'Mysuru' && card.routeName === 'Mysuru North' && card.deliveryTime === '09:00' && card.driverName === 'Suresh Kale' && card.vehicle === 'MH12AB4521', JSON.stringify(card));
    check('…its products, biggest first', card.products[0]?.name === 'Tomato' && card.products.length === 2, JSON.stringify(card.products));
    check('…and, not on a trip yet, it is Pending', card.stage === 'pending', card.stage);
    const tmr = await owner.get('/orders/board?day=tomorrow');
    check("tomorrow's order is on Tomorrow, not Today", tmr.items.some((c) => c.id === second.id) && !board.items.some((c) => c.id === second.id));
    check('a cancelled order is not on Today', !board.items.some((c) => c.id === short.id));
    for (const [q, label] of [['mysuru n', 'route'], ['mysu', 'place'], ['sagar', 'customer'], ['onio', 'product'], [dNo(order.number), 'D-number']]) {
      const found = await owner.get(`/orders/board?day=all&q=${encodeURIComponent(q)}`);
      check(`search finds it by ${label}`, found.items.some((c) => c.id === order.id), `${q}: ${found.items.length}`);
    }
    check('a search with no match returns nothing', (await owner.get('/orders/board?day=all&q=zzzz')).counts.all === 0);

    // ---- Statuses follow the trip ----
    const trip = await owner.post('/logistics/trips', { vehicleId: truck.id, driverEmployeeId: suresh.id, plannedDate: today });
    const stop = await owner.post(`/logistics/trips/${trip.id}/stops/delivery`, { orderId: order.id });
    const stageOf = async () => (await owner.get('/orders/board?day=today')).items.find((c) => c.id === order.id).stage;
    check('on a planned trip → Scheduled', (await stageOf()) === 'scheduled');
    const planned = await owner.get(`/logistics/trips/${trip.id}`);
    await owner.post(`/logistics/trips/${trip.id}/start`, { version: planned.version });
    check('trip started → In Transit', (await stageOf()) === 'in_transit');
    await owner.post(`/logistics/trips/${trip.id}/stops/${stop.id}/complete-delivery`, { recipientName: 'Manager', signatureData: 'data:image/png;base64,iVBORw0KGgo=' });
    check('delivered → Completed', (await stageOf()) === 'completed');
    const invoice = (await db.query('SELECT due_date::text AS due FROM money.invoice WHERE order_id = $1', [order.id])).rows[0];
    check("the invoice falls due on the order's own credit term (7 days, not the customer's 15)", invoice?.due === addDays(today, 7), invoice?.due);

    // ---- Another business sees none of it ----
    const otherPhone = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
    const signup = await fetch(`${API}/tenants`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ businessName: 'Other Wholesale', ownerPhone: otherPhone, ownerPassword: 'another-password-1' }) });
    const other = client((await signup.json()).accessToken);
    check("another business's list and routes are empty", (await other.get('/orders/board?day=all')).counts.all === 0 && (await other.get('/routes')).length === 0);
    const theirCustomer = await other.post('/customers', { name: 'Their Hotel', creditLimit: 100000 });
    const borrowed = await other.raw('PATCH', `/customers/${theirCustomer.id}`, { version: theirCustomer.version, routeId: route.id });
    check("another business can't put a customer on this business's route", borrowed.status === 400, borrowed.status);
    const theirProduct = await other.post('/products', { name: 'Beans', baseUom: 'kg', kind: 'standard' });
    const theirOrder = await other.post('/orders', { customerId: theirCustomer.id, lines: [{ productId: theirProduct.id, quantity: 5, unitPrice: 10 }] });
    check("each business's order numbers start at 1", theirOrder.number === 1, theirOrder.number);

    // A lot is reserved whole for an order line, and the one above went out
    // with the first order: grade a fresh tomato lot for the form's order.
    const farmer = (await owner.get('/farmers?pageSize=100')).items.find((f) => f.name === 'Ramesh Patil');
    let po = await owner.post('/procurement/purchase-orders', { farmerId: farmer.id, lines: [{ productId: tomato.id, expectedQuantity: 30, indicativePrice: 20 }] });
    po = await owner.post(`/procurement/purchase-orders/${po.id}/confirm`, { version: po.version });
    await owner.post(`/procurement/purchase-orders/${po.id}/receive-goods`, { lines: [{ productId: tomato.id, receivedQuantity: 30 }] });
    for (const lot of await owner.get(`/procurement/purchase-orders/${po.id}/lots`)) {
      await owner.post(`/procurement/lots/${lot.id}/grade`, { version: lot.version, acceptedQuantity: 30, rejectedQuantity: 0, unitCost: 20 });
    }

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
    await page.goto(`${BASE}/orders`);
    await page.waitForSelector('.list-card', { timeout: 20000 });
    const tabs = await page.locator('.day-tabs button').allInnerTexts();
    check('tabs show Today / Tomorrow / All with counts', /^Today \(\d+\)$/.test(tabs[0]) && /^Tomorrow \(\d+\)$/.test(tabs[1]) && /^All \(\d+\)$/.test(tabs[2]), tabs.join(' | '));
    const shown = (await page.locator('.list-card', { hasText: dNo(order.number) }).textContent()).replace(/\s+/g, ' ');
    check('the card reads like the design', /Hotel Sagar/.test(shown) && /Mysuru/.test(shown) && /Tomato 40 kg · \+1/.test(shown) && /09:00 AM/.test(shown) && /Suresh Kale/.test(shown) && /MH12AB4521/.test(shown) && /Completed/.test(shown), shown);
    await page.locator('.filter-select select').selectOption('completed');
    await page.waitForTimeout(300);
    const statuses = await page.locator('.list-card-status').allInnerTexts();
    check('the status filter keeps only that status', statuses.length > 0 && statuses.every((s) => s === 'Completed'), statuses.join(', '));
    await page.locator('.filter-select select').selectOption('all');

    await page.getByRole('button', { name: 'Create Delivery Order' }).click();
    const dialog = () => page.locator('dialog[open]').last();
    await dialog().getByLabel('Customer', { exact: true }).click();
    await dialog().locator('.picker-search').fill('Sagar');
    await dialog().getByRole('option', { name: /Hotel Sagar/ }).click();
    check('the chosen customer shows as a card with View', /Mysuru/.test(await dialog().locator('.farmer-card').textContent()));
    check("their usual route is filled in", /Mysuru North/.test(await dialog().getByLabel('Route', { exact: true }).textContent()));
    const address = dialog().getByLabel('Delivery Address');
    check('…and their address', (await address.inputValue()) === 'Near Mysuru Bus Stand');
    await address.fill('Somewhere else');
    await dialog().getByRole('button', { name: 'Use Default' }).click();
    check('"Use Default" puts their address back', (await address.inputValue()) === 'Near Mysuru Bus Stand');
    const terms = await dialog().getByLabel('Credit Term').locator('option').allInnerTexts();
    check("the credit term starts at the customer's usual terms", /Usual \(15 days\)/.test(terms[0]), terms.join(' | '));
    await dialog().getByLabel('Credit Term').selectOption({ label: '7 days' });
    // A new route from inside the form.
    await dialog().getByLabel('Route', { exact: true }).click();
    await dialog().locator('.picker-search').fill('Hunsur Road');
    await dialog().getByRole('button', { name: /Create new route/ }).click();
    await page.locator('dialog[open]').last().getByRole('button', { name: 'Add route' }).click();
    await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 1);
    check('a new route is added and chosen', /Hunsur Road/.test(await dialog().getByLabel('Route', { exact: true }).textContent()));
    await dialog().getByLabel('Delivery time (optional)').fill('11:30');
    await dialog().getByLabel('Driver', { exact: true }).selectOption({ label: 'Suresh Kale' });
    await dialog().getByLabel('Vehicle', { exact: true }).selectOption({ label: 'MH12AB4521' });
    await dialog().getByLabel('Line 1 product', { exact: true }).click();
    await dialog().locator('.picker-search').fill('Toma');
    await dialog().getByRole('option', { name: 'Tomato', exact: true }).click();
    await dialog().getByLabel(/Line 1 quantity/).fill('5');
    await dialog().getByLabel(/Line 1 rate/).fill('33');
    await dialog().getByLabel('Notes (optional)').fill('Call on arrival');
    await dialog().getByRole('button', { name: 'Save Order' }).click();
    const closed = await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 0, null, { timeout: 15000 }).then(() => true, () => false);
    if (!closed) throw new Error(`Save Order: ${await dialog().locator('.form-error').textContent().catch(() => 'dialog did not close')}`);
    const confirmed = await page.waitForFunction(() => /Confirmed/.test(document.querySelector('.detail')?.textContent ?? ''), null, { timeout: 15000 }).then(() => true, () => false);
    if (!confirmed) throw new Error(`not confirmed: ${(await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 400)}`);
    const detailText = (await page.locator('.detail').textContent()).replace(/\s+/g, ' ');
    check('the saved order opens confirmed, with its number, route, address and term', /D-\d{5}/.test(detailText) && /Hunsur Road/.test(detailText) && /Near Mysuru Bus Stand/.test(detailText) && /7 days/.test(detailText) && /Call on arrival/.test(detailText), detailText.slice(0, 400));
    const newCard = (await page.locator('.list-card', { hasText: '11:30 AM' }).first().textContent()).replace(/\s+/g, ' ');
    check("…and appears on today's list as Pending", /Tomato 5 kg/.test(newCard) && /Pending/.test(newCard), newCard);

    // The trip planner offers it first, as planned for a trip on its day with its driver.
    await page.goto(`${BASE}/logistics`);
    const lateTrip = await owner.post('/logistics/trips', { vehicleId: truck.id, driverEmployeeId: suresh.id, plannedDate: today });
    await page.reload();
    await page.waitForSelector('.list-card');
    await page.locator('.list-card', { hasText: lateTrip.number }).click();
    await page.waitForFunction(() => /Planned/.test(document.querySelector('.detail')?.textContent ?? ''));
    await page.locator('.detail').getByRole('button', { name: 'Add delivery' }).click();
    const group = await dialog().locator('optgroup').first().getAttribute('label').catch(() => null);
    const firstOption = (await dialog().getByLabel('Order').locator('option').nth(1).textContent()) ?? '';
    check('the trip planner lists orders planned for that day and driver first, by number', group === 'Planned for this trip' && /D-\d{5} · Hotel Sagar/.test(firstOption), `${group} | ${firstOption}`);
    await page.keyboard.press('Escape');
    await owner.post(`/logistics/trips/${lateTrip.id}/cancel`, { version: lateTrip.version });
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
