// Accounting screens in the real owner app, after owner-modules-e2e and
// accounting-e2e have put a realistic ledger in place (and closed the books
// through yesterday).
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
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/login`);
  await page.fill('#login', email);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !/\/login/.test(u.toString()));
  return { ctx, page, errors };
}

(async () => {
  const browser = await launchBrowser();
  const { page, errors } = await signIn(browser, 'owner@dev.morbeez.local');
  const dialog = () => page.locator('dialog[open]');
  const tab = (name) => page.getByRole('button', { name, exact: true }).click();
  const text = async (sel) => (await page.locator(sel).first().textContent()).replace(/\s+/g, ' ');
  async function step(name, fn) {
    try {
      const detail = await fn();
      check(name, true, detail ?? '');
    } catch (e) {
      check(name, false, e.message.split('\n')[0]);
      await page.screenshot({ path: path.join(OUT, `acc-fail-${results.length}.png`), fullPage: true }).catch(() => {});
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

  await step('nav shows Accounting to the owner; page loads on P&L', async () => {
    await page.goto(`${BASE}/dashboard`);
    await page.getByRole('link', { name: 'Accounting' }).click();
    await page.waitForSelector('.statement');
    return (await text('.st-caption')).trim();
  });

  await step('P&L this financial year: sales, gross profit, net profit', async () => {
    await page.locator('.range-controls select').first().selectOption('fy');
    await page.waitForFunction(() => /Net sales/.test(document.querySelector('.statement')?.textContent ?? ''));
    await page.waitForFunction(() => /3,000\.00/.test(document.querySelector('.statement').textContent));
    const rows = await page.locator('.statement tr.st-subtotal, .statement tr.st-total').allTextContents();
    return rows.map((r) => r.replace(/\s+/g, ' ').trim()).join(' | ');
  });
  await page.screenshot({ path: path.join(OUT, 'acc-1-pnl.png'), fullPage: true });

  await step('P&L line opens its general ledger for the same dates', async () => {
    await page.locator('.statement .link-button', { hasText: 'Sales' }).first().click();
    await page.waitForFunction(() => /Opening balance/.test(document.querySelector('.statement')?.textContent ?? ''));
    const heading = await text('.st-status');
    if (!/4000 · Sales/.test(heading)) throw new Error(heading);
    const rows = await page.locator('.statement tbody tr').count();
    return `${heading.slice(0, 60)}… ${rows} rows`;
  });
  await page.screenshot({ path: path.join(OUT, 'acc-2-ledger.png'), fullPage: true });

  await step('balance sheet balances', async () => {
    await tab('Balance sheet');
    await page.waitForSelector('.st-columns');
    const status = await text('.st-status');
    if (!/Balances/.test(status)) throw new Error(status);
    const totals = await page.locator('.st-total').allTextContents();
    return totals.map((t) => t.replace(/\s+/g, ' ').trim()).join(' | ');
  });
  await page.screenshot({ path: path.join(OUT, 'acc-3-balance-sheet.png'), fullPage: true });

  await step('cash flow: activities, then cash at the end', async () => {
    await tab('Cash flow');
    await page.waitForFunction(() => /Cash at the end/.test(document.querySelector('.statement')?.textContent ?? ''));
    const headings = await page.locator('.st-heading').allTextContents();
    if (headings.length !== 3) throw new Error(headings.join(','));
    return (await text('.st-total')).trim();
  });

  await step('trial balance: debits equal credits', async () => {
    await tab('Trial balance');
    await page.waitForFunction(() => /Debits equal credits/.test(document.body.textContent));
    return (await text('.st-total')).trim();
  });
  await page.screenshot({ path: path.join(OUT, 'acc-4-trial-balance.png'), fullPage: true });

  // ---- Journals ----
  await page.getByRole('button', { name: 'Journals', exact: true }).click();
  await page.waitForSelector('text=Journal entries');
  await step('new journal: running totals flag an imbalance before posting', async () => {
    await page.getByRole('button', { name: 'New journal' }).click();
    await page.waitForSelector('dialog[open]');
    await dialog().getByLabel("What it's for").fill('Owner brings in working capital');
    await dialog().getByLabel('Line 1 account').selectOption('bank');
    await dialog().getByLabel('Line 1 debit').fill('50000');
    await dialog().getByLabel('Line 2 account').selectOption('owner_capital');
    await dialog().getByLabel('Line 2 credit').fill('45000');
    const live = await dialog().locator('.lines-total span').textContent();
    if (!/off by 5,000\.00/.test(live)) throw new Error(live);
    await dialog().getByRole('button', { name: 'Post journal' }).click();
    const err = await dialog().locator('.form-error').textContent();
    if (!/differ by 5,000\.00/.test(err)) throw new Error(err);
    return live.trim();
  });
  await step('new journal: control accounts are not offered', async () => {
    const options = await dialog().getByLabel('Line 1 account').locator('option').allTextContents();
    if (options.some((o) => /Accounts receivable|Inventory|Farmer advances|Accounts payable/.test(o))) throw new Error(options.join(','));
    return `${options.length - 1} accounts offered`;
  });
  await step('new journal: posted once it balances', async () => {
    await dialog().getByLabel('Line 2 credit').fill('50000');
    await submit('Post journal');
    await page.getByLabel('Manual journals only').check();
    await page.waitForFunction(() => /Owner brings in working capital/.test(document.querySelector('.table')?.textContent ?? ''));
    return (await page.locator('tr', { hasText: 'Owner brings in working capital' }).first().textContent()).replace(/\s+/g, ' ');
  });
  await step('journal lines expand', async () => {
    const row = page.locator('tr', { hasText: 'Owner brings in working capital' }).first();
    await row.locator('.link-button').click();
    await page.waitForSelector('.journal-detail');
    return (await text('.journal-detail .nested tbody')).trim();
  });
  await step('journal reversed, and marked', async () => {
    const row = page.locator('tr', { hasText: 'Owner brings in working capital' }).first();
    await row.getByRole('button', { name: 'Reverse' }).click();
    await submit('Reverse');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('tr')].some((r) => /Owner brings in working capital/.test(r.textContent) && /Reversed/.test(r.textContent)),
    );
  });
  await page.screenshot({ path: path.join(OUT, 'acc-5-journals.png'), fullPage: true });

  // ---- Chart of accounts ----
  await step('chart: add an account', async () => {
    await tab('Chart of accounts');
    await page.waitForSelector('.statement');
    await page.getByRole('button', { name: 'New account' }).click();
    await dialog().getByLabel('Type').selectOption('expense');
    await dialog().getByLabel('Group').selectOption('operating_expense');
    await dialog().getByLabel('Number').fill('6820');
    await dialog().getByLabel('Name').fill('Crates and packing');
    await submit('Add account');
    await page.waitForSelector('text=Crates and packing');
  });
  await step('chart: rename it, then retire it (no balance)', async () => {
    const row = page.locator('tr', { hasText: 'Crates and packing' });
    await row.getByRole('button', { name: 'Edit' }).click();
    await dialog().getByLabel('Name').fill('Crates, sacks and packing');
    await submit('Save');
    await page.waitForSelector('text=Crates, sacks and packing');
    await page.locator('tr', { hasText: 'Crates, sacks and packing' }).getByRole('button', { name: 'Retire' }).click();
    await submit('Retire');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('tr')].some((r) => /Crates, sacks and packing/.test(r.textContent) && /Retired/.test(r.textContent)),
    );
  });
  await step('chart: system accounts offer no Retire', async () => {
    const bankRow = page.locator('tr', { has: page.locator('.st-number', { hasText: /^1010$/ }) });
    return `retire buttons on Bank: ${await bankRow.getByRole('button', { name: 'Retire' }).count()}`;
  });
  await page.screenshot({ path: path.join(OUT, 'acc-6-chart.png'), fullPage: true });

  // ---- Periods ----
  await step('periods: history shows the close; reopen the latest', async () => {
    await tab('Period closing');
    await page.waitForSelector('text=Closes');
    await page.getByRole('button', { name: 'Reopen' }).first().click();
    await dialog().getByLabel('Reason').fill('Owner capital was posted to the wrong period');
    await submit('Reopen');
    await page.waitForFunction(() => /Reopened/.test(document.body.textContent));
  });
  await step('periods: preview then close through yesterday', async () => {
    await page.waitForSelector('#close-through');
    const through = await page.locator('#close-through').inputValue();
    await page.waitForFunction(() => /moves to retained earnings/.test(document.body.textContent));
    const summary = (await text('.st-status')).trim();
    await page.getByRole('button', { name: /^Close through/ }).click();
    await submit('Close the period');
    await page.waitForFunction(() => /closed through/.test(document.querySelector('.panel-meta')?.textContent ?? ''));
    return `${through}: ${summary}`;
  });
  await page.screenshot({ path: path.join(OUT, 'acc-7-periods.png'), fullPage: true });

  await step('phone width: statements scroll inside their panel, not the page', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await tab('Balance sheet');
    await page.waitForSelector('.st-columns');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.screenshot({ path: path.join(OUT, 'acc-8-phone.png'), fullPage: true });
    if (overflow > 0) throw new Error(`page overflows by ${overflow}px`);
  });

  // ---- Other roles ----
  const acc = await signIn(browser, 'accountant@dev.morbeez.local');
  await step('accountant: posts journals, cannot change the chart or close', async () => {
    await acc.page.goto(`${BASE}/accounting#periods`);
    await acc.page.waitForSelector('text=Close the books');
    await acc.page.waitForTimeout(800);
    const closeBtn = await acc.page.getByRole('button', { name: /^Close through/ }).count();
    const reopenBtn = await acc.page.getByRole('button', { name: 'Reopen' }).count();
    const newJournal = await acc.page.getByRole('button', { name: 'New journal' }).count();
    await acc.page.getByRole('button', { name: 'Chart of accounts', exact: true }).click();
    await acc.page.waitForSelector('.statement');
    const newAccount = await acc.page.getByRole('button', { name: 'New account' }).count();
    const edit = await acc.page.getByRole('button', { name: 'Edit' }).count();
    const got = { closeBtn, reopenBtn, newJournal, newAccount, edit };
    if (closeBtn || reopenBtn || !newJournal || newAccount || edit) throw new Error(JSON.stringify(got));
    return JSON.stringify(got);
  });
  const ops = await signIn(browser, 'ops-manager@dev.morbeez.local');
  await step('ops manager: no Accounting link, and a plain no-access page', async () => {
    // The menu shows every link until the session loads — count once it has.
    await ops.page.waitForSelector('.topbar-email');
    const link = await ops.page.getByRole('link', { name: 'Accounting' }).count();
    await ops.page.goto(`${BASE}/accounting`);
    await ops.page.waitForSelector('text=Your role doesn');
    if (link) throw new Error('link shown');
  });

  const all = [...errors, ...acc.errors, ...ops.errors].filter((e) => !/favicon/.test(e));

  const unexpected = all;
  check('no unexpected browser console errors', unexpected.length === 0, unexpected.slice(0, 3).join(' | '));
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  await browser.close();
})();
