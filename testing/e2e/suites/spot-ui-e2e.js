// Spot-sale screens in the real owner app, after spot-e2e.js.
const { BASE, PASSWORD, launchBrowser } = require('../lib/env');
const path = require('path');

const OUT = process.env.E2E_SHOTS_DIR || path.join(__dirname, '..', '.shots');
const results = [];
const check = (name, ok, detail = '') => {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`;
  results.push(line);
  console.log(line);
};

async function signIn(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/login`);
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !/\/login/.test(u.toString()));
  await page.waitForSelector('.topbar-email');
  return { page, errors };
}

(async () => {
  const browser = await launchBrowser();
  const { page, errors } = await signIn(browser, 'owner@dev.morbeez.local');
  const dialog = () => page.locator('dialog[open]');
  const tab = (p, name) => p.getByRole('group', { name: 'Spot sales section' }).getByRole('button', { name, exact: true }).click();
  async function step(name, fn, p = page) {
    try {
      check(name, true, (await fn()) ?? '');
    } catch (e) {
      check(name, false, e.message.split('\n')[0]);
      await p.screenshot({ path: path.join(OUT, `sp-fail-${results.length}.png`), fullPage: true }).catch(() => {});
    }
  }
  const rowsText = async (p = page) => (await p.locator('.table tbody tr').allTextContents()).map((r) => r.replace(/\s+/g, ' '));

  await step('sales: this month, with the figures and every status', async () => {
    await page.getByRole('link', { name: 'Spot sales', exact: true }).click();
    await page.waitForSelector('text=SS-000001');
    const rows = await rowsText();
    const figures = (await page.locator('.figures').textContent()).replace(/\s+/g, ' ');
    if (!/Sales\s*3/.test(figures) || !/₹1,400/.test(figures)) throw new Error(figures);
    for (const s of ['Completed', 'Rejected', 'Withdrawn']) if (!rows.some((r) => r.includes(s))) throw new Error(`no ${s}: ${rows.join(' | ')}`);
  });
  await page.screenshot({ path: path.join(OUT, 'sp-1-sales.png'), fullPage: true });

  await step('a sale: lines against their band, invoice, cost and margin', async () => {
    await page.locator('.row-selectable', { hasText: 'SS-000001' }).click();
    await page.waitForSelector('.detail >> text=Lines');
    const t = (await page.locator('.detail').textContent()).replace(/\s+/g, ' ');
    if (!/SPT-000001/.test(t) || !/Margin₹250/.test(t.replace(/\s/g, '')) || !/28.80 – 40.00 \(default\)/.test(t) || !/35.00 – 50.00/.test(t)) throw new Error(t.slice(0, 500));
  });
  await page.screenshot({ path: path.join(OUT, 'sp-2-sale.png'), fullPage: true });

  await step('a rejected sale shows why', async () => {
    await page.locator('.row-selectable', { hasText: 'Rejected' }).click();
    await page.waitForSelector('.detail >> text=Price not approved: Too cheap');
  });

  await step('awaiting approval: nothing left pending', async () => {
    await tab(page, 'Awaiting approval');
    await page.waitForSelector('text=No spot sales in this period.');
  });

  await step('price bands: set one for tomato', async () => {
    await tab(page, 'Price bands');
    await page.waitForSelector('text=Mandi rate');
    await page.getByRole('button', { name: 'Set a price band' }).click();
    await dialog().getByLabel('Product').selectOption({ label: 'Tomato' });
    await dialog().getByLabel('Lowest price (INR)').fill('26');
    await dialog().getByLabel('Highest price (INR, optional)').fill('38');
    await dialog().getByLabel('Starts on').fill('2026-04-01');
    await dialog().getByRole('button', { name: 'Save band', exact: true }).click();
    await page.waitForSelector('dialog[open]', { state: 'detached', timeout: 10000 });
    await page.waitForFunction(() => /Tomato/.test(document.querySelector('.table').textContent));
  });
  await page.screenshot({ path: path.join(OUT, 'sp-3-bands.png'), fullPage: true });

  const acc = await signIn(browser, 'accountant@dev.morbeez.local');
  await step(
    'accountant: sees sales, cannot set bands or record',
    async () => {
      await acc.page.goto(`${BASE}/spot-sales#bands`);
      await acc.page.waitForSelector('text=Mandi rate');
      const set = await acc.page.getByRole('button', { name: 'Set a price band' }).count();
      const rec = await acc.page.getByRole('button', { name: 'Record a spot sale' }).count();
      if (set || rec) throw new Error(`set ${set} record ${rec}`);
    },
    acc.page,
  );

  await step('phone width: no sideways page scroll', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await tab(page, 'Sales');
    await page.waitForSelector('text=SS-000001');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.screenshot({ path: path.join(OUT, 'sp-4-phone.png'), fullPage: true });
    if (overflow > 0) throw new Error(`overflow ${overflow}px`);
  });

  const all = [...errors, ...acc.errors].filter((e) => !/favicon/.test(e));
  check('no browser console errors', all.length === 0, all.slice(0, 3).join(' | '));
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  await browser.close();
})();
