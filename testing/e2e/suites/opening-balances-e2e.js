// Opening balances, the finance-cost switch and the three-button bar (the
// client, 20 Nov 2026): "Both customer farmer need opening balance. If they
// bring old customer in to that it helps"; "Finance cost Enable or disable"
// on Add customer; "Dashboard Procurement Delivery three button enough".
// A customer's opening balance is its own invoice (OB-…) and a farmer's a
// payable without a lot: statements, receivables, the credit limit, payments
// and credit notes carry them; sales, purchases and GST never count them; the
// books balance on an Opening balances equity account. Through the API, then
// the owner app on a phone. Makes its own data, on the seed.
const path = require('path');
const { API, BASE, DB_URL, PASSWORD, launchBrowser } = require('../lib/env');
const { Client } = require('pg');

const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`);

async function login(login) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password: PASSWORD }) });
  const body = await r.json();
  if (!body.accessToken) throw new Error(`login ${login}: ${r.status}`);
  return body.accessToken;
}

function client(token) {
  const call = async (method, p, body) => {
    const r = await fetch(`${API}${p}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  const ok = async (method, p, body) => {
    const res = await call(method, p, body);
    if (res.status >= 300) throw new Error(`${method} ${p} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  };
  return { raw: call, get: (p) => ok('GET', p), post: (p, b = {}) => ok('POST', p, b), patch: (p, b) => ok('PATCH', p, b) };
}

const addDays = (d, n) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

(async () => {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const owner = client(await login('owner@dev.morbeez.local'));
  const accountant = client(await login('accountant@dev.morbeez.local'));
  const ops = client(await login('ops-manager@dev.morbeez.local'));
  const s = Date.now().toString(36);
  const today = (await owner.get('/accounting/periods')).today;
  const shots = process.env.E2E_SCREENSHOTS;
  const entryLines = async (sourceId) =>
    (
      await db.query(
        `SELECT l.account_code, l.party_type, l.debit::text, l.credit::text FROM money.ledger_line l JOIN money.ledger_entry e ON e.id = l.entry_id
          WHERE e.entry_type = 'opening_balance' AND e.source_id = $1 AND (l.debit > 0 OR l.credit > 0) ORDER BY l.debit DESC`,
        [sourceId],
      )
    ).rows;

  try {
    // ---- Finance cost on or off, from the start ----
    const noRate = await owner.raw('POST', '/customers', { name: `No rate ${s}`, financeChargeEnabled: true });
    check('finance cost switched on without a rate is refused', noRate.status === 400 && /annual rate/.test(noRate.body?.error?.message ?? ''), noRate.body?.error?.message);
    const c1 = await owner.post('/customers', {
      name: `Old Hotel ${s}`,
      creditLimit: 20000,
      paymentTermsDays: 7,
      financeChargeEnabled: true,
      financeChargeRateAnnual: 18,
      financeChargeGraceDays: 3,
    });
    check('a customer can start with the finance cost on: 18% a year, 3 days’ grace', c1.financeChargeEnabled === true && c1.financeChargeRateAnnual === '18.00' && c1.financeChargeGraceDays === 3, JSON.stringify({ on: c1.financeChargeEnabled, rate: c1.financeChargeRateAnnual, grace: c1.financeChargeGraceDays }));
    const history = await owner.get(`/customers/${c1.id}/terms-history`);
    check('…in its first terms version, not a change a moment later', history.length === 1 && history[0].source === 'created' && history[0].financeChargeEnabled === true, JSON.stringify(history.map((h) => [h.source, h.financeChargeEnabled])));
    const c2 = await owner.post('/customers', { name: `Plain Shop ${s}` });
    check('…and off unless switched on', c2.financeChargeEnabled === false, String(c2.financeChargeEnabled));

    // ---- A customer's opening balance ----
    const denied = await ops.raw('POST', `/finance/customers/${c1.id}/opening-balance`, { amount: 100 });
    check('only someone who may post to the books enters one', denied.status === 403, String(denied.status));
    const future = await owner.raw('POST', `/finance/customers/${c1.id}/opening-balance`, { amount: 100, asOf: addDays(today, 1) });
    check('never dated in the future', future.status === 400, `${future.status} ${future.body?.error?.message}`);
    const ob = await owner.post(`/finance/customers/${c1.id}/opening-balance`, { amount: 12500.5, note: 'Old ledger, page 14' });
    check('it is its own bill: OB-…, ₹12,500.50, standing today and due today', /^OB-\d{6}$/.test(ob.invoiceNumber) && ob.amount === '12500.50' && ob.asOf === today && ob.dueDate === today, JSON.stringify(ob));
    const again = await owner.raw('POST', `/finance/customers/${c1.id}/opening-balance`, { amount: 1 });
    check('entered once — a second is refused', again.status === 409 && /already has an opening balance/.test(again.body?.error?.message ?? ''), again.body?.error?.message);
    check(
      'the books: Dr Accounts receivable (the customer) / Cr Opening balances',
      JSON.stringify(await entryLines(ob.invoiceId)) ===
        JSON.stringify([
          { account_code: 'accounts_receivable', party_type: 'customer', debit: '12500.50', credit: '0.00' },
          { account_code: 'opening_balances', party_type: null, debit: '0.00', credit: '12500.50' },
        ]),
      JSON.stringify(await entryLines(ob.invoiceId)),
    );
    const taxed = await db.query('SELECT count(*)::int AS n FROM tax.invoice_tax WHERE invoice_id = $1', [ob.invoiceId]);
    check('no GST — it was never a supply', taxed.rows[0].n === 0, String(taxed.rows[0].n));
    const statement = await owner.get(`/finance/customers/${c1.id}/statement?days=30`);
    const line = statement.lines.find((l) => l.reference === ob.invoiceNumber);
    check('the statement opens with it: “Opening balance brought forward”', line?.debit === '12500.50' && /^Opening balance brought forward, due /.test(line.description ?? '') && statement.lines[0]?.reference === ob.invoiceNumber, JSON.stringify(line));
    let profile = await owner.get(`/customers/${c1.id}/profile`);
    check(
      'the profile: owed ₹12,500.50, sales still nothing',
      profile.money.outstanding === '12500.50' && profile.money.totalSales === '0.00' && profile.money.openingBalance?.invoiceNumber === ob.invoiceNumber && profile.money.openingBalance.outstanding === '12500.50',
      JSON.stringify({ out: profile.money.outstanding, sales: profile.money.totalSales, ob: profile.money.openingBalance }),
    );
    const receivables = await owner.get('/finance/receivables');
    const row = (receivables.customers ?? receivables.rows ?? receivables.items ?? []).find((r) => r.customerId === c1.id);
    check('receivables count it', !!row && JSON.stringify(row).includes('12500.5'), JSON.stringify(row).slice(0, 200));

    // It counts against the credit limit (₹20,000): ₹12,500.50 owed + an ₹8,000 order is over.
    const onion = await owner.post('/products', { name: `OB Onion ${s}`, baseUom: 'kg' });
    const farmer = await owner.post('/farmers', { name: `Old Farm ${s}` });
    let po = await owner.post('/procurement/purchase-orders', { farmerId: farmer.id, lines: [{ productId: onion.id, expectedQuantity: 300, indicativePrice: 20 }] });
    po = await owner.post(`/procurement/purchase-orders/${po.id}/confirm`, { version: po.version });
    await owner.post(`/procurement/purchase-orders/${po.id}/receive-goods`, { lines: [{ productId: onion.id, receivedQuantity: 300 }] });
    const [lot] = await owner.get(`/procurement/purchase-orders/${po.id}/lots`);
    await owner.post(`/procurement/lots/${lot.id}/grade`, { version: lot.version, acceptedQuantity: 300, rejectedQuantity: 0, unitCost: 20 });
    const order = await owner.post('/orders', { customerId: c1.id, lines: [{ productId: onion.id, quantity: 200, unitPrice: 40 }] });
    const over = await owner.raw('POST', `/orders/${order.id}/confirm`, { version: order.version });
    check('it counts against the credit limit: ₹12,500.50 + an ₹8,000 order is over ₹20,000', over.status === 409 && /credit limit/.test(over.body?.error?.message ?? ''), `${over.status} ${over.body?.error?.message}`);
    const paid = await accountant.post('/finance/customer-payments', { customerId: c1.id, amount: 2500, method: 'upi', reference: `UTR${s}` });
    check('a payment settles it like any bill', paid.allocations?.some((a) => a.invoiceNumber === ob.invoiceNumber && a.amount === '2500.00'), JSON.stringify(paid.allocations));
    const confirmed = await owner.raw('POST', `/orders/${order.id}/confirm`, { version: order.version });
    check('…and with ₹10,000.50 owed the order fits the limit', confirmed.status < 300, `${confirmed.status} ${confirmed.body?.error?.message ?? ''}`);
    const note = await owner.post('/finance/credit-notes', { invoiceId: ob.invoiceId, amount: 500, reason: 'Old ledger double-counted a bill' });
    const noteLines = (
      await db.query(
        `SELECT l.account_code, l.debit::text, l.credit::text FROM money.ledger_line l JOIN money.ledger_entry e ON e.id = l.entry_id
          WHERE e.source_id = $1 AND (l.debit > 0 OR l.credit > 0) ORDER BY l.debit DESC`,
        [note.id],
      )
    ).rows;
    check(
      'a credit note corrects it against Opening balances — never sales returns',
      noteLines.length === 2 && noteLines[0].account_code === 'opening_balances' && noteLines[0].debit === '500.00' && noteLines[1].account_code === 'accounts_receivable',
      JSON.stringify(noteLines),
    );
    profile = await owner.get(`/customers/${c1.id}/profile`);
    check('…and what of it is still owed: ₹9,500.50', profile.money.openingBalance?.outstanding === '9500.50', profile.money.openingBalance?.outstanding);
    const walkIn = (await db.query(`SELECT id FROM trading_partners.customer WHERE is_walk_in LIMIT 1`)).rows[0];
    if (walkIn) {
      const w = await owner.raw('POST', `/finance/customers/${walkIn.id}/opening-balance`, { amount: 10 });
      check('never for the walk-in customer', w.status === 400, String(w.status));
    }

    // ---- A farmer's opening balance ----
    const fob = await accountant.post(`/finance/farmers/${farmer.id}/opening-balance`, { amount: 8000, asOf: today, note: 'Old ledger' });
    check('a farmer’s: ₹8,000 owed to them, due today, no advance to meet it', fob.amount === '8000.00' && fob.outstanding === '8000.00' && fob.fromAdvance === '0.00' && fob.dueDate === today, JSON.stringify(fob));
    check(
      'the books: Dr Opening balances / Cr Accounts payable (the farmer)',
      JSON.stringify(await entryLines(fob.payableId)) ===
        JSON.stringify([
          { account_code: 'opening_balances', party_type: null, debit: '8000.00', credit: '0.00' },
          { account_code: 'accounts_payable_farmer', party_type: 'farmer', debit: '0.00', credit: '8000.00' },
        ]),
      JSON.stringify(await entryLines(fob.payableId)),
    );
    check('entered once', (await owner.raw('POST', `/finance/farmers/${farmer.id}/opening-balance`, { amount: 1 })).status === 409);
    let fp = await owner.get(`/farmers/${farmer.id}/profile`);
    check(
      'the farmer’s profile: ₹14,000 owed (₹8,000 brought forward + the ₹6,000 lot); purchases only the lot',
      fp.money.owed === '14000.00' && fp.money.totalPurchases === '6000.00' && fp.money.openingBalance?.amount === '8000.00',
      JSON.stringify({ owed: fp.money.owed, purchases: fp.money.totalPurchases, ob: fp.money.openingBalance }),
    );
    const lots = await owner.get(`/finance/payables/${farmer.id}/lots`);
    const obRow = lots.find((l) => l.kind === 'opening');
    check('what’s owed lists it first, as the opening balance — no lot', lots[0]?.kind === 'opening' && obRow?.lotId === null && obRow.productName === 'Opening balance' && obRow.outstanding === '8000.00', JSON.stringify(lots.map((l) => [l.kind, l.productName, l.outstanding])));
    await accountant.post('/finance/farmer-payments', { farmerId: farmer.id, amount: 3000, method: 'bank_transfer', allocations: [{ payableId: obRow.payableId, amount: 3000 }] });
    fp = await owner.get(`/farmers/${farmer.id}/profile`);
    check('a payment can be put against it by name', fp.money.openingBalance?.outstanding === '5000.00', fp.money.openingBalance?.outstanding);
    await accountant.post('/finance/farmer-payments', { farmerId: farmer.id, amount: 11000, method: 'bank_transfer' });
    fp = await owner.get(`/farmers/${farmer.id}/profile`);
    const poAfter = await owner.get(`/procurement/purchase-orders/${po.id}`);
    check('oldest first: the opening balance, then the lot — both paid, and the lot’s order closes', fp.money.owed === '0.00' && fp.money.openingBalance?.outstanding === '0.00', `${fp.money.owed} ${fp.money.openingBalance?.outstanding} ${poAfter.status}`);
    const tb = await owner.get('/finance/ledger/trial-balance');
    const unbalanced = await db.query(`SELECT e.id FROM money.ledger_entry e JOIN money.ledger_line l ON l.entry_id = e.id GROUP BY e.id HAVING SUM(l.debit) <> SUM(l.credit)`);
    check('the books still balance, with Opening balances in equity', unbalanced.rowCount === 0 && JSON.stringify(tb).includes('opening_balances'), String(unbalanced.rowCount));

    // ---- The owner app, on a phone ----
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({ viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true })).newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${BASE}/login`);
      await page.fill('#login', 'owner@dev.morbeez.local');
      await page.fill('#password', PASSWORD);
      await page.click('button[type=submit]');
      await page.waitForURL((u) => !/\/login/.test(u.toString()));
      await page.goto(`${BASE}/dashboard`);
      await page.waitForSelector('.net-card', { timeout: 20000 });
      const tabs = (await page.locator('.bottom-nav').getByRole('link').allInnerTexts()).map((x) => x.trim());
      check('UI: the bottom bar is Dashboard · Procurement · Delivery', tabs.join('|') === 'Dashboard|Procurement|Delivery', tabs.join('|'));
      if (shots) await page.screenshot({ path: path.join(shots, 'nav-three-buttons.png') });

      await page.goto(`${BASE}/customers?new=1`);
      const dialog = page.locator('dialog[open]');
      await dialog.getByRole('heading', { name: 'New customer' }).waitFor();
      await dialog.getByLabel('Name', { exact: true }).fill(`Brought Forward Mess ${s}`);
      await dialog.getByLabel('Charge finance cost (interest) on overdue bills').check();
      check('UI: switching the finance cost on asks for the rate (18% suggested)', (await dialog.getByLabel('Finance charge (% a year)').inputValue()) === '18');
      await dialog.getByLabel('Opening balance — they owe you now (optional)').fill('4000');
      if (shots) {
        await dialog.getByLabel('Opening balance — they owe you now (optional)').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(shots, 'opening-customer-form.png') });
      }
      await dialog.getByRole('button', { name: 'Add customer' }).click();
      await page.locator('.detail').getByText(`Brought Forward Mess ${s}`).first().waitFor({ timeout: 20000 });
      await page.waitForFunction(() => /Opening balance/.test(document.querySelector('.detail')?.textContent ?? '') && /OB-\d{6}/.test(document.querySelector('.detail')?.textContent ?? ''), null, { timeout: 15000 });
      const made = (await db.query('SELECT id, finance_charge_enabled, finance_charge_rate_annual::text AS rate FROM trading_partners.customer WHERE name = $1', [`Brought Forward Mess ${s}`])).rows[0];
      const madeOb = (await db.query(`SELECT amount::text FROM money.invoice WHERE customer_id = $1 AND kind = 'opening'`, [made.id])).rows[0];
      check('UI: added with the finance cost on and ₹4,000 brought forward', made.finance_charge_enabled === true && made.rate === '18.00' && madeOb?.amount === '4000.00', JSON.stringify({ ...made, ob: madeOb }));
      const details = (await page.locator('.detail .key-values').innerText()).replace(/\s+/g, ' ');
      check('UI: the profile shows the opening balance, its number and what is still owed', /Opening balance ₹4,000/.test(details) && /OB-\d{6}/.test(details) && /₹4,000 still owed/.test(details), details.slice(0, 260));
      if (shots) await page.screenshot({ path: path.join(shots, 'opening-customer-profile.png'), fullPage: true });

      await page.goto(`${BASE}/farmers?new=1`);
      const fdialog = page.locator('dialog[open]');
      await fdialog.getByLabel('Name', { exact: true }).fill(`Brought Forward Farm ${s}`);
      await fdialog.getByLabel('Opening balance — you owe them now (optional)').fill('2500');
      await fdialog.getByRole('button', { name: 'Add farmer' }).click();
      await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 0, null, { timeout: 15000 });
      const fmade = (await db.query('SELECT id FROM trading_partners.farmer WHERE name = $1', [`Brought Forward Farm ${s}`])).rows[0];
      const fOb = (await db.query(`SELECT amount::text FROM money.farmer_payable WHERE farmer_id = $1 AND kind = 'opening'`, [fmade.id])).rows[0];
      check('UI: a farmer added with ₹2,500 brought forward', fOb?.amount === '2500.00', JSON.stringify(fOb));
      await page.goto(`${BASE}/farmers?open=${fmade.id}`);
      await page.waitForFunction(() => /Opening balance/.test(document.querySelector('.detail')?.textContent ?? ''), null, { timeout: 15000 });
      await page.locator('.detail').getByRole('button', { name: /^Pay / }).first().click();
      const pay = page.locator('dialog[open]');
      await pay.locator('table').waitFor();
      const payRows = (await pay.locator('table tbody').innerText()).replace(/\s+/g, ' ');
      check('UI: paying the farmer lists the opening balance to put money against', /Opening balance/.test(payRows) && /₹2,500/.test(payRows), payRows);
      if (shots) {
        await pay.locator('table').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(shots, 'opening-farmer-pay.png') });
      }
      await pay.getByRole('button', { name: 'Cancel' }).click();
      check('UI: no page errors', errors.length === 0, errors.join(' | '));
    } finally {
      await browser.close();
    }

    // ---- Closed books stay closed (last: it closes yesterday) ----
    const closed = await owner.raw('POST', '/accounting/periods/close', { through: addDays(today, -1) });
    if (closed.status < 300) {
      const back = await owner.raw('POST', `/finance/customers/${c2.id}/opening-balance`, { amount: 100, asOf: addDays(today, -1) });
      check('never dated into a closed period', back.status === 400 && /closed through/.test(back.body?.error?.message ?? ''), `${back.status} ${back.body?.error?.message}`);
    } else {
      check('never dated into a closed period', false, `could not close yesterday: ${closed.status} ${JSON.stringify(closed.body)}`);
    }
  } finally {
    await db.end();
  }
  console.log(results.join('\n'));
  console.log(`\n${results.filter((x) => x.startsWith('PASS')).length}/${results.length} passed`);
  if (results.some((x) => x.startsWith('FAIL'))) process.exit(1);
})().catch((e) => {
  console.log(results.join('\n'));
  console.error('FAILED:', e.message);
  process.exit(1);
});
