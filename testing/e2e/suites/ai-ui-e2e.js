// Suggestions screens in the real owner app, after ai-e2e.js
// (which leaves a fresh run open, with customer suggestions switched off).
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
  await page.waitForSelector('.topbar-email');
  return { page, errors };
}

(async () => {
  const browser = await launchBrowser();
  const { page, errors } = await signIn(browser, 'owner@dev.morbeez.local');
  const dialog = () => page.locator('dialog[open]');
  const section = (p, name) => p.getByRole('group', { name: 'Suggestions section' }).getByRole('button', { name, exact: true }).click();
  const typeTab = (p, name) => p.getByRole('group', { name: 'Suggestion type' }).getByRole('button', { name, exact: true }).click();
  const card = (p, type) => p.locator(`article.suggestion[data-type="${type}"]`).first();
  async function step(name, fn, p = page) {
    try {
      check(name, true, (await fn()) ?? '');
    } catch (e) {
      check(name, false, e.message.split('\n')[0]);
      await p.screenshot({ path: path.join(OUT, `ai-fail-${results.length}.png`), fullPage: true }).catch(() => {});
    }
  }

  await step('inbox: suggestions with their evidence and the last run', async () => {
    await page.getByRole('link', { name: 'Suggestions', exact: true }).click();
    await page.waitForSelector('article.suggestion');
    const note = (await page.locator('.run-note').textContent()).replace(/\s+/g, ' ');
    if (!/Last worked out .* by 98000 00001/.test(note) || !/Customer \(Switched off in AI settings\)/.test(note)) throw new Error(note);
    const buy = (await card(page, 'procurement').textContent()).replace(/\s+/g, ' ');
    if (!/Buy about .* of Tomato/.test(buy) || !/over the last 4 weeks200 kg, 190 kg, 210 kg, 205 kg/.test(buy) || !/Worth ₹/.test(buy)) throw new Error(buy.slice(0, 400));
    return `${await page.locator('article.suggestion').count()} open`;
  });
  await page.screenshot({ path: path.join(OUT, 'ai-1-inbox.png'), fullPage: true });

  let buyTitle = '';
  await step('buying: place the purchase order from the card, changing the quantity', async () => {
    await typeTab(page, 'Buying');
    const c = card(page, 'procurement');
    buyTitle = (await c.locator('h3').textContent()).trim();
    await c.getByRole('button', { name: 'Use this…' }).click();
    await dialog().getByLabel(/Quantity/).fill('120');
    await dialog().getByRole('button', { name: 'Place purchase order' }).click();
    await page.waitForSelector('dialog[open]', { state: 'detached', timeout: 10000 });
    await page.waitForFunction((t) => ![...document.querySelectorAll('article.suggestion h3')].some((h) => h.textContent.trim() === t), buyTitle);
  });

  await step('decided: the order shows as changed by the owner', async () => {
    await section(page, 'Decided');
    // An earlier run's identical suggestion was superseded; the one acted on reads "Changed".
    const c = page.locator('article.suggestion', { hasText: buyTitle }).filter({ hasText: 'Changed by' });
    await c.waitFor();
    const t = (await c.textContent()).replace(/\s+/g, ' ');
    if (!/Changed by 98000 00001/i.test(t)) throw new Error(t.slice(0, 300));
  });

  await step('worth a look: dismiss one, with a reason', async () => {
    await section(page, 'To decide');
    await typeTab(page, 'Worth a look');
    const c = card(page, 'exception');
    const title = (await c.locator('h3').textContent()).trim();
    await c.getByRole('button', { name: 'Not useful' }).click();
    await dialog().getByLabel('Why').selectOption('Other');
    await dialog().getByRole('button', { name: 'Dismiss', exact: true }).click();
    await dialog().locator('text=Say why.').waitFor();
    await dialog().getByLabel('Note (optional)').fill('Known promotion');
    await dialog().getByRole('button', { name: 'Dismiss', exact: true }).click();
    await page.waitForSelector('dialog[open]', { state: 'detached', timeout: 10000 });
    await page.waitForFunction((t) => ![...document.querySelectorAll('article.suggestion h3')].some((h) => h.textContent.trim() === t), title);
  });

  await step('customer profitability: every customer, the loss-maker flagged', async () => {
    await section(page, 'Customer profitability');
    await page.getByLabel('Period').selectOption({ label: 'This month' });
    await page.waitForSelector('text=Deccan Dhaba');
    const row = (await page.locator('tr', { hasText: 'Deccan Dhaba' }).textContent()).replace(/\s+/g, ' ');
    const tone = await page.locator('tr', { hasText: 'Deccan Dhaba' }).locator('td[data-tone="bad"]').count();
    if (!/₹480/.test(row) || tone !== 1) throw new Error(row);
  });
  await page.screenshot({ path: path.join(OUT, 'ai-2-profit.png'), fullPage: true });

  await step('track record: backtest error and outcomes by type', async () => {
    await section(page, 'Track record');
    await page.waitForSelector('text=Buying forecast error');
    const t = (await page.locator('main').textContent()).replace(/\s+/g, ' ');
    if (!/backtest, 28 days\)\d+(\.\d)?%/.test(t) || !/Buying\d+\d+2/.test(t.replace(/ /g, ''))) throw new Error(t.slice(0, 600));
  });

  await step('settings: switched-off type and the map pins', async () => {
    await section(page, 'Settings');
    await page.waitForSelector('text=Map pins for routes');
    if (await page.getByLabel('Customer', { exact: true }).isChecked()) throw new Error('customer suggestions still on');
    const pin = page.getByLabel('Map pin for Annapurna Mess');
    if ((await pin.inputValue()) !== '18.52, 73.95') throw new Error(await pin.inputValue());
    await pin.fill('not a pin');
    await page.locator('tr', { hasText: 'Annapurna Mess' }).getByRole('button', { name: 'Save' }).click();
    await page.waitForSelector('text=Enter "latitude, longitude".');
    await pin.fill('18.521, 73.951');
    await page.locator('tr', { hasText: 'Annapurna Mess' }).getByRole('button', { name: 'Save' }).click();
    await page.locator('tr', { hasText: 'Annapurna Mess' }).getByRole('button', { name: 'Saved' }).waitFor();
  });
  await page.screenshot({ path: path.join(OUT, 'ai-3-settings.png'), fullPage: true });

  const ops = await signIn(browser, 'ops-manager@dev.morbeez.local');
  await step(
    'ops manager: decides routes and loads only; no profitability, no settings edits',
    async () => {
      await ops.page.goto(`${BASE}/ai`);
      await ops.page.waitForSelector('article.suggestion');
      const tabs = await ops.page.getByRole('group', { name: 'Suggestions section' }).textContent();
      if (/Customer profitability/.test(tabs)) throw new Error(tabs);
      const price = card(ops.page, 'pricing');
      if ((await price.count()) && !(await price.textContent()).includes('Decided by the owner')) throw new Error('price decidable');
      const load = card(ops.page, 'logistics_load');
      if ((await load.count()) && !(await load.getByRole('button', { name: 'Use this…' }).count())) throw new Error('load not decidable');
      await section(ops.page, 'Settings');
      await ops.page.waitForSelector('text=Map pins for routes');
      if (!(await ops.page.getByLabel('Target margin on cost (%)').isDisabled()) || (await ops.page.getByRole('button', { name: 'Save settings' }).count())) throw new Error('settings editable');
    },
    ops.page,
  );

  await step('phone width: no sideways page scroll', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await section(page, 'To decide');
    await page.waitForSelector('article.suggestion');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.screenshot({ path: path.join(OUT, 'ai-4-phone.png'), fullPage: true });
    if (overflow > 0) throw new Error(`overflow ${overflow}px`);
  });

  const all = [...errors, ...ops.errors].filter((e) => !/favicon/.test(e));
  check('no browser console errors', all.length === 0, all.slice(0, 3).join(' | '));
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  await browser.close();
})();
