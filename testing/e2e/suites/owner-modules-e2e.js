// Owner modules, end to end through the real owner app (next start) →
// BFF proxy → NestJS → Postgres. Every transaction is created from the UI;
// the only direct API call is the driver's proof-of-delivery, which lives
// in the driver app.
const { API, BASE, PASSWORD, launchBrowser } = require('../lib/env');
const path = require('path');

const OUT = process.env.E2E_SHOTS_DIR || path.join(__dirname, '..', '.shots');

const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);

async function apiLogin(email) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const j = await r.json();
  return j.accessToken || j.data?.accessToken;
}

async function api(token, method, p, body) {
  const r = await fetch(`${API}${p}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}

(async () => {
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  const dialog = () => page.locator('dialog[open]');
  const detail = () => page.locator('.detail');
  const fill = (label, value) => dialog().getByLabel(label).fill(value);
  const choose = (label, option) => dialog().getByLabel(label).selectOption({ label: option });
  // Submit the open dialog and wait for it to close; if it stays open, the
  // form's error message is the failure detail.
  async function submit(name) {
    await dialog().getByRole('button', { name, exact: true }).click();
    try {
      await page.waitForSelector('dialog[open]', { state: 'detached', timeout: 10000 });
      return null;
    } catch {
      const message = (await dialog().locator('.form-error').textContent().catch(() => null)) ?? 'dialog did not close';
      await page.screenshot({ path: path.join(OUT, `e2e-stuck-${Date.now()}.png`) });
      await dialog().getByRole('button', { name: 'Cancel', exact: true }).click().catch(() => {});
      return message;
    }
  }
  async function step(name, fn) {
    try {
      const detailText = await fn();
      check(name, true, detailText ?? '');
    } catch (e) {
      check(name, false, e.message.split('\n')[0]);
      await page.screenshot({ path: path.join(OUT, `e2e-fail-${results.length}.png`), fullPage: true }).catch(() => {});
    }
  }
  const must = (error) => {
    if (error) throw new Error(error);
  };
  const detailText = async () => (await detail().textContent()).replace(/\s+/g, ' ');

  try {
    await page.goto(`${BASE}/login`);
    await page.fill('#login', 'owner@dev.morbeez.local');
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL((u) => !/\/login/.test(u.toString()));

    // ---------------- Customers ----------------
    await page.goto(`${BASE}/customers`);
    await page.waitForSelector('.row-selectable');
    await step('customer: validation stops a bad form before the round trip', async () => {
      await page.getByRole('button', { name: 'New customer' }).click();
      await fill('Name', 'G');
      await dialog().getByRole('button', { name: 'Add customer' }).click();
      const message = await dialog().locator('.form-error').textContent();
      if (!/at least 2 characters/.test(message)) throw new Error(message);
      return message;
    });
    await step('customer: create', async () => {
      await fill('Name', 'Green Leaf Restaurant');
      await fill('Phone (optional)', '9822012345');
      await fill('Credit limit (INR)', '20000');
      await fill('Payment terms (days)', '7');
      must(await submit('Add customer'));
      await page.waitForFunction(() => /Green Leaf Restaurant/.test(document.querySelector('.detail .panel-title')?.textContent ?? ''));
      return (await detailText()).slice(0, 120);
    });
    await step('customer: edit contact details', async () => {
      await detail().getByRole('button', { name: 'Edit details' }).click();
      await fill('Email (optional)', 'orders@greenleaf.example');
      must(await submit('Save'));
      await page.waitForFunction(() => /orders@greenleaf\.example/.test(document.querySelector('.detail').textContent));
    });
    await step('customer: credit hold on, shows in list and detail', async () => {
      await detail().getByRole('button', { name: 'Credit terms' }).click();
      await dialog().getByLabel(/On credit hold/).check();
      await fill('Reason for the hold', 'Cheque bounced');
      must(await submit('Save terms'));
      await page.waitForFunction(() => /Cheque bounced/.test(document.querySelector('.detail').textContent));
      const listBadge = await page.locator('.row-selectable:has-text("Green Leaf") .badge').allTextContents();
      if (!listBadge.includes('On hold')) throw new Error(`list badges: ${listBadge}`);
      return listBadge.join(', ');
    });
    await step('customer: credit hold lifted', async () => {
      await detail().getByRole('button', { name: 'Credit terms' }).click();
      await dialog().getByLabel(/On credit hold/).uncheck();
      must(await submit('Save terms'));
      await page.waitForFunction(() => !/Cheque bounced/.test(document.querySelector('.detail').textContent));
    });
    await page.screenshot({ path: path.join(OUT, 'e2e-1-customers.png'), fullPage: true });

    // ---------------- Procurement ----------------
    await page.goto(`${BASE}/procurement`);
    await page.waitForSelector('.panel');
    await step('PO: create with two lines', async () => {
      await page.getByRole('button', { name: 'New purchase order' }).click();
      await choose('Farmer', 'Ramesh Patil');
      await dialog().getByLabel('Line 1 product').selectOption({ label: 'Tomato' });
      await dialog().getByLabel(/Line 1 quantity/).fill('100');
      await dialog().getByLabel(/Line 1 indicative rate/).fill('20');
      await dialog().getByRole('button', { name: 'Add a line' }).click();
      await dialog().getByLabel('Line 2 product').selectOption({ label: 'Onion' });
      await dialog().getByLabel(/Line 2 quantity/).fill('50');
      await dialog().getByLabel(/Line 2 indicative rate/).fill('18');
      const estimate = await dialog().locator('.lines-total strong').textContent();
      must(await submit('Raise purchase order'));
      await page.waitForFunction(() => /To confirm/.test(document.querySelector('.detail')?.textContent ?? ''));
      return `estimate ${estimate}`;
    });
    await step('PO: confirm (under the approval threshold)', async () => {
      await detail().getByRole('button', { name: 'Confirm', exact: true }).click();
      must(await submit('Confirm'));
      await page.waitForFunction(() => /Awaiting produce/.test(document.querySelector('.detail').textContent));
    });
    await step('PO: schedule a pickup', async () => {
      await detail().getByRole('button', { name: 'Schedule pickup' }).click();
      await choose('Vehicle (optional)', 'MH12AB4521');
      await choose('Driver (optional)', 'Suresh Kale');
      must(await submit('Schedule'));
      await page.waitForFunction(() => /Scheduled/.test(document.querySelector('.detail .plain-list')?.textContent ?? ''));
    });
    await step('PO: receive goods linked to the pickup', async () => {
      await detail().getByRole('button', { name: 'Receive goods' }).click();
      await fill('Tomato (kg)', '98');
      const linked = await dialog().getByLabel('Came on pickup (optional)').inputValue();
      must(await submit('Record receipt'));
      await page.waitForFunction(() => document.querySelectorAll('.detail table')[1]?.querySelectorAll('tbody tr').length === 2);
      return `pickup preselected: ${linked !== ''}`;
    });
    await step('PO: grading rejects accepting more than received', async () => {
      await detail().locator('tr:has-text("Tomato")').getByRole('button', { name: 'Grade' }).click();
      await fill('Accepted (kg)', '99');
      await dialog().getByRole('button', { name: 'Save grading' }).click();
      const message = await dialog().locator('.form-error').textContent();
      if (!/can't accept more/.test(message)) throw new Error(message);
      return message;
    });
    await step('PO: grade tomato with a partial rejection', async () => {
      await fill('Accepted (kg)', '95');
      const rejected = await dialog().getByLabel('Rejected (kg)').inputValue();
      await fill('Grade (optional)', 'A');
      await fill('Why was some rejected?', 'Bruised');
      must(await submit('Save grading'));
      return `rejected auto-filled ${rejected}`;
    });
    await step('PO: grade onion (rate prefilled from the PO)', async () => {
      await detail().locator('tr:has-text("Onion")').getByRole('button', { name: 'Grade' }).click();
      const rate = await dialog().getByLabel(/Rate paid per kg/).inputValue();
      must(await submit('Save grading'));
      await page.waitForFunction(() => /Graded/.test(document.querySelector('.detail .key-values').textContent));
      return `rate ${rate}`;
    });
    await step('PO: pay the tomato lot in full', async () => {
      await detail().locator('tr:has-text("Tomato")').getByRole('button', { name: 'Pay' }).click();
      const amount = await dialog().getByLabel('Amount (INR)').inputValue();
      must(await submit('Record payment'));
      await page.waitForFunction(() => /Paid ₹/.test(document.querySelector('.detail').textContent));
      const row = (await detail().locator('table').nth(1).locator('tr:has-text("Tomato")').textContent()).replace(/\s+/g, ' ');
      return `prefilled ${amount}; ${row}`;
    });
    await page.screenshot({ path: path.join(OUT, 'e2e-2-procurement.png'), fullPage: true });

    await step('PO over ₹50,000: approval requested, approved, finalized', async () => {
      await page.getByRole('button', { name: 'New purchase order' }).click();
      await choose('Farmer', 'Lakshmi Devi');
      await dialog().getByLabel('Line 1 product').selectOption({ label: 'Tomato' });
      await dialog().getByLabel(/Line 1 quantity/).fill('3000');
      await dialog().getByLabel(/Line 1 indicative rate/).fill('20');
      must(await submit('Raise purchase order'));
      await page.waitForFunction(() => /To confirm/.test(document.querySelector('.detail')?.textContent ?? ''));
      await detail().getByRole('button', { name: 'Confirm', exact: true }).click();
      must(await submit('Confirm'));
      await page.waitForFunction(() => /Needs approval/.test(document.querySelector('.detail').textContent));
      // The owner raised it, so the owner can't decide it.
      await page.waitForFunction(() => /You raised it/.test(document.querySelector('.detail').textContent));
      if ((await detail().getByRole('button', { name: 'Approve' }).count()) > 0) throw new Error('Approve offered to the requester');
      // The ops manager's purchase_order limit (₹1,00,000) covers it.
      const ops = await apiLogin('ops-manager@dev.morbeez.local');
      const owner = await apiLogin('owner@dev.morbeez.local');
      const pos = await api(owner, 'GET', '/procurement/purchase-orders?status=placed');
      const po = pos.body.items.find((p) => p.approvalRequestId);
      const request = await api(ops, 'GET', `/approval-requests/${po.approvalRequestId}`);
      const decided = await api(ops, 'POST', `/approval-requests/${po.approvalRequestId}/approve`, { version: request.body.version, note: 'Season stock-up' });
      if (decided.status >= 300) throw new Error(JSON.stringify(decided.body));
      await page.reload();
      await page.locator('.row-selectable').first().click();
      await page.waitForFunction(() => /Approved/.test(document.querySelector('.detail')?.textContent ?? ''));
      await detail().getByRole('button', { name: 'Confirm purchase order' }).click();
      await page.waitForFunction(() => /Awaiting produce/.test(document.querySelector('.detail .key-values').textContent));
    });

    // ---------------- Inventory ----------------
    await page.goto(`${BASE}/inventory`);
    // Wait for inventory rows specifically: the previous page's purchase-order rows are also .row-selectable.
    await page.waitForSelector('.row-selectable:has-text("Onion")');
    await step('inventory: graded stock shows as available', async () => {
      const rows = (await page.locator('.row-selectable').allTextContents()).map((t) => t.replace(/\s+/g, ' '));
      if (!rows.some((r) => /Tomato.*95 kg/.test(r)) || !rows.some((r) => /Onion.*50 kg/.test(r))) throw new Error(rows.join(' | '));
      return rows.join(' | ');
    });
    await step('inventory: record shrinkage on tomato', async () => {
      await page.locator('.row-selectable:has-text("Tomato")').click();
      await detail().getByRole('button', { name: 'Shrinkage' }).click();
      await fill('Quantity (kg)', '2');
      await fill('Reason (optional)', 'Trimming');
      must(await submit('Record shrinkage'));
      await page.waitForFunction(() => /93 kg/.test(document.querySelector('.row-selectable')?.parentElement.textContent ?? ''));
    });
    await step('inventory: move onion to the cold room', async () => {
      await page.locator('.row-selectable:has-text("Onion")').click();
      await page.waitForFunction(() => /Onion/.test(document.querySelector('.detail .panel-title').textContent));
      await detail().getByRole('button', { name: 'Move' }).click();
      await choose('Move to', 'Cold room');
      must(await submit('Move'));
      await page.waitForFunction(() => /Cold room/.test(document.querySelector('.detail').textContent));
    });
    await page.screenshot({ path: path.join(OUT, 'e2e-3-inventory.png'), fullPage: true });

    // ---------------- Orders ----------------
    await page.goto(`${BASE}/orders`);
    await page.waitForSelector('.panel');
    await step('order: create with list price and a negotiated rate', async () => {
      await page.getByRole('button', { name: 'New order' }).click();
      await choose('Customer', 'Hotel Sagar');
      await page.waitForFunction(() => /Credit available/.test(document.querySelector('dialog[open]').textContent));
      const credit = (await dialog().locator('.action-note').textContent()).replace(/\s+/g, ' ');
      await dialog().getByLabel('Line 1 product').selectOption({ label: 'Tomato' });
      await dialog().getByLabel(/Line 1 quantity/).fill('50');
      await dialog().getByRole('button', { name: 'Add a line' }).click();
      await dialog().getByLabel('Line 2 product').selectOption({ label: 'Onion' });
      await dialog().getByLabel(/Line 2 quantity/).fill('50');
      await dialog().getByLabel(/Line 2 rate/).fill('28');
      must(await submit('Place order'));
      await page.waitForFunction(() => /To confirm/.test(document.querySelector('.detail')?.textContent ?? ''));
      const lines = (await detail().locator('tbody').textContent()).replace(/\s+/g, ' ');
      if (!/₹32/.test(lines) || !/₹28/.test(lines)) throw new Error(lines);
      return `${credit.slice(0, 60)}… | ${lines}`;
    });
    await step('order: confirm reserves stock', async () => {
      await detail().getByRole('button', { name: 'Confirm order' }).click();
      must(await submit('Confirm order'));
      await page.waitForFunction(() => /Confirmed/.test(document.querySelector('.detail .key-values').textContent));
    });
    await page.screenshot({ path: path.join(OUT, 'e2e-4-orders.png'), fullPage: true });

    // ---------------- Trips ----------------
    await page.goto(`${BASE}/logistics`);
    await page.waitForSelector('.panel');
    await step('trip: plan with a cash advance', async () => {
      await page.getByRole('button', { name: 'Plan a trip' }).click();
      await choose('Vehicle', 'MH12AB4521');
      await choose('Driver', 'Suresh Kale');
      await fill('Cash advance (INR, optional)', '1000');
      must(await submit('Plan trip'));
      await page.waitForFunction(() => /Planned/.test(document.querySelector('.detail')?.textContent ?? ''));
    });
    await step('trip: start is disabled with no stops', async () => {
      if (!(await detail().getByRole('button', { name: 'Start trip' }).isDisabled())) throw new Error('enabled');
    });
    await step('trip: add the confirmed order as a delivery', async () => {
      await detail().getByRole('button', { name: 'Add delivery' }).click();
      const options = await dialog().getByLabel('Order').locator('option').allTextContents();
      await dialog().getByLabel('Order').selectOption({ index: 1 });
      must(await submit('Add delivery'));
      await page.waitForFunction(() => /0 of 1 done/.test(document.querySelector('.detail').textContent));
      return options.slice(1).join(', ');
    });
    await step('trip: start', async () => {
      await detail().getByRole('button', { name: 'Start trip' }).click();
      must(await submit('Start trip'));
      await page.waitForFunction(() => /On the road/.test(document.querySelector('.detail .key-values').textContent));
    });
    await step('trip: record a fuel expense', async () => {
      await detail().getByRole('button', { name: 'Record expense' }).click();
      await fill('Amount (INR)', '400');
      must(await submit('Record expense'));
      await page.waitForFunction(() => /Fuel/.test(document.querySelector('.detail').textContent));
    });
    await step('driver delivers with proof (driver app, via API)', async () => {
      const token = await apiLogin('owner@dev.morbeez.local');
      const trips = await api(token, 'GET', '/logistics/trips?status=in_progress');
      const trip = trips.body.items[0];
      const stops = await api(token, 'GET', `/logistics/trips/${trip.id}/stops`);
      const r = await api(token, 'POST', `/logistics/trips/${trip.id}/stops/${stops.body[0].id}/complete-delivery`, {
        recipientName: 'Kitchen manager',
        signatureData: 'data:image/png;base64,iVBORw0KGgo=',
      });
      if (r.status >= 300) throw new Error(JSON.stringify(r.body));
      await page.reload();
      await page.locator('.row-selectable').first().click();
      await page.waitForFunction(() => /1 of 1 done/.test(document.querySelector('.detail')?.textContent ?? ''));
      return `stop ${r.body.status}`;
    });
    await step('trip: complete', async () => {
      await detail().getByRole('button', { name: 'Complete trip' }).click();
      must(await submit('Complete trip'));
      await page.waitForFunction(() => /To reconcile/.test(document.querySelector('.detail .key-values').textContent));
    });
    await step('trip: the owner sees the handover and every check', async () => {
      await page.waitForSelector('.closure .checklist');
      const text = (await page.locator('.closure').textContent()).replace(/\s+/g, ' ');
      for (const want of ['Cash to hand over', 'Money handover', 'Deliveries', 'Procurement']) {
        if (!text.includes(want)) throw new Error(`missing "${want}": ${text.slice(0, 400)}`);
      }
    });
    await step('trip: closing ₹50 short is an exception that needs a reason', async () => {
      await detail().getByRole('button', { name: 'Count cash & close' }).click();
      const expected = await dialog().getByLabel(/Cash received/).inputValue();
      await fill(/Cash received/, '550');
      const hint = await dialog().locator('.field-hint').first().textContent();
      if (!/₹50(\.00)? short/.test(hint)) throw new Error(hint);
      await fill(/Reason for approving/, 'Driver to repay');
      must(await submit('Approve with exception & close'));
      await page.waitForFunction(() => /Approved with exception/.test(document.querySelector('.detail').textContent));
      await page.waitForFunction(() => /short/.test(document.querySelector('.detail').textContent));
      return `expected ${expected}; preview "${hint}"`;
    });
    await page.screenshot({ path: path.join(OUT, 'e2e-5-trips.png'), fullPage: true });

    // ---------------- Orders after delivery ----------------
    await page.goto(`${BASE}/orders`);
    await page.waitForSelector('.row-selectable');
    await step('order shows delivered', async () => {
      const badge = await page.locator('.row-selectable:has-text("Hotel Sagar") .badge').first().textContent();
      if (badge !== 'Delivered') throw new Error(badge);
    });

    // ---------------- Finance ----------------
    await page.goto(`${BASE}/finance#receivables`);
    await page.waitForSelector('.figures');
    await step('finance: receivable from the delivered order', async () => {
      await page.waitForSelector('tr:has-text("Hotel Sagar")');
      const row = (await page.locator('tr:has-text("Hotel Sagar")').textContent()).replace(/\s+/g, ' ');
      // 50 × 32 + 50 × 28 = 3,000
      if (!/₹3,000/.test(row)) throw new Error(row);
      return row;
    });
    await step('finance: record a part payment against the invoice', async () => {
      await page.locator('tr:has-text("Hotel Sagar")').getByRole('button', { name: 'Record payment' }).click();
      await page.waitForFunction(() => document.querySelectorAll('dialog[open] .cell-input').length > 0);
      await fill('Amount received (INR)', '1200');
      await choose('Method', 'UPI');
      await fill('Reference (optional)', 'UPI-8812');
      must(await submit('Record payment'));
      await page.waitForFunction(() => /₹1,800/.test(document.querySelector('tr.row-selectable, tbody')?.closest('table')?.textContent ?? document.body.textContent));
      const row = (await page.locator('tr:has-text("Hotel Sagar")').textContent()).replace(/\s+/g, ' ');
      return row;
    });
    await step('finance: payables show the unpaid onion lot', async () => {
      await page.getByRole('button', { name: 'Farmer payables' }).click();
      await page.waitForSelector('.row-selectable:has-text("Ramesh Patil")');
      const row = (await page.locator('.row-selectable:has-text("Ramesh Patil")').textContent()).replace(/\s+/g, ' ');
      // 50 × 18 = 900
      if (!/₹900/.test(row)) throw new Error(row);
      return row;
    });
    await step('finance: pay the farmer, oldest-first by default', async () => {
      await page.locator('.row-selectable:has-text("Ramesh Patil")').click();
      await detail().getByRole('button', { name: 'Pay Ramesh Patil' }).click();
      await page.waitForFunction(() => document.querySelectorAll('dialog[open] .cell-input').length > 0);
      await fill('Amount paid (INR)', '900');
      must(await submit('Record payment'));
      await page.waitForFunction(() => /Every graded lot has been paid|₹0/.test(document.querySelector('.panel').parentElement.textContent));
    });
    await step('finance: cash flow lists the movements', async () => {
      await page.getByRole('button', { name: 'Cash flow' }).click();
      await page.waitForSelector('text=Latest movements');
      const figures = (await page.locator('.figures').textContent()).replace(/\s+/g, ' ');
      const kinds = await page.locator('table .badge').allTextContents();
      if (!kinds.includes('From customer') || !kinds.includes('To farmer') || !kinds.includes('Trip expense')) throw new Error(kinds.join(','));
      return figures;
    });
    await step('finance: trip cash shows the short reconciliation', async () => {
      await page.getByRole('button', { name: 'Trip cash' }).click();
      await page.waitForSelector('text=Recently reconciled');
      const text = (await page.locator('.panel:has-text("Recently reconciled")').textContent()).replace(/\s+/g, ' ');
      if (!/₹50 short/.test(text)) throw new Error(text);
    });
    await page.screenshot({ path: path.join(OUT, 'e2e-6-finance.png'), fullPage: true });

    await step('customer detail reflects invoice and payment', async () => {
      await page.goto(`${BASE}/customers`);
      await page.locator('.row-selectable:has-text("Hotel Sagar")').click();
      await page.waitForFunction(() => /Credit available.*₹/.test(document.querySelector('.detail').textContent.replace(/\s+/g, ' ')));
      const text = await detailText();
      if (!/Invoiced to date\s*₹3,000/.test(text) || !/Collected to date\s*₹1,200/.test(text)) throw new Error(text.slice(0, 300));
      return text.match(/Invoiced.*?Last payment/)?.[0];
    });

    // ---------------- Phone width, dialog open ----------------
    await step('phone: dialog fits a 390px screen without sideways scroll', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${BASE}/orders`);
      await page.getByRole('button', { name: 'New order' }).click();
      await page.waitForSelector('dialog[open]');
      const box = await dialog().boundingBox();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await page.screenshot({ path: path.join(OUT, 'e2e-7-phone-dialog.png') });
      await page.keyboard.press('Escape');
      await page.waitForSelector('dialog[open]', { state: 'detached' });
      if (overflow > 0 || box.width > 390) throw new Error(`overflow ${overflow}, dialog ${box.width}`);
      return `dialog ${Math.round(box.width)}px; Escape closes`;
    });
    await page.setViewportSize({ width: 1440, height: 1000 });

    // ---------------- Roles ----------------
    for (const [email, expectations] of [
      ['accountant@dev.morbeez.local', { orders: false, payment: true }],
      // The dev seed gives the ops manager no order or finance permissions.
      ['ops-manager@dev.morbeez.local', { orders: false, payment: false }],
    ]) {
      const c2 = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const p2 = await c2.newPage();
      await p2.goto(`${BASE}/login`);
      await p2.fill('#login', email);
      await p2.fill('#password', PASSWORD);
      await p2.click('button[type=submit]');
      await p2.waitForURL((u) => !/\/login/.test(u.toString()));
      await step(`${email.split('@')[0]}: action buttons follow permissions`, async () => {
        await p2.goto(`${BASE}/orders`);
        await p2.waitForSelector('.panel');
        await p2.waitForTimeout(800);
        const newOrder = await p2.getByRole('button', { name: 'New order' }).count();
        await p2.goto(`${BASE}/finance`);
        await p2.waitForTimeout(1500);
        const pay = await p2.getByRole('button', { name: 'Record payment' }).count();
        const got = { orders: newOrder > 0, payment: pay > 0 };
        if (got.orders !== expectations.orders || got.payment !== expectations.payment) {
          throw new Error(`got ${JSON.stringify(got)}, expected ${JSON.stringify(expectations)}`);
        }
        return JSON.stringify(got);
      });
      await c2.close();
    }
  } catch (e) {
    check('script', false, e.message.split('\n')[0]);
  } finally {
    const relevant = errors.filter((e) => !/favicon/.test(e));
    check('no browser console errors', relevant.length === 0, relevant.slice(0, 3).join(' | '));
    console.log(results.join('\n'));
    console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
    await browser.close();
  }
})();
