// Tax screens in the real owner app, after tax-e2e.js has configured GST
// and TDS and produced taxed invoices, deductions, a challan and an IRN.
const { BASE, PASSWORD, launchBrowser } = require('../lib/env');
const path = require('path');

const OUT = process.env.E2E_SHOTS_DIR || path.join(__dirname, '..', '.shots');
const results = [];
const check = (name, ok, detail = '') => {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`;
  results.push(line);
  console.log(line);
};

async function signIn(browser, email, viewport = { width: 1440, height: 1000 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/login`);
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !/\/login/.test(u.toString()));
  return { page, errors };
}

(async () => {
  const browser = await launchBrowser();
  const { page, errors } = await signIn(browser, 'owner@dev.morbeez.local');
  const dialog = () => page.locator('dialog[open]');
  const tab = (name) => page.getByRole('button', { name, exact: true }).click();
  const text = async (sel) => (await page.locator(sel).first().textContent()).replace(/\s+/g, ' ').trim();
  async function step(name, fn) {
    try {
      check(name, true, (await fn()) ?? '');
    } catch (e) {
      check(name, false, e.message.split('\n')[0]);
      await page.screenshot({ path: path.join(OUT, `tax-fail-${results.length}.png`), fullPage: true }).catch(() => {});
    }
  }
  async function submit(label) {
    await dialog().getByRole('button', { name: label, exact: true }).click();
    try {
      await page.waitForSelector('dialog[open]', { state: 'detached', timeout: 10000 });
    } catch {
      const msg = await dialog().locator('.form-error').textContent().catch(() => 'dialog stayed open');
      await dialog().getByRole('button', { name: 'Cancel', exact: true }).click().catch(() => {});
      throw new Error(msg);
    }
  }

  await step('nav: Tax opens on the GST invoice register', async () => {
    await page.goto(`${BASE}/dashboard`);
    await page.getByRole('link', { name: 'Tax', exact: true }).click();
    await page.waitForSelector('text=GST invoice register');
    await page.waitForSelector('.table tbody tr .link-button');
    return await text('.page-subtitle');
  });
  await step('register: tax invoice with CGST+SGST, IGST sale, and e-invoice statuses', async () => {
    const rows = (await page.locator('.table tbody tr').allTextContents()).map((r) => r.replace(/\s+/g, ' '));
    const cancelled = rows.find((r) => /IRN cancelled/.test(r));
    const igst = rows.find((r) => /Green Leaf/.test(r));
    if (!cancelled || !/14\.00/.test(cancelled) || !/614\.00/.test(cancelled)) throw new Error(cancelled);
    if (!igst || !/Not applicable/.test(igst) || !/7\.00/.test(igst)) throw new Error(igst);
    return `${rows.length} invoices`;
  });
  await step('register: expanding the cancelled one shows its IRN', async () => {
    const row = page.locator('tr', { hasText: 'IRN cancelled' }).first();
    await row.locator('.link-button').click();
    await page.waitForSelector('.journal-detail dd.st-number');
    return (await text('.journal-detail dd.st-number')).slice(0, 16) + '…';
  });
  await page.screenshot({ path: path.join(OUT, 'tax-1-invoices.png'), fullPage: true });

  await step('GSTR-1: B2B, B2CS, nil and HSN tables', async () => {
    await tab('GSTR-1');
    await page.waitForSelector('text=B2B — sales to registered buyers');
    const body = (await page.locator('.panel').last().textContent()).replace(/\s+/g, ' ');
    for (const needle of ['07122000', '29 · Karnataka', '320.00', 'HSN summary — B2B']) if (!body.includes(needle)) throw new Error(`missing ${needle}`);
  });
  await page.screenshot({ path: path.join(OUT, 'tax-2-gstr1.png'), fullPage: true });

  await step('GSTR-3B: tax payable figures', async () => {
    await tab('GSTR-3B');
    await page.waitForSelector('text=3.1 Outward supplies');
    return (await text('.figures')).slice(0, 120);
  });

  await step('TDS: register shows 194Q deposited and rent to deposit', async () => {
    await tab('TDS');
    await page.waitForSelector('text=Deductions, Q');
    const rows = (await page.locator('.statement tbody tr').allTextContents()).map((r) => r.replace(/\s+/g, ' '));
    if (!rows.some((r) => /194Q.*Deposited/.test(r)) || !rows.some((r) => /194I\(b\).*Vashi Market Landlord.*To deposit/.test(r))) throw new Error(rows.join(' | '));
    return `${rows.length} deductions`;
  });
  await step('TDS: deposit the rent TDS through the challan form', async () => {
    await page.getByRole('button', { name: 'Record deposit (challan)' }).click();
    await dialog().getByLabel('BSR code').fill('0510308');
    await dialog().getByLabel('Challan serial number').fill('00456');
    await submit('Record deposit');
    await page.waitForFunction(() => /Waiting to deposit \(all periods\)\s*₹0/.test(document.querySelector('.figures').textContent));
  });
  await page.screenshot({ path: path.join(OUT, 'tax-3-tds.png'), fullPage: true });

  await step('HSN: products resolve to their rules', async () => {
    await tab('Products & HSN');
    await page.waitForSelector('text=07122000');
    const rows = (await page.locator('.table tbody tr').allTextContents()).map((r) => r.replace(/\s+/g, ' '));
    if (!rows.some((r) => /Onion.*07122000.*5% GST/.test(r)) || !rows.some((r) => /Tomato.*07020000.*Exempt/.test(r))) throw new Error(rows.join(' | '));
  });

  await step('settings: add a GST rule from a date', async () => {
    await tab('Settings & rates');
    await page.waitForSelector('text=GST rates by HSN');
    await page.getByRole('button', { name: 'Add a GST rule' }).click();
    await dialog().getByLabel('HSN / SAC code').fill('0710');
    await dialog().getByLabel('Description').fill('Frozen vegetables');
    await dialog().getByLabel('Starts on').fill('2026-04-01');
    await dialog().getByLabel('GST rate (%)').fill('5');
    await submit('Add rule');
    await page.waitForFunction(() => [...document.querySelectorAll('tr')].some((r) => /Frozen vegetables/.test(r.textContent) && /Yours/.test(r.textContent)));
  });
  await step('settings: registration shows the GSTIN and TDS section', async () => {
    const kv = await text('.key-values');
    if (!/27AAPFU0939F1ZV/.test(kv) || !/Section 194Q/.test(kv)) throw new Error(kv.slice(0, 200));
  });
  await page.screenshot({ path: path.join(OUT, 'tax-4-settings.png'), fullPage: true });

  await step('phone width: no sideways page scroll', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await tab('GST invoices');
    await page.waitForSelector('text=GST invoice register');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.screenshot({ path: path.join(OUT, 'tax-5-phone.png'), fullPage: true });
    if (overflow > 0) throw new Error(`overflow ${overflow}px`);
  });

  const acc = await signIn(browser, 'accountant@dev.morbeez.local');
  await step('accountant: files (deposit, TDS on payment) but cannot edit settings', async () => {
    await acc.page.goto(`${BASE}/tax#settings`);
    await acc.page.waitForSelector('text=Registration');
    await acc.page.waitForTimeout(800);
    const edit = await acc.page.getByRole('button', { name: 'Edit registration' }).count();
    const addRule = await acc.page.getByRole('button', { name: 'Add a GST rule' }).count();
    await acc.page.getByRole('button', { name: 'TDS', exact: true }).click();
    await acc.page.waitForSelector('text=Deductions, Q');
    const tdsPayment = await acc.page.getByRole('button', { name: 'TDS on a payment' }).count();
    if (edit || addRule || !tdsPayment) throw new Error(JSON.stringify({ edit, addRule, tdsPayment }));
  });
  const ops = await signIn(browser, 'ops-manager@dev.morbeez.local');
  await step('ops manager: no Tax link and a plain no-access page', async () => {
    // The menu shows every link until the session loads — count once it has.
    await ops.page.waitForSelector('.topbar-email');
    const link = await ops.page.getByRole('link', { name: 'Tax', exact: true }).count();
    await ops.page.goto(`${BASE}/tax`);
    await ops.page.waitForSelector('text=Your role doesn');
    if (link) throw new Error('link shown');
  });

  const all = [...errors, ...acc.errors, ...ops.errors].filter((e) => !/favicon/.test(e));
  check('no browser console errors', all.length === 0, all.slice(0, 3).join(' | '));
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  await browser.close();
})();
