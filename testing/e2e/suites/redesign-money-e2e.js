// Owner app redesign, Phase 6 — Inventory, Collections, Finance, Profit
// (docs/redesign): Vehicle Stock (on vehicles, committed, free) and Total
// Stock; Collections (today, pending, all) with Collect and Add Collection;
// the Finance hub's figures against the reports and the ledger; Profit &
// Insights against the profit and loss, product by product. Runs after the
// stock-by-the-kilo suite (its beans, van and customers), on the seeded business.
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
  return { raw: call, get: (p) => ok('GET', p), post: (p, b = {}) => ok('POST', p, b) };
}
const SIGNED = { recipientName: 'Manager', signatureData: 'data:image/png;base64,iVBORw0KGgo=' };
const same = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

(async () => {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const browser = await launchBrowser();
  try {
    const owner = client(await login('owner@dev.morbeez.local'));
    const products = (await owner.get('/products?pageSize=100')).items;
    const vehicles = (await owner.get('/vehicles?pageSize=100')).items;
    const customers = (await owner.get('/customers?pageSize=100')).items;
    const farmers = (await owner.get('/farmers?pageSize=100')).items;
    const workers = (await owner.get('/workforce?pageSize=100')).items;
    const beans = products.find((p) => p.name === 'Beans');
    const van = vehicles.find((v) => v.registrationNumber === 'KA09KG0985');
    const annapurna = customers.find((c) => c.name === 'Annapurna Mess');
    const udupi = customers.find((c) => c.name === 'Udupi Grand');
    const ramesh = farmers.find((f) => f.name === 'Ramesh Patil');
    const suresh = workers.find((w) => w.name === 'Suresh Kale');
    if (!beans || !van || !annapurna) throw new Error('run the stock-by-the-kilo suite first (beans, van, customers)');

    // ---- Vehicle Stock ----
    const before = await owner.get('/inventory/vehicles');
    check('a vehicle with nothing aboard and no trip on the road is not listed', !before.vehicles.some((v) => v.vehicleId === van.id));

    const orderG = await owner.post('/orders', { customerId: annapurna.id, confirm: true, creditTermDays: 0, lines: [{ productId: beans.id, quantity: 200, unitPrice: 31 }] });
    let po = await owner.post('/procurement/purchase-orders', { farmerId: ramesh.id, lines: [{ productId: beans.id, expectedQuantity: 100, indicativePrice: 12 }] });
    po = await owner.post(`/procurement/purchase-orders/${po.id}/confirm`, { version: po.version });
    const pickup = await owner.post(`/procurement/purchase-orders/${po.id}/pickups`, {});
    let trip = await owner.post('/logistics/trips', { vehicleId: van.id, driverEmployeeId: suresh.id, advanceAmount: 0 });
    const farmStop = await owner.post(`/logistics/trips/${trip.id}/stops/pickup`, { pickupId: pickup.id });
    const stopG = await owner.post(`/logistics/trips/${trip.id}/stops/delivery`, { orderId: orderG.id });
    trip = await owner.post(`/logistics/trips/${trip.id}/start`, { version: trip.version });
    await owner.post(`/logistics/trips/${trip.id}/stops/${farmStop.id}/complete-pickup`, { weights: [{ productId: beans.id, netQuantity: 100 }] });

    let board = await owner.get('/inventory/vehicles');
    let card = board.vehicles.find((v) => v.vehicleId === van.id);
    let line = card?.products.find((p) => p.productId === beans.id);
    check(
      'on the road: the van, its trip and driver, 300 kg aboard',
      card && card.status === 'in_transit' && card.tripNumber === trip.number && card.driverName === 'Suresh Kale' && card.totalKg === '300.000',
      JSON.stringify(card && { ...card, products: undefined }),
    );
    check('…200 kg committed to the delivery, the 100 kg picked up free', line?.onVehicle === '300.000' && line.committed === '200.000' && line.free === '100.000' && line.toDeliver === '200.000', JSON.stringify(line));
    const sum = (pick) => board.vehicles.flatMap((v) => v.products.filter((p) => p.uom === 'kg')).reduce((n, p) => n + Number(pick(p)), 0);
    check(
      'the totals are every vehicle added up: on vehicles = committed + free',
      same(board.totalsKg.onVehicles, sum((p) => p.onVehicle)) && same(board.totalsKg.committed, sum((p) => p.committed)) && same(Number(board.totalsKg.onVehicles), Number(board.totalsKg.committed) + Number(board.totalsKg.free)),
      JSON.stringify(board.totalsKg),
    );

    await owner.post(`/logistics/trips/${trip.id}/stops/${stopG.id}/complete-delivery`, SIGNED);
    board = await owner.get('/inventory/vehicles');
    line = board.vehicles.find((v) => v.vehicleId === van.id)?.products.find((p) => p.productId === beans.id);
    check('delivered: 100 kg left aboard, all of it free', line?.onVehicle === '100.000' && line.committed === '0.000' && line.free === '100.000', JSON.stringify(line));
    const stock = (await owner.get('/inventory/stock')).find((r) => r.productId === beans.id);
    check('Total Stock: 183 kg of beans — 83 in the store (20 held for an order), 100 on the van', stock?.physical === '183.000' && stock.onVehicles === '100.000' && stock.reserved === '20.000' && stock.available === '163.000', JSON.stringify(stock));

    // ---- Collections ----
    const pending = await owner.get('/finance/collections?view=pending');
    const due = pending.items.find((c) => c.customerId === annapurna.id);
    check(
      "pending: Annapurna Mess, with today's ₹6,200 due (the rest isn't due yet) and ₹19,700 owed in all",
      due && due.kind === 'due' && due.status === 'pending' && due.amount === '6200.00' && due.balance === '19700.00' && due.overdueDays === 0,
      JSON.stringify(due),
    );
    check('a customer whose invoices are all still in their terms is not pending', !pending.items.some((c) => c.customerId === udupi.id && Number(c.amount) <= 0));
    const todayBefore = await owner.get('/finance/collections?view=today');
    check('the counts on every tab come with each view', todayBefore.counts.pending === pending.counts.pending && todayBefore.counts.all >= todayBefore.counts.today);
    const driver = client(await login('driver@dev.morbeez.local'));
    const deniedProfit = await driver.raw('GET', '/dashboard/insights?period=month');
    check("profit figures aren't for a driver", deniedProfit.status === 403, String(deniedProfit.status));

    // ---- Finance hub ----
    const fin = await owner.get('/dashboard/finance?period=month');
    const receivables = await owner.get('/finance/receivables');
    const payables = await owner.get('/finance/payables');
    const accounts = Object.fromEntries((await owner.get('/accounting/accounts')).map((a) => [a.code, a.balance]));
    const pnl = await owner.get(`/accounting/profit-and-loss?from=${fin.range.from}&to=${fin.range.to}`);
    check('this month runs from the 1st to today', fin.range.name === 'month' && fin.range.from.endsWith('-01') && fin.range.from.slice(0, 7) === fin.range.to.slice(0, 7), JSON.stringify(fin.range));
    check(
      "receivables are the receivables report's: open invoices less credit on account",
      same(fin.receivables, Number(receivables.totals.outstanding) - Number(receivables.totals.creditOnAccount)),
      `${fin.receivables} vs ${JSON.stringify(receivables.totals)}`,
    );
    check("payables are what's owed to farmers", same(fin.payables, payables.totals.owed), `${fin.payables} vs ${JSON.stringify(payables.totals)}`);
    check('cash balance is cash in hand and bank on the ledger', same(fin.cashBalance, Number(accounts.cash_on_hand ?? 0) + Number(accounts.bank ?? 0)), `${fin.cashBalance}`);
    check(
      "expenses are the profit and loss's costs other than the goods sold",
      same(fin.expenses, Number(pnl.figures.operatingExpenses) + Number(pnl.figures.financeCosts) + Number(pnl.figures.otherExpenses)),
      `${fin.expenses} vs ${JSON.stringify(pnl.figures)}`,
    );

    // ---- Profit & Insights ----
    const ins = await owner.get('/dashboard/insights?period=month');
    check('revenue and net profit are the books’ own (profit and loss, same dates)', same(ins.revenue, pnl.figures.netSales) && same(ins.netProfit, pnl.figures.netProfit), `${ins.revenue}/${ins.netProfit} vs ${pnl.figures.netSales}/${pnl.figures.netProfit}`);
    check('revenue − total cost = net profit', same(Number(ins.revenue) - Number(ins.totalCost), ins.netProfit));
    check('the margin is net profit on revenue', ins.marginPercent === (Number(ins.revenue) > 0 ? ((Number(ins.netProfit) / Number(ins.revenue)) * 100).toFixed(1) : null), `${ins.marginPercent}`);
    const beansProfit = ins.products.find((p) => p.productId === beans.id);
    check(
      'beans: ₹27,700 sold before GST, the 900 kg at ₹12 = ₹10,800 → ₹16,900 profit, 61.0%',
      beansProfit && beansProfit.revenue === '27700.00' && beansProfit.costOfGoods === '10800.00' && beansProfit.profit === '16900.00' && beansProfit.marginPercent === '61.0',
      JSON.stringify(beansProfit),
    );
    const today = await owner.get('/dashboard/insights?period=today');
    const custom = await owner.get(`/dashboard/insights?period=custom&from=${today.range.to}&to=${today.range.to}`);
    check('a custom day is the same as Today', custom.revenue === today.revenue && custom.netProfit === today.netProfit && custom.range.name === 'custom');
    check('a custom period needs both dates', (await owner.raw('GET', '/dashboard/insights?period=custom&from=2026-10-01')).status === 400);

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
    const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

    await page.goto(`${BASE}/inventory`);
    await page.waitForSelector('.vehicle-stock-card');
    const vanCard = (await page.locator('.vehicle-stock-card', { hasText: 'KA09KG0985' }).textContent()).replace(/\s+/g, ' ');
    check('Vehicle Stock: the van in transit with its driver, its total and its beans', /Suresh Kale/.test(vanCard) && /In Transit/.test(vanCard) && /100 kg/.test(vanCard) && /Beans/.test(vanCard), vanCard);
    const totals = (await page.locator('.stock-totals').textContent()).replace(/\s+/g, ' ');
    check('…and the totals on vehicles, committed, free', /Total on Vehicles/.test(totals) && /Committed/.test(totals) && /Free Stock/.test(totals), totals);
    await page.locator('.vehicle-filter select').selectOption({ label: 'KA09KG0985' });
    const vanOnly = (await page.locator('.stock-totals').textContent()).replace(/\s+/g, ' ');
    check('choosing the van shows its own totals', /Total on Vehicles\s*100 kg/.test(vanOnly) && (await page.locator('.vehicle-stock-card').count()) === 1, vanOnly);
    check('Vehicle Stock fits a phone', await noSideScroll());
    await page.getByRole('button', { name: 'Total Stock' }).click();
    await page.waitForSelector('.row-selectable:has-text("Beans")');
    const beansRow = (await page.locator('.row-selectable', { hasText: 'Beans' }).textContent()).replace(/\s+/g, ' ');
    check('Total Stock: beans on hand, in the store, on vehicles, held, free', /183 kg/.test(beansRow) && /83 kg/.test(beansRow) && /100 kg/.test(beansRow) && /163 kg/.test(beansRow), beansRow);
    await page.locator('.row-selectable', { hasText: 'Beans' }).click();
    await page.waitForFunction(() => /Beans — lots in stock/.test(document.querySelector('.detail')?.textContent ?? ''));
    await page.locator('.detail').getByRole('button', { name: 'Shrinkage' }).first().waitFor({ timeout: 15000 });
    check('…a product opens its lots, with their actions', (await page.locator('.detail').getByRole('button', { name: 'Shrinkage' }).count()) > 0);

    await page.goto(`${BASE}/collections`);
    // Customer / Farmer above (owner app Phase 7); the customer's Today / Pending / All below.
    const views = '.day-tabs[aria-label="Which collections"] button';
    await page.waitForSelector(views);
    // The counts arrive with the data, after the tabs are drawn.
    await page.waitForFunction((sel) => /\(\d+\)/.test(document.querySelector(`${sel}:last-child`)?.textContent ?? ''), views, { timeout: 15000 }).catch(() => {});
    const tabs = await page.locator(views).allInnerTexts();
    check('Collections: Today / Pending / All with counts', /^Today \(\d+\)$/.test(tabs[0]) && /^Pending \(\d+\)$/.test(tabs[1]) && /^All \(\d+\)$/.test(tabs[2]), tabs.join(' | '));
    await page.locator(views, { hasText: 'Pending' }).click();
    await page.waitForSelector('.collection-card:has-text("Annapurna Mess")');
    const dueCard = (await page.locator('.collection-card', { hasText: 'Annapurna Mess' }).textContent()).replace(/\s+/g, ' ');
    check('a pending card: what’s due, Due today, Pending, the balance', /₹6,200/.test(dueCard) && /Due today/.test(dueCard) && /Pending/.test(dueCard) && /Bal: ₹19,700/.test(dueCard), dueCard);
    await page.locator('.collection-card', { hasText: 'Annapurna Mess' }).getByRole('button', { name: 'Collect' }).click();
    await page.locator('dialog[open]').getByLabel(/Amount received/).fill('5000');
    await page.locator('dialog[open]').getByRole('button', { name: 'Record payment' }).click();
    await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 0, null, { timeout: 15000 });
    await page.locator('.day-tabs button', { hasText: 'Today' }).click();
    await page.waitForSelector('.collection-card:has-text("Annapurna Mess")');
    const paidCard = (await page.locator('.collection-card', { hasText: 'Annapurna Mess' }).first().textContent()).replace(/\s+/g, ' ');
    check('Collect records it: today, ₹5,000, Partial, ₹14,700 still owed', /₹5,000/.test(paidCard) && /Partial/.test(paidCard) && /Bal: ₹14,700/.test(paidCard), paidCard);
    await page.getByRole('button', { name: 'Add Collection' }).click();
    await page.locator('dialog[open]').getByLabel('Customer').selectOption({ label: 'Udupi Grand — Mysuru' });
    await page.locator('dialog[open]').getByRole('button', { name: 'Next' }).click();
    await page.waitForFunction(() => /Record a payment from Udupi Grand/.test(document.querySelector('dialog[open]')?.textContent ?? ''));
    check('Add Collection asks who paid, then takes the payment', true);
    await page.locator('dialog[open]').getByRole('button', { name: 'Cancel' }).click();
    check('Collections fits a phone', await noSideScroll());

    await page.goto(`${BASE}/finance`);
    await page.waitForSelector('.money-tile');
    const hub = (await page.locator('.money-tiles').textContent()).replace(/\s+/g, ' ');
    check('Finance: Receivables, Payables, Cash Balance, Expenses', /Receivables/.test(hub) && /Payables/.test(hub) && /Cash Balance/.test(hub) && /Expenses/.test(hub), hub);
    const rows = await page.locator('.link-row').allInnerTexts();
    check('…and the five ledger links', ['Receivables', 'Payables', 'Cash & Expenses', 'Ledger & Transactions', 'Workforce Settlements'].every((x) => rows.some((r) => r.includes(x))), rows.join(' | '));
    await page.locator('.link-row', { hasText: 'Receivables' }).click();
    await page.waitForSelector('.figures');
    check('a row opens its report', /#receivables$/.test(page.url()) && (await page.getByRole('button', { name: 'Record payment' }).count()) > 0, page.url());
    await page.goBack();
    await page.waitForSelector('.link-row');
    check("…and the phone's Back returns to the hub", (await page.locator('.link-row').count()) === 5);
    await page.locator('.link-row', { hasText: 'Payables' }).click();
    await page.waitForSelector('.figures');
    await page.locator('.back-link').click();
    await page.waitForSelector('.link-row');
    check('…as does the Finance link above a report', (await page.locator('.link-row').count()) === 5);
    check('Finance fits a phone', await noSideScroll());

    await page.goto(`${BASE}/profit`);
    await page.waitForSelector('.profit-tile');
    await page.locator('.day-tabs button', { hasText: 'Month' }).click();
    await page.waitForFunction(() => /Beans/.test(document.querySelector('.product-profit')?.textContent ?? ''));
    const tilesText = (await page.locator('.profit-tiles').textContent()).replace(/\s+/g, ' ');
    const beansLine = (await page.locator('.product-profit li', { hasText: 'Beans' }).textContent()).replace(/\s+/g, ' ');
    check('Profit & Insights: revenue, total cost, net profit, margin', /Revenue/.test(tilesText) && /Total Cost/.test(tilesText) && /Net Profit/.test(tilesText) && /Margin/.test(tilesText), tilesText);
    check('…and beans in the product-wise profit: ₹16,900, 61.0%', /₹16,900/.test(beansLine) && /61\.0%/.test(beansLine), beansLine);
    await page.locator('.day-tabs button', { hasText: 'Custom' }).click();
    check('Custom asks for the dates', (await page.locator('.custom-dates input[type=date]').count()) === 2);
    check('Profit & Insights fits a phone', await noSideScroll());

    await page.goto(`${BASE}/operations`);
    await page.waitForSelector('.op-tile');
    check('the Operations hub’s Collections tile opens Collections', (await page.locator('.op-tile', { hasText: 'Collections' }).getAttribute('href')) === '/collections');
    const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')));
    check('the side menu has Collections and Profit & Insights', hrefs.includes('/collections') && hrefs.includes('/profit'), hrefs.filter((h) => /collections|profit/.test(h)).join(' '));
    await page.goto(`${BASE}/collections?new=1`);
    await page.waitForFunction(() => /Add Collection/.test(document.querySelector('dialog[open]')?.textContent ?? ''));
    check('(+) Add Collection opens the form straight away', true);
    check('no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();

    // ---- Paid up: no longer pending ----
    await owner.post('/finance/customer-payments', { customerId: annapurna.id, amount: 14700, method: 'upi', reference: 'UPI-77812' });
    const after = await owner.get('/finance/collections?view=today&q=annapurna');
    check('paid in full: both of today’s payments read Paid, nothing owed', after.items.length >= 2 && after.items.every((c) => c.status === 'paid' && c.balance === '0.00'), JSON.stringify(after.items.map((c) => [c.amount, c.status, c.balance])));
    check('…and Annapurna Mess has left Pending', !(await owner.get('/finance/collections?view=pending')).items.some((c) => c.customerId === annapurna.id));
    check('search narrows the list to the customer', after.items.every((c) => c.customerId === annapurna.id));
  } finally {
    await browser.close();
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
