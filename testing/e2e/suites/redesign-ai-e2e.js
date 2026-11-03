// Owner app redesign, Phase 8 — AI and sync screens (docs/redesign/owner-app-redesign-plan.md;
// first mockup set, screens 16, 23, 24). AI Orders: a customer who orders on
// tomorrow's weekday and hasn't yet — their usual order, placed by the owner
// on the ordinary order form — and an order far from what its customer
// usually takes, to confirm (requirements Part 14, 23). AI Pricing: each
// product's price against cost, spoilage and delivery (Part 15). AI Calling:
// today's calls, for the owner until AI voice arrives. Driver phones: each
// phone's offline queue as it last reported — waiting, stuck and why.
// Fixture: four weeks of two customers' orders inserted directly (the other
// suites only ever trade "today"). Runs last in the redesign chain.
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
  return { raw: call, get: (p) => ok('GET', p), post: (p, b = {}) => ok('POST', p, b) };
}
const addDays = (d, n) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const weekday = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' });
const cents = (v) => Math.round(Number(v) * 100);

(async () => {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  try {
    const owner = client(await login('owner@dev.morbeez.local'));
    const driver = client(await login('driver@dev.morbeez.local'));
    const today = (await owner.get('/accounting/periods')).today;
    const tomorrow = addDays(today, 1);
    const day = weekday(tomorrow);
    const products = (await owner.get('/products?pageSize=100')).items;
    const tomato = products.find((p) => p.name === 'Tomato');
    const onion = products.find((p) => p.name === 'Onion');

    // ---- Fixture: two customers' last four weeks on tomorrow's weekday ----
    const green = await owner.post('/customers', { name: 'P8 Green Grocers', contact: { phone: '+919800000081' }, place: 'Mysuru', creditLimit: 100000, paymentTermsDays: 7 });
    const royal = await owner.post('/customers', { name: 'P8 Royal Caterers', contact: { phone: '+919800000082' }, place: 'Mysuru', creditLimit: 100000, paymentTermsDays: 7 });
    const ownerUser = (await db.query(`SELECT id, tenant_id FROM identity.app_user WHERE email = 'owner@dev.morbeez.local'`)).rows[0];
    let number = (await db.query('SELECT COALESCE(MAX(number), 0)::int AS n FROM commerce.customer_order')).rows[0].n + 1000;
    const pastOrder = async (customerId, on, lines) => {
      const id = randomUUID();
      await db.query(
        `INSERT INTO commerce.customer_order (id, tenant_id, customer_id, status, created_by, number, delivery_date, created_at, updated_at)
         VALUES ($1, $2, $3, 'delivered', $4, $5, $6::date, ($6::date - 1 + time '10:00') AT TIME ZONE 'Asia/Kolkata', now())`,
        [id, ownerUser.tenant_id, customerId, ownerUser.id, number++, on],
      );
      for (const [product, quantity, price] of lines) {
        await db.query('INSERT INTO commerce.customer_order_line (order_id, product_id, quantity, unit_price, delivered_quantity) VALUES ($1, $2, $3, $4, $3)', [id, product.id, quantity, price]);
      }
    };
    const weeks = [7, 14, 21, 28].map((n) => addDays(tomorrow, -n));
    const greenWeeks = [[40, 20], [42, 20], [38, 18], [40, 22]];
    for (const [i, on] of weeks.entries()) {
      await pastOrder(green.id, on, [[tomato, greenWeeks[i][0], 30], [onion, greenWeeks[i][1], 25]]);
      await pastOrder(royal.id, on, [[tomato, [200, 180, 220, 210][i], 28]]);
    }
    // Royal Caterers has ordered for tomorrow already — a third of their usual.
    const short = await owner.post('/orders', { customerId: royal.id, deliveryDate: tomorrow, creditTermDays: 7, lines: [{ productId: tomato.id, quantity: 60, unitPrice: 28 }] });

    // ---- AI Orders ----
    const run = await owner.post('/ai/runs');
    check('the AI works out order suggestions with the rest — two here', run.produced.order === 2, JSON.stringify({ produced: run.produced.order, suppressed: run.suppressed.order }));
    const open = (await owner.get('/ai/recommendations?type=order&pageSize=100')).items;
    const expected = open.find((r) => r.subjectId === green.id);
    const lines = expected?.proposal.lines ?? [];
    check(
      `P8 Green Grocers orders every ${day} and hasn't for tomorrow: their usual order, at the median of what they took`,
      expected?.proposal.action === 'delivery_order' && expected.proposal.deliveryDate === tomorrow &&
        lines.find((l) => l.productId === tomato.id)?.quantity === '40.000' && lines.find((l) => l.productId === onion.id)?.quantity === '20.000' &&
        expected.title.startsWith(`P8 Green Grocers usually orders on ${day}s`) && expected.confidence === 'solid',
      `${expected?.title} ${JSON.stringify(lines.map((l) => `${l.quantity}@${l.unitPrice}`))} ${expected?.confidence}`,
    );
    check(
      'priced as they were last charged; worth the order’s value; the four weeks are its evidence',
      lines.find((l) => l.productId === tomato.id)?.unitPrice === '30.00' && expected?.expectedImpact === '1700.00' && expected?.evidence.length === 5,
      `${expected?.expectedImpact} ${expected?.evidence.map((e) => `${e.fact}: ${e.value}`).join(' | ')}`,
    );
    const toCheck = open.find((r) => r.subjectId === royal.id);
    check(
      '“usually 180–220 kg, ordered only 60” — an order far from the customer’s pattern, to confirm (Part 14)',
      toCheck?.proposal.action === 'confirm_order' && toCheck.proposal.orderId === short.id && toCheck.proposal.flags[0].kind === 'low' &&
        /usually orders 180 kg–220 kg of Tomato on \w+s and has ordered only 60 kg/.test(toCheck.explanation) && /Confirm whether this is intentional/.test(toCheck.explanation),
      toCheck?.explanation,
    );
    check('Royal Caterers has ordered for tomorrow — not expected again', !open.some((r) => r.subjectId === royal.id && r.proposal.action === 'delivery_order'));
    const driverRead = await driver.raw('GET', '/ai/recommendations?type=order');
    check('a driver sees none of it', driverRead.status === 403, String(driverRead.status));

    // ---- AI Pricing ----
    const pricing = await owner.get('/ai/pricing');
    const tomatoRow = pricing.rows.find((r) => r.productId === tomato.id);
    const b = tomatoRow?.buildUp;
    const perKg = cents(pricing.deliveryWindow.cost) / Number(pricing.deliveryWindow.kg);
    check(
      'Tomato: sustainable = stock cost + spoilage + delivery a kilo; target adds the margin',
      !!b && cents(b.sustainable) === cents(tomatoRow.unitCost) + cents(b.spoilage) + cents(b.delivery) &&
        Math.abs(cents(b.target) - cents(b.sustainable) * (1 + Number(pricing.targetMarginPct) / 100)) <= 1 &&
        Math.abs(cents(pricing.deliveryPerKg) - perKg) <= 1 && cents(b.delivery) === cents(pricing.deliveryPerKg),
      JSON.stringify({ cost: tomatoRow?.unitCost, ...b, perKg: pricing.deliveryPerKg, window: pricing.deliveryWindow }),
    );
    const rank = ['below_cost', 'no_price', 'below_sustainable', 'below_target', 'on_target', 'no_cost'];
    const ranks = pricing.rows.map((r) => rank.indexOf(r.standing));
    check(
      'every active product, the most urgent first, each where its price stands',
      pricing.rows.length === products.filter((p) => p.status === 'active').length && ranks.every((x, i) => x >= 0 && (i === 0 || x >= ranks[i - 1])),
      `${pricing.rows.length} ${pricing.rows.map((r) => `${r.name}:${r.standing}`).join(', ')}`,
    );
    check(
      "the standing follows today's price",
      pricing.rows.filter((r) => r.buildUp && r.currentPrice).every((r) =>
        r.standing === (cents(r.currentPrice) < cents(r.unitCost) ? 'below_cost' : cents(r.currentPrice) < cents(r.buildUp.sustainable) ? 'below_sustainable' : cents(r.currentPrice) < cents(r.buildUp.target) ? 'below_target' : 'on_target'),
      ),
    );

    // ---- AI Calling ----
    const calls = await owner.get('/ai/calls');
    const pending = (await owner.get('/finance/collections?view=pending&pageSize=100')).items;
    const payments = calls.calls.filter((c) => c.kind === 'payment');
    check(
      'payments to chase are what Collections says has fallen due',
      payments.length === Math.min(30, pending.length) && payments.every((c) => pending.some((p) => p.customerId === c.customerId && p.amount === c.amount)),
      `${payments.length} calls, ${pending.length} due`,
    );
    const askFor = calls.calls.find((c) => c.kind === 'order' && c.customerId === green.id);
    const confirm = calls.calls.find((c) => c.kind === 'quantity' && c.customerId === royal.id);
    check(
      'orders to ask for and quantities to confirm, each with the customer’s phone — AI calls not set up on this server',
      calls.voice === 'not_set_up' && askFor?.phone && askFor.recommendationId === expected.id && confirm?.recommendationId === toCheck.id,
      JSON.stringify({ askFor, confirm: confirm?.about }),
    );

    // ---- Driver phones ----
    const at = new Date().toISOString();
    const report = (over = {}) => ({
      deviceId: 'e2e-phone-raju', platform: 'android', appVersion: '0.1.0', pendingOperations: 3, failedOperations: 1, pendingPhotos: 1, failedPhotos: 0,
      oldestPendingAt: new Date(Date.now() - 40 * 60_000).toISOString(),
      failures: [{ type: 'START_TRIP', error: 'Opening KM 48600 is below the vehicle’s last reading 48620', at }],
      lastResult: 'partial', syncedAt: at, ...over,
    });
    await driver.post('/devices/sync-report', report());
    const tooMany = await driver.raw('POST', '/devices/sync-report', report({ failedOperations: 4 }));
    const flood = await driver.raw('POST', '/devices/sync-report', report({ failures: Array.from({ length: 21 }, () => report().failures[0]) }));
    check('refused actions are among those still on the phone; at most twenty sent', tooMany.status === 400 && flood.status === 400, `${tooMany.status} ${flood.status}`);
    const notOffice = await driver.raw('GET', '/devices/sync-status');
    check('a driver doesn’t see the phones', notOffice.status === 403, String(notOffice.status));
    let status = await owner.get('/devices/sync-status');
    let raju = status.drivers.find((d) => d.name === 'Raju Driver');
    check(
      "the owner sees Raju's phone stuck — what's on it, and the server's words",
      raju?.state === 'stuck' && raju.devices[0].pendingOperations === 3 && raju.devices[0].failures[0].error.startsWith('Opening KM 48600') && !!raju.phone,
      JSON.stringify(raju && { state: raju.state, phone: raju.phone, failures: raju.devices[0].failures }),
    );
    check('a driver whose phone never reported says so', status.drivers.some((d) => d.state === 'never' && d.devices.length === 0), status.drivers.map((d) => `${d.name}:${d.state}`).join(', '));

    // ---- The owner app ----
    const out = process.env.E2E_SCREENSHOTS;
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
      await page.goto(`${BASE}/login`);
      await page.fill('#login', 'owner@dev.morbeez.local');
      await page.fill('#password', PASSWORD);
      await page.click('button[type=submit]');
      await page.waitForURL((u) => !/\/login/.test(u.toString()));

      await page.goto(`${BASE}/sync`);
      await page.locator('.phone-card[data-state="stuck"]').waitFor();
      const stuckCard = (await page.locator('.phone-card[data-state="stuck"]').first().textContent()).replace(/\s+/g, ' ');
      check('Driver phones: Raju stuck first, the refused Start day in the server’s words', /Raju Driver/.test(stuckCard) && /Start day — Opening KM 48600/.test(stuckCard) && /Still on the phone: 3 actions, 1 photo/.test(stuckCard), stuckCard.slice(0, 300));
      if (out) await page.screenshot({ path: path.join(out, 'p8-driver-phones.png'), fullPage: true });

      await page.goto(`${BASE}/ai/orders`);
      await page.locator('.suggestion').first().waitFor();
      const current = await page.locator('a.nav-link[aria-current="page"]').allTextContents();
      check('the menu marks AI Orders, not Suggestions', current.length === 1 && /AI Orders/.test(current[0]), current.join('|'));
      if (out) await page.screenshot({ path: path.join(out, 'p8-ai-orders.png'), fullPage: true });
      const card = page.locator('.suggestion', { hasText: 'P8 Green Grocers usually orders' });
      await card.getByRole('button', { name: 'Use this…' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      const shownQty = await dialog.getByLabel('Quantity of Tomato').inputValue();
      if (out) await page.screenshot({ path: path.join(out, 'p8-ai-order-dialog.png') });
      await dialog.getByRole('button', { name: 'Place order' }).click();
      await dialog.waitFor({ state: 'detached' });
      const decided = await owner.get(`/ai/recommendations/${expected.id}`);
      const placed = (await db.query(
        `SELECT o.id, o.status, o.delivery_date::text AS d, json_agg(json_build_object('p', l.product_id, 'q', l.quantity::text, 'u', l.unit_price::text)) AS lines
         FROM commerce.customer_order o JOIN commerce.customer_order_line l ON l.order_id = o.id
         WHERE o.customer_id = $1 AND o.delivery_date = $2::date GROUP BY o.id`,
        [green.id, tomorrow],
      )).rows;
      check(
        'Use this… opens their order, prefilled; placed as suggested, it’s recorded as accepted, with the order it made',
        shownQty === '40' && placed.length === 1 && placed[0].lines.length === 2 && decided.status === 'accepted' && decided.decision.resultRef.id === placed[0].id,
        `${shownQty} ${JSON.stringify(placed)} ${decided.status}`,
      );

      await page.getByRole('button', { name: /^Check quantity/ }).click();
      const checkCard = page.locator('.suggestion', { hasText: 'P8 Royal Caterers' });
      await checkCard.waitFor();
      check('Check quantity: the order opens from its card', (await checkCard.getByRole('link', { name: 'Open order' }).getAttribute('href')) === `/orders?open=${short.id}`);
      await checkCard.getByRole('button', { name: 'Checked with them' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      check('confirmed with the customer: recorded', (await owner.get(`/ai/recommendations/${toCheck.id}`)).status === 'accepted');
      const after = await owner.get('/ai/calls');
      check('decided, they leave the call list', !after.calls.some((c) => c.recommendationId === expected.id || c.recommendationId === toCheck.id));

      // Read again: the order just placed reserved Tomato, and what's free now cost a little less.
      const nowPricing = await owner.get('/ai/pricing');
      const nowTomato = nowPricing.rows.find((r) => r.productId === tomato.id);
      await page.goto(`${BASE}/ai/pricing`);
      await page.locator('.pricing-table tbody tr').first().waitFor();
      const priceRows = await page.locator('.pricing-table tbody tr').count();
      const tomatoText = (await page.locator('.pricing-table tbody tr', { hasText: 'Tomato' }).textContent()).replace(/\s+/g, ' ');
      check('AI Pricing: a row a product, with its sustainable price', priceRows === nowPricing.rows.length && tomatoText.includes(`₹${nowTomato.buildUp.sustainable}`), tomatoText);
      if (out) await page.screenshot({ path: path.join(out, 'p8-ai-pricing.png'), fullPage: true });

      await page.goto(`${BASE}/ai/calling`);
      await page.getByRole('heading', { name: 'AI calls aren’t set up' }).waitFor();
      await page.waitForFunction(() => /Quantities to confirm \(\d+\)/.test(document.querySelector('main')?.textContent ?? ''));
      const callText = (await page.locator('main').textContent()).replace(/\s+/g, ' ');
      check('AI Calling: AI calls not set up; today’s calls to make meanwhile', /Payments to chase \(\d+\)/.test(callText) && /Orders to ask for \(0\)/.test(callText) && /New orders to confirm \(\d+\)/.test(callText) && !/Call with AI/.test(callText), callText.slice(0, 300));
      if (out) await page.screenshot({ path: path.join(out, 'p8-ai-calling.png'), fullPage: true });

      const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
      await phone.goto(`${BASE}/login`);
      await phone.fill('#login', 'owner@dev.morbeez.local');
      await phone.fill('#password', PASSWORD);
      await phone.click('button[type=submit]');
      await phone.waitForURL((u) => !/\/login/.test(u.toString()));
      await phone.goto(`${BASE}/sync`);
      await phone.locator('.phone-card').first().waitFor();
      const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check('Driver phones on a phone: no sideways scroll', overflow <= 1, String(overflow));
      if (out) await phone.screenshot({ path: path.join(out, 'p8-driver-phones-phone.png'), fullPage: true });
    } finally {
      await browser.close();
    }

    // ---- The phone catches up; then goes quiet ----
    await driver.post('/devices/sync-report', report({ pendingOperations: 0, failedOperations: 0, pendingPhotos: 0, failures: [], oldestPendingAt: undefined, lastResult: 'success' }));
    status = await owner.get('/devices/sync-status');
    raju = status.drivers.find((d) => d.name === 'Raju Driver');
    check('sent at last: synced', raju.state === 'synced' && raju.devices.length === 1, raju.state);
    await db.query(`UPDATE identity.device_sync SET reported_at = now() - interval '3 hours' WHERE device_id = 'e2e-phone-raju'`);
    raju = (await owner.get('/devices/sync-status')).drivers.find((d) => d.name === 'Raju Driver');
    check('nothing for three hours: not heard from', raju.state === 'quiet', raju.state);
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
