// Vehicle screens in the real owner app, after fleet-e2e.js.
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
  return { page, errors };
}

(async () => {
  const browser = await launchBrowser();
  const { page, errors } = await signIn(browser, 'owner@dev.morbeez.local');
  const dialog = () => page.locator('dialog[open]');
  const detail = () => page.locator('.detail');
  const tab = (p, name) => p.getByRole('button', { name, exact: true }).click();
  async function step(name, fn, p = page) {
    try {
      check(name, true, (await fn()) ?? '');
    } catch (e) {
      check(name, false, e.message.split('\n')[0]);
      await p.screenshot({ path: path.join(OUT, `fl-fail-${results.length}.png`), fullPage: true }).catch(() => {});
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
  const rowsText = async (p = page, scope = '') => (await p.locator(`${scope} .table tbody tr`).allTextContents()).map((r) => r.replace(/\s+/g, ' '));
  const detailText = async () => (await detail().textContent()).replace(/\s+/g, ' ');
  const today = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()));
  const shift = (days) => {
    const x = new Date(`${today}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + days);
    return x.toISOString().slice(0, 10);
  };

  await step('fleet: fitness, what needs attention, ownership', async () => {
    await page.goto(`${BASE}/vehicles`);
    await page.waitForSelector('text=MH14HR7777');
    const rows = await rowsText();
    const main = rows.find((r) => /MH12AB4521/.test(r)) ?? '';
    if (!/Fit for trips/.test(main) || !/PUC certificate expires/.test(main) || !/and 1 more/.test(main)) throw new Error(main);
    if (!rows.some((r) => /MH12XY0001.*Disposed/.test(r))) throw new Error('disposed truck');
    if (!rows.some((r) => /MH14HR7777.*Hired · Eicher Pro 2049.*₹1,800.*a trip/.test(r))) throw new Error(rows.find((r) => /MH14HR/.test(r)));
  });

  await step('the running vehicle: documents renewed, service overdue, fuel log', async () => {
    await page.locator('.row-selectable', { hasText: 'MH12AB4521' }).click();
    await page.waitForSelector('.detail >> text=Documents');
    const t = await detailText();
    if (!/Maintenance overdue/.test(t) || !/Renewed/.test(t) || !/20,450 km/.test(t) || !/Oil and filters/.test(t) || !/No charge/.test(t)) throw new Error(t.slice(0, 400));
  });
  await page.screenshot({ path: path.join(OUT, 'fl-1-fleet.png'), fullPage: true });

  await step('add a vehicle, then record fuel and its insurance', async () => {
    await page.getByRole('button', { name: 'Add a vehicle' }).click();
    await dialog().getByLabel('Registration number').fill('mh12zz9999');
    await dialog().getByLabel('Capacity (kg)').fill('2500');
    await submit(page, 'Add vehicle');
    await page.waitForSelector('.detail >> h2:has-text("MH12ZZ9999")');
    await detail().getByRole('button', { name: 'Record fuel' }).click();
    await dialog().getByLabel('Litres').fill('30');
    await dialog().getByLabel('Amount (INR)').fill('2700');
    await dialog().getByLabel('Odometer (km, optional)').fill('5000');
    await submit(page, 'Record fuel');
    await page.waitForFunction(() => /5,000/.test(document.querySelector('.detail').textContent));
    await detail().getByRole('button', { name: 'Record a document' }).click();
    await dialog().getByLabel('Document').selectOption('insurance');
    await dialog().getByLabel('Valid until').fill(shift(200));
    await dialog().getByLabel('Premium or fee paid (INR, optional)').fill('15000');
    await submit(page, 'Record');
    await page.waitForFunction(() => /Insurance/.test(document.querySelector('.detail').textContent) && /Valid/.test(document.querySelector('.detail').textContent));
  });

  await step('put it on the books, then finance it', async () => {
    await detail().getByRole('button', { name: 'Put on the books' }).click();
    await dialog().getByLabel('Cost (INR)').fill('900000');
    await dialog().getByLabel('Salvage value (INR)').fill('90000');
    await dialog().getByLabel('Useful life (months)').fill('60');
    await submit(page, 'Capitalise');
    await page.waitForSelector('.detail >> text=On the books');
    await detail().getByRole('button', { name: 'Record a loan' }).click();
    await dialog().getByLabel('Lender').fill('State Bank of India');
    await dialog().getByLabel('Amount (INR)').fill('500000');
    await dialog().getByLabel('Interest (% a year)').fill('8.5');
    await dialog().getByLabel('Tenure (months)').fill('36');
    await dialog().getByLabel('First EMI on').fill(shift(30));
    await submit(page, 'Record loan');
    await page.waitForSelector('.detail >> text=State Bank of India');
    const t = await detailText();
    if (!/₹9,00,000/.test(t) || !/EMI ₹15,784/.test(t)) throw new Error(t.slice(t.indexOf('On the books'), t.indexOf('On the books') + 400));
  });
  await page.screenshot({ path: path.join(OUT, 'fl-2-vehicle.png'), fullPage: true });

  await step('loans: pay the first EMI from the loans list', async () => {
    await tab(page, 'Loans');
    await page.waitForSelector('text=Vehicle loans');
    await page.locator('tr', { hasText: 'MH12ZZ9999' }).getByRole('button', { name: 'Pay EMI' }).click();
    const desc = (await dialog().textContent()).replace(/\s+/g, ' ');
    if (!/Installment 1: interest ₹3,542, principal ₹12,242/.test(desc)) {
      await dialog().getByRole('button', { name: 'Cancel', exact: true }).click();
      throw new Error(desc.slice(0, 200));
    }
    await submit(page, 'Record payment');
    await page.waitForFunction(() => /1 of 36 paid/.test(document.querySelector('.table').textContent));
    const rows = await rowsText();
    if (!rows.some((r) => /MH12XY0001.*HDFC Bank.*2 of 60 paid/.test(r))) throw new Error(rows.join(' | '));
  });

  await step('hired vehicles: the paid bill with its TDS', async () => {
    await tab(page, 'Hired vehicles');
    await page.waitForSelector('text=Hire bills');
    await page.getByRole('button', { name: 'Paid', exact: true }).click();
    await page.waitForFunction(() => /Ravi Transport/.test(document.querySelector('.table').textContent));
    const rows = await rowsText();
    if (!rows.some((r) => /MH14HR7777.*₹9,000.*TDS ₹90.*194C/.test(r))) throw new Error(rows.join(' | '));
  });

  await step('assets: the register, disposed truck dimmed', async () => {
    await tab(page, 'Assets & depreciation');
    await page.waitForSelector('text=Vehicles on the books');
    const rows = await rowsText();
    if (!rows.some((r) => /MH12XY0001.*Disposed/.test(r)) || !rows.some((r) => /MH12ZZ9999.*Straight line.*₹9,00,000/.test(r))) throw new Error(rows.join(' | '));
    const run = await page.getByRole('button', { name: 'Run depreciation' }).count();
    if (!run) throw new Error('no run button');
  });
  await page.screenshot({ path: path.join(OUT, 'fl-3-assets.png'), fullPage: true });

  await step('cost report: this financial year, per vehicle', async () => {
    await tab(page, 'Cost report');
    await page.waitForSelector('text=What each vehicle cost');
    await page.locator('.range-controls select').first().selectOption('fy');
    await page.waitForFunction(() => /MH14HR7777/.test(document.querySelector('.table')?.textContent ?? ''));
    const rows = await rowsText();
    const main = rows.find((r) => /MH12AB4521/.test(r)) ?? '';
    if (!/450/.test(main) || !/9\.00/.test(main)) throw new Error(main);
    if (!rows.some((r) => /All vehicles/.test(r))) throw new Error('no total row');
    return main;
  });
  await page.screenshot({ path: path.join(OUT, 'fl-4-costs.png'), fullPage: true });

  await step('settings: remind 45 days ahead', async () => {
    await tab(page, 'Settings');
    await page.getByLabel('Remind about documents (days before expiry)').fill('45');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await page.waitForFunction(() => document.querySelector('.form-grid button[type=submit]')?.disabled === true);
    await page.reload();
    await page.waitForSelector('text=Fleet settings');
    const v = await page.getByLabel('Remind about documents (days before expiry)').inputValue();
    if (v !== '45') throw new Error(v);
  });

  const acc = await signIn(browser, 'accountant@dev.morbeez.local');
  await step(
    'accountant: keeps the books but does not record running costs',
    async () => {
      await acc.page.goto(`${BASE}/vehicles`);
      await acc.page.locator('.row-selectable', { hasText: 'MH12AB4521' }).click();
      await acc.page.waitForSelector('.detail >> text=Documents');
      const fuel = await acc.page.locator('.detail').getByRole('button', { name: 'Record fuel' }).count();
      const books = await acc.page.locator('.detail').getByRole('button', { name: 'Put on the books' }).count();
      const add = await acc.page.getByRole('button', { name: 'Add a vehicle' }).count();
      if (fuel || add || !books) throw new Error(`fuel ${fuel}, add ${add}, books ${books}`);
    },
    acc.page,
  );

  const ops = await signIn(browser, 'ops-manager@dev.morbeez.local');
  await step(
    'ops manager: no EMI or bill payments',
    async () => {
      await ops.page.goto(`${BASE}/vehicles#loans`);
      await ops.page.waitForSelector('text=HDFC Bank');
      const pay = await ops.page.getByRole('button', { name: 'Pay EMI' }).count();
      if (pay) throw new Error(`${pay} pay buttons`);
    },
    ops.page,
  );

  await step('phone width: no sideways page scroll', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await tab(page, 'Fleet');
    await page.waitForSelector('text=MH12ZZ9999');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.screenshot({ path: path.join(OUT, 'fl-5-phone.png'), fullPage: true });
    if (overflow > 0) throw new Error(`overflow ${overflow}px`);
  });

  const all = [...errors, ...acc.errors, ...ops.errors].filter((e) => !/favicon/.test(e));
  check('no browser console errors', all.length === 0, all.slice(0, 3).join(' | '));
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  await browser.close();
})();
