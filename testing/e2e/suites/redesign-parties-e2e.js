// Owner app redesign, Phase 5 — Customers and Farmers (docs/redesign):
// the Customers list with sales, score and status, filters (active, credit
// risk, overdue, route) and search; the Customer Profile's figures (sales,
// outstanding, score, average payment days, on-time %, margin, orders,
// statement); the Farmers list and profile (main product, purchases,
// balance, payments, by location); Call / WhatsApp / Navigate; "New Order"
// and "New Procurement" opening with them chosen. Runs after the trips
// suite on the seeded business; builds its own customers and farmer.
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
const rupees = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

(async () => {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const browser = await launchBrowser();
  try {
    const owner = client(await login('owner@dev.morbeez.local'));
    const products = (await owner.get('/products?pageSize=100')).items;
    const vehicles = (await owner.get('/vehicles?pageSize=100')).items;
    const workers = (await owner.get('/workforce?pageSize=100')).items;
    const tomato = products.find((p) => p.name === 'Tomato');
    const onion = products.find((p) => p.name === 'Onion');
    const truck = vehicles.find((v) => v.registrationNumber === 'MH12AB4521');
    const suresh = workers.find((w) => w.name === 'Suresh Kale');

    // ---- Two customers with a payment history ----
    const route = await owner.post('/routes', { name: 'Mysuru Ring Road' });
    const kaveri = await owner.post('/customers', {
      name: 'Kaveri Hotel', place: 'Mysuru', address: 'Near Mysuru Palace', routeId: route.id,
      contact: { phone: '98450 12345', notes: 'Good customer, regular orders.' }, creditLimit: 100000, paymentTermsDays: 7,
    });
    const shanti = await owner.post('/customers', { name: 'Shanti Stores', place: 'Hunsur', creditLimit: 1000, paymentTermsDays: 7 });
    const farmer = await owner.post('/farmers', { name: 'Ganesh Farm', place: 'Hunsur', contact: { phone: '9900112233' } });

    // A graded lot of [qty] at ₹20/kg from Ganesh Farm — one per order (lots are reserved whole).
    async function gradedLot(product, qty) {
      let po = await owner.post('/procurement/purchase-orders', { farmerId: farmer.id, lines: [{ productId: product.id, expectedQuantity: qty, indicativePrice: 20 }] });
      po = await owner.post(`/procurement/purchase-orders/${po.id}/confirm`, { version: po.version });
      await owner.post(`/procurement/purchase-orders/${po.id}/receive-goods`, { lines: [{ productId: product.id, receivedQuantity: qty }] });
      for (const lot of await owner.get(`/procurement/purchase-orders/${po.id}/lots`)) {
        await owner.post(`/procurement/lots/${lot.id}/grade`, { version: lot.version, acceptedQuantity: qty, rejectedQuantity: 0, unitCost: 20 });
      }
    }
    // An order delivered on a trip: its invoice is issued at delivery.
    async function deliver(customer, product, qty, price) {
      await gradedLot(product, qty);
      const order = await owner.post('/orders', { customerId: customer.id, confirm: true, lines: [{ productId: product.id, quantity: qty, unitPrice: price }] });
      let trip = await owner.post('/logistics/trips', { vehicleId: truck.id, driverEmployeeId: suresh.id, orderIds: [order.id] });
      trip = await owner.post(`/logistics/trips/${trip.id}/start`, { version: trip.version });
      const [stop] = await owner.get(`/logistics/trips/${trip.id}/stops`);
      await owner.post(`/logistics/trips/${trip.id}/stops/${stop.id}/complete-delivery`, { recipientName: 'Manager', signatureData: 'data:image/png;base64,iVBORw0KGgo=' });
      return (await db.query("SELECT id, amount::text AS amount FROM money.invoice WHERE order_id = $1 AND kind = 'sale'", [order.id])).rows[0];
    }
    const first = await deliver(kaveri, tomato, 30, 30); // ₹900
    await owner.post('/finance/customer-payments', { customerId: kaveri.id, amount: Number(first.amount), method: 'upi', reference: 'UPI-KAVERI-1' });
    const second = await deliver(kaveri, onion, 20, 30); // ₹600, made 20 days overdue below
    await db.query(
      `UPDATE money.invoice SET issued_at = now() - interval '27 days',
              due_date = ((now() AT TIME ZONE (SELECT timezone FROM tenant.tenant WHERE id = tenant_id))::date - 20)
        WHERE id = $1`,
      [second.id],
    );
    await deliver(shanti, tomato, 30, 31); // ₹930 of a ₹1,000 limit

    // ---- The Customers list ----
    const board = await owner.get('/customers/board');
    const card = (b, id) => b.items.find((c) => c.id === id);
    const k = card(board, kaveri.id);
    check('a customer card has sales, what they owe, and the overdue part', k.totalSales === '1500.00' && k.outstanding === '600.00' && k.overdue === '600.00' && k.oldestOverdueDays === 20, JSON.stringify(k));
    check('…their score: all paid on time, less 2 points for 20 days overdue → 3.0', k.score === 3, k.score);
    check('…their route and place', k.routeName === 'Mysuru Ring Road' && k.place === 'Mysuru');
    const s = card(board, shanti.id);
    check('93% of a credit limit in use is a credit risk', s.creditRisk === true && k.creditRisk === false && s.score === null, `${s.creditRisk} ${k.creditRisk} ${s.score}`);
    const overdue = await owner.get('/customers/board?filter=overdue');
    check('Overdue lists who is overdue, most overdue first', overdue.items.some((c) => c.id === kaveri.id) && !overdue.items.some((c) => c.id === shanti.id) && overdue.counts.overdue === board.counts.overdue);
    const credit = await owner.get('/customers/board?filter=credit');
    check('Credit risk lists Shanti Stores', credit.items.some((c) => c.id === shanti.id) && !credit.items.some((c) => c.id === kaveri.id));
    const byRoute = await owner.get(`/customers/board?routeId=${route.id}`);
    check('by route', byRoute.items.length === 1 && byRoute.items[0].id === kaveri.id);
    for (const [q, label] of [['kaveri', 'name'], ['12345', 'mobile'], ['ring road', 'route']]) {
      const found = await owner.get(`/customers/board?q=${encodeURIComponent(q)}`);
      check(`search finds them by ${label}`, found.items.some((c) => c.id === kaveri.id), `${q}: ${found.items.length}`);
    }
    const driver = client(await login('driver@dev.morbeez.local'));
    check("a driver can't open the customers list", (await driver.raw('GET', '/customers/board')).status === 403);

    // ---- Customer Profile ----
    const profile = await owner.get(`/customers/${kaveri.id}/profile`);
    const m = profile.money;
    check('the profile has sales, outstanding, overdue and the credit available', m.totalSales === '1500.00' && m.outstanding === '600.00' && m.overdue === '600.00' && m.available === '99400.00', JSON.stringify(m).slice(0, 300));
    check('how they pay: 1 invoice settled, paid the day it was issued, 100% on time', m.settledInvoices === 1 && m.avgPaymentDays === 0 && m.onTimePct === 100 && m.score === 3, `${m.settledInvoices} ${m.avgPaymentDays} ${m.onTimePct} ${m.score}`);
    check('their margin: ₹1,500 of sales on ₹1,000 of stock → ₹500, 33.3%', m.revenue === '1500.00' && m.costOfGoods === '1000.00' && m.grossMargin === '500.00' && m.grossMarginPct === 33.3, `${m.revenue} ${m.costOfGoods} ${m.grossMarginPct}`);
    check('…and what they buy most', m.topProducts[0]?.name === 'Tomato' && m.topProducts.length === 2);
    check('their orders: count, average value, the latest first', profile.orders.count === 2 && profile.orders.avgOrderValue === '750.00' && profile.orders.recent.length === 2);
    check('…their route', profile.routeName === 'Mysuru Ring Road');

    // ---- The Farmers list and profile ----
    const partPaid = await owner.post('/finance/farmer-payments', { farmerId: farmer.id, amount: 1000, method: 'cash' });
    void partPaid;
    const fboard = await owner.get('/farmers/board');
    const g = fboard.items.find((f) => f.id === farmer.id);
    // Lots bought: 30 + 20 + 30 kg at ₹20 = ₹1,600; ₹1,000 paid.
    check('a farmer card: what was bought, what is still owed, what they sell most', g.totalPurchases === '1600.00' && g.owed === '600.00' && g.mainProduct === 'Tomato' && g.place === 'Hunsur', JSON.stringify(g));
    const pending = await owner.get('/farmers/board?filter=pending');
    check('Pending Payment lists them', pending.items.some((f) => f.id === farmer.id) && pending.counts.pending === fboard.counts.pending);
    const hunsur = await owner.get('/farmers/board?place=hunsur');
    check('By Location: farmers from Hunsur', hunsur.items.every((f) => (f.place ?? '').toLowerCase() === 'hunsur') && hunsur.items.some((f) => f.id === farmer.id) && fboard.places.some((p) => p.place === 'Hunsur'));
    check('search by product', (await owner.get('/farmers/board?q=tomato')).items.some((f) => f.id === farmer.id));
    const fprofile = await owner.get(`/farmers/${farmer.id}/profile`);
    check('the farmer profile: purchases, products with average rate, payments', fprofile.purchases.count === 3 && fprofile.purchases.products.find((p) => p.name === 'Tomato')?.avgRate === '20.00' && fprofile.money.paid === '1000.00' && fprofile.money.owed === '600.00' && fprofile.money.payments.length === 1, JSON.stringify(fprofile.money).slice(0, 200));

    // ---- Another business sees none of it ----
    const otherPhone = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
    const signup = await fetch(`${API}/tenants`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ businessName: 'Other Grocers', ownerPhone: otherPhone, ownerPassword: 'another-password-1' }) });
    const them = client((await signup.json()).accessToken);
    check("another business's lists are empty", (await them.get('/customers/board')).counts.all === 0 && (await them.get('/farmers/board')).counts.all === 0);
    check("…and this business's customer and farmer aren't found there", (await them.raw('GET', `/customers/${kaveri.id}/profile`)).status === 404 && (await them.raw('GET', `/farmers/${farmer.id}/profile`)).status === 404);

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
    await page.goto(`${BASE}/customers`);
    await page.waitForSelector('.party-card', { timeout: 20000 });
    const tabs = await page.locator('.day-tabs button').allInnerTexts();
    check('tabs: All / Active / Credit risk / Overdue with counts', /^All \(\d+\)$/.test(tabs[0]) && /^Active \(\d+\)$/.test(tabs[1]) && /^Credit risk \(\d+\)$/.test(tabs[2]) && /^Overdue \(\d+\)$/.test(tabs[3]), tabs.join(' | '));
    const shown = (await page.locator('.party-card', { hasText: 'Kaveri Hotel' }).textContent()).replace(/\s+/g, ' ');
    check('the card reads like the design: place, route, rating, sales, overdue', /Mysuru · Mysuru Ring Road/.test(shown) && /★ 3\.0/.test(shown) && shown.includes(rupees(1500)) && /overdue/.test(shown) && /Overdue/.test(shown), shown);
    await page.locator('.filter-select select').selectOption({ label: 'Mysuru Ring Road' });
    await page.waitForFunction(() => document.querySelectorAll('.party-card').length === 1);
    check('the route filter narrows the list', (await page.locator('.party-name').allInnerTexts()).join() === 'Kaveri Hotel');
    await page.locator('.party-card').click();
    await page.waitForFunction(() => /Total Sales/.test(document.querySelector('.detail')?.textContent ?? ''));
    const overview = (await page.locator('.detail').textContent()).replace(/\s+/g, ' ');
    check('the profile: sales, outstanding, score, payment days, address, route, notes', overview.includes(`Total Sales${rupees(1500)}`) && overview.includes(`Outstanding${rupees(600)}`) && /★ 3\.0 \/ 5/.test(overview) && /0 days/.test(overview) && /Near Mysuru Palace/.test(overview) && /Good customer, regular orders\./.test(overview), overview.slice(0, 400));
    const callHref = await page.locator('.contact-action', { hasText: 'Call' }).getAttribute('href');
    const waHref = await page.locator('.contact-action', { hasText: 'WhatsApp' }).getAttribute('href');
    const navHref = await page.locator('.contact-action', { hasText: 'Navigate' }).getAttribute('href');
    check('Call, WhatsApp and Navigate', callHref === 'tel:+919845012345' && waHref === 'https://wa.me/919845012345' && /google\.com\/maps/.test(navHref ?? '') && /Mysuru%20Palace/.test(navHref ?? ''), `${callHref} ${waHref} ${navHref}`);
    await page.locator('.detail').getByRole('button', { name: 'Orders', exact: true }).click();
    const ordersText = (await page.locator('.detail').textContent()).replace(/\s+/g, ' ');
    check('Orders tab: the count, average and their D-numbers', /Orders\s*2/.test(ordersText) && (ordersText.match(/D-\d{5}/g) ?? []).length === 2, ordersText.slice(0, 300));
    await page.locator('.detail').getByRole('button', { name: 'Payments', exact: true }).click();
    await page.waitForFunction(() => /UPI-KAVERI-1|Owed now/.test(document.querySelector('.detail')?.textContent ?? ''));
    const paymentsText = (await page.locator('.detail').textContent()).replace(/\s+/g, ' ');
    check('Payments tab: invoices and the payment, with what they owe now', paymentsText.includes(`Owed now${rupees(600)}`) && paymentsText.includes(rupees(900)), paymentsText.slice(0, 400));
    await page.locator('.detail').getByRole('button', { name: 'Profit', exact: true }).click();
    const profitText = (await page.locator('.detail').textContent()).replace(/\s+/g, ' ');
    check('Profit tab: margin and what they buy', /33\.3%/.test(profitText) && /Tomato/.test(profitText), profitText.slice(0, 300));
    await page.locator('.detail').getByRole('button', { name: 'Overview', exact: true }).click();
    await page.locator('.detail').getByRole('link', { name: 'New Order' }).click();
    await page.waitForURL(/\/orders/);
    await page.waitForSelector('dialog[open] .farmer-card', { timeout: 15000 });
    const prefilled = (await page.locator('dialog[open] .farmer-card').textContent()) ?? '';
    const prefillRoute = (await page.locator('dialog[open]').getByLabel('Route', { exact: true }).textContent()) ?? '';
    check('"New Order" opens the order form with them, their route and address', /Kaveri Hotel/.test(prefilled) && /Mysuru Ring Road/.test(prefillRoute) && (await page.locator('dialog[open]').getByLabel('Delivery Address').inputValue()) === 'Near Mysuru Palace', `${prefilled} | ${prefillRoute}`);
    await page.keyboard.press('Escape');

    await page.goto(`${BASE}/farmers`);
    await page.waitForSelector('.party-card', { timeout: 20000 });
    const fcard = (await page.locator('.party-card', { hasText: 'Ganesh Farm' }).textContent()).replace(/\s+/g, ' ');
    check('the farmer card: place, main product, purchases, balance', /Hunsur · Tomato/.test(fcard) && fcard.includes(rupees(1600)) && fcard.includes(`Balance: ${rupees(600)}`), fcard);
    await page.locator('.day-tabs button', { hasText: 'Pending Payment' }).click();
    await page.waitForFunction(() => /Pending Payment/.test(document.querySelector('.day-tabs [aria-pressed="true"]')?.textContent ?? ''));
    check('Pending Payment keeps farmers owed money', (await page.locator('.party-name').allInnerTexts()).includes('Ganesh Farm'));
    await page.locator('.party-card', { hasText: 'Ganesh Farm' }).click();
    await page.waitForFunction(() => /Total Purchases/.test(document.querySelector('.detail')?.textContent ?? ''));
    const ftext = (await page.locator('.detail').textContent()).replace(/\s+/g, ' ');
    check('the farmer profile: purchases, balance, paid', ftext.includes(`Total Purchases${rupees(1600)}`) && ftext.includes(`Balance${rupees(600)}`) && ftext.includes(`Paid to date${rupees(1000)}`), ftext.slice(0, 300));
    await page.locator('.detail').getByRole('button', { name: 'Purchases', exact: true }).click();
    const ptext = (await page.locator('.detail').textContent()).replace(/\s+/g, ' ');
    check('Purchases tab: products with average rate, and the P-numbers', /Tomato/.test(ptext) && /₹20(\.00)? \/ kg/.test(ptext) && (ptext.match(/P-\d{5}/g) ?? []).length === 3, ptext.slice(0, 300));
    await page.locator('.detail').getByRole('button', { name: 'Overview', exact: true }).click();
    await page.locator('.detail').getByRole('link', { name: 'New Procurement' }).click();
    await page.waitForURL(/\/procurement/);
    await page.waitForSelector('dialog[open] .farmer-card', { timeout: 15000 });
    check('"New Procurement" opens the form with the farmer chosen', /Ganesh Farm/.test((await page.locator('dialog[open] .farmer-card').textContent()) ?? ''));
    await page.keyboard.press('Escape');
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
