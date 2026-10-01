// Crate screens in the real owner app, after crates-e2e.js.
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
  await page.fill('#login', email);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !/\/login/.test(u.toString()));
  return { page, errors };
}

(async () => {
  const browser = await launchBrowser();
  const { page, errors } = await signIn(browser, 'owner@dev.morbeez.local');
  const dialog = () => page.locator('dialog[open]');
  const detail = () => page.locator('.detail');
  const tab = (p, name) => p.getByRole('group', { name: 'Crates section' }).getByRole('button', { name, exact: true }).click();
  async function step(name, fn, p = page) {
    try {
      check(name, true, (await fn()) ?? '');
    } catch (e) {
      check(name, false, e.message.split('\n')[0]);
      await p.screenshot({ path: path.join(OUT, `cr-fail-${results.length}.png`), fullPage: true }).catch(() => {});
      await p.locator('dialog[open]').getByRole('button', { name: 'Cancel', exact: true }).click().catch(() => {});
    }
  }
  async function submit(p, label) {
    const d = p.locator('dialog[open]');
    await d.getByRole('button', { name: label, exact: true }).click();
    try {
      await p.waitForSelector('dialog[open]', { state: 'detached', timeout: 10000 });
    } catch {
      const msg = await d.locator('.form-error').textContent().catch(() => 'dialog stayed open');
      throw new Error(msg);
    }
  }
  const rowsText = async (p = page) => (await p.locator('.table tbody tr').allTextContents()).map((r) => r.replace(/\s+/g, ' '));
  const detailText = async (p = page) => (await p.locator('.detail').textContent()).replace(/\s+/g, ' ');

  await step('overview: counts by type and holder, alerts most urgent first', async () => {
    await page.goto(`${BASE}/crates`);
    await page.waitForSelector('text=Plastic crate, 20 kg');
    const rows = await rowsText();
    if (!rows.some((r) => /PL20 · Plastic crate, 20 kg/.test(r))) throw new Error(rows.join(' | '));
    const first = (await page.locator('.alert-list li').first().textContent()).replace(/\s+/g, ' ');
    if (!/Act now.*Hotel Sagar.*over the limit of 15/.test(first)) throw new Error(first);
  });
  await page.screenshot({ path: path.join(OUT, 'cr-1-overview.png'), fullPage: true });

  await step('an alert opens the customer: balance, age, the loss invoiced', async () => {
    await page.locator('.alert-list li').first().getByRole('button', { name: 'Hotel Sagar' }).click();
    await page.waitForSelector('.detail >> text=History');
    const t = await detailText();
    if (!/26 crates/.test(t) || !/Invoiced/.test(t) || !/CRT-000001/.test(t) || !/Limit15/.test(t.replace(/\s/g, ''))) throw new Error(t.slice(0, 300));
  });

  await step('record a return from the customer', async () => {
    await detail().getByRole('button', { name: 'Record a return' }).click();
    await dialog().getByLabel('PL20 crates').fill('6');
    await submit(page, 'Record');
    await page.waitForFunction(() => /20 crates/.test(document.querySelector('.detail').textContent));
  });
  await page.screenshot({ path: path.join(OUT, 'cr-2-customer.png'), fullPage: true });

  await step('a trip: load, leave crates at a stop, unload the rest', async () => {
    await tab(page, 'Trips');
    const select = page.getByLabel('Trip', { exact: true });
    await page.waitForFunction(() => document.querySelectorAll('select option').length > 1);
    const value = await select.locator('option', { hasText: 'MH12AB4521' }).first().getAttribute('value');
    await select.selectOption(value);
    await page.waitForSelector('text=Left on the road');
    await page.getByRole('button', { name: 'Load from yard' }).click();
    await dialog().getByLabel('PL20 crates').fill('10');
    await submit(page, 'Record');
    await page.locator('tbody tr').filter({ hasText: /Pickup|Delivery/ }).first().getByRole('button', { name: 'Record crates' }).click();
    await dialog().getByLabel('PL20 left there').fill('3');
    await submit(page, 'Record');
    await page.getByRole('button', { name: 'Unload to yard' }).click();
    await dialog().getByLabel('PL20 crates').fill('7');
    await submit(page, 'Record');
    await page.waitForFunction(() => /On MH12AB4521 now\s*0/.test(document.querySelector('.figures').textContent));
    return (await page.locator('.figures').textContent()).replace(/\s+/g, ' ');
  });
  await page.screenshot({ path: path.join(OUT, 'cr-3-trip.png'), fullPage: true });

  await step('movements: today\'s log, the correction marked', async () => {
    await tab(page, 'Movements');
    await page.waitForSelector('.table >> text=Correction');
    const rows = await rowsText();
    if (!rows.some((r) => /Correction/.test(r)) || !rows.some((r) => /Reversed/.test(r)) || !rows.some((r) => /Bought.*Bill 88/.test(r))) throw new Error(rows.slice(0, 5).join(' | '));
    return `${rows.length} rows`;
  });

  await step('losses: written off and charged', async () => {
    await tab(page, 'Losses');
    await page.waitForSelector('.table >> text=Written off');
    const rows = await rowsText();
    if (!rows.some((r) => /Hotel Sagar.*4 PL20.*Invoiced CRT-000001.*₹850/.test(r)) || !rows.some((r) => /Yard.*5 PL20.*Written off/.test(r))) throw new Error(rows.join(' | '));
  });

  await step('settings: add a crate type', async () => {
    await tab(page, 'Settings');
    await page.waitForSelector('text=When crates are overdue');
    await page.getByRole('button', { name: 'Add a crate type' }).click();
    await dialog().getByLabel('Code').fill('tray');
    await dialog().getByLabel('Name').fill('Cardboard tray');
    await dialog().getByLabel('Replacement cost').fill('15');
    await submit(page, 'Save');
    await page.waitForSelector('text=TRAY · Cardboard tray');
  });
  await page.screenshot({ path: path.join(OUT, 'cr-4-settings.png'), fullPage: true });

  const ops = await signIn(browser, 'ops-manager@dev.morbeez.local');
  await step(
    'ops manager: records crates, cannot charge or set limits',
    async () => {
      await ops.page.goto(`${BASE}/crates#customers`);
      await ops.page.locator('.row-selectable', { hasText: 'Hotel Sagar' }).click();
      await ops.page.waitForSelector('.detail >> text=History');
      const buttons = await ops.page.locator('.detail .action-bar button').allTextContents();
      if (!buttons.includes('Record a return') || buttons.includes('Charge for lost crates') || buttons.includes('Set a limit')) throw new Error(buttons.join(', '));
    },
    ops.page,
  );
  const acc = await signIn(browser, 'accountant@dev.morbeez.local');
  await step(
    'accountant: charges for lost crates, does not move them',
    async () => {
      await acc.page.goto(`${BASE}/crates#customers`);
      await acc.page.locator('.row-selectable', { hasText: 'Hotel Sagar' }).click();
      await acc.page.waitForSelector('.detail >> text=History');
      const buttons = await acc.page.locator('.detail .action-bar button').allTextContents();
      if (buttons.includes('Record a return') || !buttons.includes('Charge for lost crates')) throw new Error(buttons.join(', '));
      const record = await acc.page.getByRole('button', { name: 'Record crates' }).count();
      if (record) throw new Error('record button shown');
    },
    acc.page,
  );

  await step('phone width: no sideways page scroll', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await tab(page, 'Overview');
    await page.waitForSelector('text=Plastic crate, 20 kg');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.screenshot({ path: path.join(OUT, 'cr-5-phone.png'), fullPage: true });
    if (overflow > 0) throw new Error(`overflow ${overflow}px`);
  });

  const all = [...errors, ...ops.errors, ...acc.errors].filter((e) => !/favicon/.test(e));
  check('no browser console errors', all.length === 0, all.slice(0, 3).join(' | '));
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  await browser.close();
})();
