// Workforce screens in the real owner app, after workforce-e2e.js.
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
  const tab = (p, name) => p.getByRole('button', { name, exact: true }).click();
  async function step(name, fn, p = page) {
    try {
      check(name, true, (await fn()) ?? '');
    } catch (e) {
      check(name, false, e.message.split('\n')[0]);
      await p.screenshot({ path: path.join(OUT, `wf-fail-${results.length}.png`), fullPage: true }).catch(() => {});
    }
  }
  async function submit(p, label) {
    const d = p.locator('dialog[open]');
    await d.getByRole('button', { name: label, exact: true }).click();
    try {
      await p.waitForSelector('dialog[open]', { state: 'detached', timeout: 10000 });
    } catch {
      const msg = await d.locator('.form-error').textContent().catch(() => 'dialog stayed open');
      await d.getByRole('button', { name: 'Cancel', exact: true }).click().catch(() => {});
      throw new Error(msg);
    }
  }
  const rowsText = async (p = page) => (await p.locator('.table tbody tr').allTextContents()).map((r) => r.replace(/\s+/g, ' '));
  const today = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()));
  const monthStart = `${today.slice(0, 8)}01`;

  await step('workers: list with pay and advance status', async () => {
    await page.goto(`${BASE}/workforce`);
    await page.waitForSelector('text=Raju Shinde');
    const rows = await rowsText();
    if (!rows.some((r) => /Raju Shinde.*₹3 per crate/.test(r)) || !rows.some((r) => /Suresh Kale.*₹450 a day/.test(r))) throw new Error(rows.join(' | '));
  });

  await step('add a worker, set employment details and an hourly rate', async () => {
    await page.getByRole('button', { name: 'Add a worker' }).click();
    await dialog().getByLabel('Name').fill('Meena Pawar');
    await dialog().getByLabel('Role').selectOption('warehouse');
    await submit(page, 'Add worker');
    await page.waitForSelector('.detail >> text=Meena Pawar');
    await page.locator('.detail').getByRole('button', { name: 'Edit employment details' }).click();
    await dialog().getByLabel('Employment').selectOption('casual');
    await dialog().getByLabel('Joined on').fill(monthStart);
    await submit(page, 'Save');
    await page.locator('.detail').getByRole('button', { name: 'New pay rate' }).click();
    await dialog().getByLabel('Paid', { exact: true }).selectOption('hourly');
    await dialog().getByLabel('Rate (INR)').fill('70');
    await dialog().getByLabel('Starts on').fill(monthStart);
    await submit(page, 'Set rate');
    await page.waitForFunction(() => /₹70 an hour/.test(document.querySelector('.detail').textContent));
  });
  await page.screenshot({ path: path.join(OUT, 'wf-1-workers.png'), fullPage: true });

  await step('work & attendance: record 6 hours for today', async () => {
    await tab(page, 'Work & attendance');
    await page.waitForSelector('text=Work and attendance');
    await page.getByRole('button', { name: 'Record work' }).click();
    await dialog().getByLabel('Worker', { exact: true }).selectOption({ label: 'Meena Pawar' });
    await dialog().getByLabel('Work', { exact: true }).selectOption('grading');
    await dialog().getByLabel('Hours (optional)').fill('6');
    await submit(page, 'Save');
    await page.waitForFunction(() => [...document.querySelectorAll('tbody tr')].some((r) => /Meena Pawar/.test(r.textContent) && /Grading/.test(r.textContent)));
    const rows = await rowsText();
    if (!rows.some((r) => /Suresh Kale.*Trip.*Settlement #/.test(r))) throw new Error('trip assignment not shown as settled');
    return `${rows.length} rows`;
  });

  await step('pay run: this month — Meena 6 h × ₹70, the others already settled', async () => {
    await tab(page, 'Pay run');
    await page.waitForSelector('text=What each worker is owed');
    await page.locator('.range-controls select').first().selectOption('month');
    await page.waitForFunction(() => /420\.00/.test(document.querySelector('.table')?.textContent ?? ''));
    const rows = await rowsText();
    if (!rows.some((r) => /Raju Shinde.*Overlaps settlement/.test(r))) throw new Error(rows.join(' | '));
    return rows.find((r) => /Meena/.test(r));
  });
  await page.screenshot({ path: path.join(OUT, 'wf-2-payrun.png'), fullPage: true });

  await step('pay run: draft; the owner, who prepared it, cannot approve', async () => {
    await page.getByRole('button', { name: /^Draft 1 settlement/ }).click();
    await page.waitForSelector('text=Draft — to approve');
    await page.locator('.row-selectable', { hasText: 'Meena Pawar' }).click();
    await page.waitForSelector('.detail >> text=Hourly wage — 6.00 h');
    const approve = page.locator('.detail').getByRole('button', { name: 'Approve' });
    if (!(await approve.isDisabled())) throw new Error('approve enabled for the preparer');
    return (await page.locator('.detail .figures').textContent()).replace(/\s+/g, ' ');
  });
  await page.screenshot({ path: path.join(OUT, 'wf-3-settlement.png'), fullPage: true });

  const acc = await signIn(browser, 'accountant@dev.morbeez.local');
  await step(
    'accountant approves and pays it',
    async () => {
      await acc.page.goto(`${BASE}/workforce#settlements`);
      await acc.page.waitForSelector('.row-selectable');
      await acc.page.locator('.row-selectable', { hasText: 'Meena Pawar' }).click();
      await acc.page.locator('.detail').getByRole('button', { name: 'Approve' }).click();
      await submit(acc.page, 'Approve');
      await acc.page.waitForSelector('.detail >> text=Approved — to pay');
      await acc.page.locator('.detail').getByRole('button', { name: 'Record payment' }).click();
      await acc.page.locator('dialog[open]').getByLabel('Reference (optional)').fill('UPI 5521');
      await submit(acc.page, 'Record payment');
      await acc.page.waitForSelector('.detail .key-values >> text=Paid');
      const kv = (await acc.page.locator('.detail .key-values').textContent()).replace(/\s+/g, ' ');
      if (!/UPI 5521/.test(kv)) throw new Error(kv);
    },
    acc.page,
  );
  await step(
    'accountant sees pay but has no rule or rate controls',
    async () => {
      await acc.page.goto(`${BASE}/workforce#rules`);
      await acc.page.waitForSelector('text=Minimum wages');
      await acc.page.waitForTimeout(600);
      const add = await acc.page.getByRole('button', { name: 'Add a minimum wage' }).count();
      if (add) throw new Error('can add minimum wage');
    },
    acc.page,
  );

  await step('advances: Raju\'s advance recovered', async () => {
    await tab(page, 'Advances');
    await page.waitForSelector('text=Outstanding advances');
    const rows = await rowsText();
    if (!rows.some((r) => /Raju Shinde.*500\.00.*500\.00/.test(r))) throw new Error(rows.join(' | '));
  });
  await step('wage rules: minimum wages and incentives listed', async () => {
    await tab(page, 'Wage rules');
    await page.waitForSelector('text=Semi-skilled');
    const body = (await page.locator('.stack').textContent()).replace(/\s+/g, ' ');
    if (!/₹550/.test(body) || !/₹150 for each trip beyond 1/.test(body)) throw new Error('missing rule text');
  });
  await page.screenshot({ path: path.join(OUT, 'wf-4-rules.png'), fullPage: true });

  const ops = await signIn(browser, 'ops-manager@dev.morbeez.local');
  await step(
    'ops manager: records work and drafts pay, but cannot approve or pay',
    async () => {
      await ops.page.goto(`${BASE}/workforce#settlements`);
      await ops.page.waitForSelector('.row-selectable');
      await ops.page.locator('.row-selectable').first().click();
      await ops.page.waitForSelector('.detail .key-values');
      const buttons = await ops.page.locator('.detail .action-bar button').count();
      if (buttons) throw new Error(`${buttons} action button(s)`);
    },
    ops.page,
  );

  await step('phone width: no sideways page scroll', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await tab(page, 'Workers');
    await page.waitForSelector('text=Raju Shinde');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.screenshot({ path: path.join(OUT, 'wf-5-phone.png'), fullPage: true });
    if (overflow > 0) throw new Error(`overflow ${overflow}px`);
  });

  const all = [...errors, ...acc.errors, ...ops.errors].filter((e) => !/favicon/.test(e));
  check('no browser console errors', all.length === 0, all.slice(0, 3).join(' | '));
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  await browser.close();
})();
