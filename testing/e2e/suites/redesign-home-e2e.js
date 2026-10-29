// Owner app redesign, Phases 0–1 (docs/redesign/owner-app-redesign-plan.md):
// the Home screen's numbers agree with the figures elsewhere, and every
// button on Home, the Operations hub, the (+) sheet and the tab bar goes
// where it should. Runs on the seeded dev business.
const { API, BASE, PASSWORD, launchBrowser } = require('../lib/env');

const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`);

async function login(login) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password: PASSWORD }) });
  return (await r.json()).accessToken;
}
async function get(token, path) {
  const r = await fetch(`${API}/${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: r.status, body: await r.json().catch(() => null) };
}

(async () => {
  const browser = await launchBrowser();
  try {
    const owner = await login('owner@dev.morbeez.local');

    // ---- The numbers ----
    const week = await get(owner, 'dashboard/home?period=week');
    check('Home loads', week.status === 200, week.status);
    const h = week.body;
    const kpis = (await get(owner, 'dashboard/kpis?days=7')).body;
    check('sales = delivered revenue for the same 7 days', h.sales === kpis.deliveredRevenue.value, `${h.sales} / ${kpis.deliveredRevenue.value}`);
    check('purchases = procurement spend for the same 7 days', h.purchases === kpis.procurementSpend.value, `${h.purchases} / ${kpis.procurementSpend.value}`);
    check('net contribution = sales − purchases', Number(h.netContribution.value) === Math.round((Number(h.sales) - Number(h.purchases)) * 100) / 100, h.netContribution.value);
    check('receivables = the dashboard figure', h.receivables === kpis.receivablesOutstanding.value, h.receivables);
    check('payables = what farmers are owed', h.payables === kpis.farmerPayablesOutstanding.value, h.payables);
    const ops = (await get(owner, 'dashboard/operations')).body;
    check('active trips = trips on the road', h.activeTrips.active === ops.trips.inProgress && h.today.activeTrips === ops.trips.inProgress, `${h.activeTrips.active} / ${ops.trips.inProgress}`);
    check('deliveries today = awaiting delivery + delivered today', h.today.deliveries === ops.orders.awaitingDelivery + ops.orders.deliveredToday, h.today.deliveries);
    const month = (await get(owner, 'dashboard/home?period=month')).body;
    check('"This month" starts on the 1st', month.period.from.endsWith('-01') && month.period.to === h.period.to, `${month.period.from}…${month.period.to}`);
    const today = (await get(owner, 'dashboard/home?period=today')).body;
    check('"Today" is one day', today.period.from === today.period.to);
    check('every alert opens a screen', h.alerts.every((a) => a.href.startsWith('/') && a.count > 0), JSON.stringify(h.alerts.map((a) => a.code)));
    const bad = await get(owner, 'dashboard/home?period=year');
    check('an unknown period is refused', bad.status === 400, bad.status);
    const driver = await login('driver@dev.morbeez.local');
    const denied = await get(driver, 'dashboard/home');
    check("a driver can't open Home", denied.status === 403, denied.status);

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
    await page.goto(`${BASE}/dashboard`);
    await page.waitForSelector('.net-card', { timeout: 20000 });
    const tabs = await page.locator('.bottom-nav').getByRole('link').allInnerTexts();
    check('tab bar: Home · Operations · Finance (+ the create and More buttons)', tabs.join('|') === 'Home|Operations|Finance', tabs.join('|'));
    check('tab bar has the (+) and More', (await page.getByRole('button', { name: 'Create', exact: true }).count()) === 1 && (await page.getByRole('button', { name: 'More' }).count()) === 1);

    const shown = await page.locator('.money-tile-value').allInnerTexts();
    check('Home shows four money tiles', shown.length === 4, shown.join(' | '));
    const net = await page.locator('.net-value').innerText();
    check('Home shows the net contribution', /₹/.test(net), net);

    // Each tile opens its screen.
    const hrefs = await page.locator('.money-tile, .count-tile').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
    check('tiles open finance, trips, procurement and orders', ['/finance#receivables', '/finance#payables', '/finance#cash', '/logistics', '/procurement', '/orders'].every((x) => hrefs.includes(x)), hrefs.join(' '));
    await page.locator('.money-tile').first().click();
    await page.waitForURL(/\/finance/);
    await page.waitForSelector('.segmented button[aria-pressed="true"]');
    const tab = await page.locator('.segmented button[aria-pressed="true"]').first().innerText();
    check('Receivables tile opens Finance on the Receivables tab', /Receivables/.test(tab), tab);

    // Operations hub.
    await page.locator('.bottom-nav').getByRole('link', { name: 'Operations' }).click();
    await page.waitForSelector('.op-tile');
    check('Operations hub shows eight tiles', (await page.locator('.op-tile').count()) === 8);
    await page.fill('.search-box input', 'farm');
    const found = await page.locator('.op-tile-name').allInnerTexts();
    check('searching the hub filters the tiles', found.length >= 1 && found.length < 8 && found.every((n) => /Farm|Procurement/i.test(n)), found.join(', '));
    await page.fill('.search-box input', '');
    await page.locator('.op-tile', { hasText: 'Trips' }).click();
    await page.waitForURL(/\/logistics/);
    check('a hub tile opens its screen', true);

    // (+): each item opens its page with the form already open.
    for (const [label, url] of [
      ['Create Procurement', /\/procurement$/],
      ['Create Delivery Order', /\/orders$/],
      ['Create Trip', /\/logistics$/],
      ['Add Customer', /\/customers$/],
      ['Add Farmer', /\/farmers$/],
    ]) {
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      await page.getByRole('link', { name: label }).click();
      await page.waitForURL(url, { timeout: 15000 });
      const open = await page.waitForSelector('dialog[open]', { timeout: 15000 }).then(() => true).catch(() => false);
      check(`(+) → ${label} opens the form`, open, page.url());
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await page.reload();
      await page.waitForTimeout(800);
      check(`…and a reload doesn't open it again (${label})`, (await page.locator('dialog[open]').count()) === 0);
    }

    // More opens the side menu.
    await page.getByRole('button', { name: 'More' }).click();
    const drawer = await page.locator('.sidebar[data-open="true"]').isVisible();
    check('More opens the side menu', drawer);
    await page.locator('.sidebar').getByRole('link', { name: 'Vehicles' }).click();
    await page.waitForURL(/\/vehicles/);
    check('a side menu link goes to its screen and closes the menu', (await page.locator('.sidebar[data-open="true"]').count()) === 0);
    check('no page errors', errors.length === 0, errors.join('; '));
  } catch (e) {
    check('flow', false, e.message.split('\n')[0]);
  } finally {
    await browser.close();
  }
  console.log(results.join('\n'));
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);
})();
