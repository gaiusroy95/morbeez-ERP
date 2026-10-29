// Owner app redesign, Phase 2 — Procurement (docs/redesign): numbers,
// the pickup plan, bags, agents and commission, the Today/Tomorrow/All
// list with search and statuses, and the "Create Procurement" form on a
// phone. Runs on the seeded dev business.
const { API, BASE, DB_URL, PASSWORD, launchBrowser } = require('../lib/env');
const { Client } = require('pg');

const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`);

async function login(login) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password: PASSWORD }) });
  return (await r.json()).accessToken;
}
function client(token) {
  const call = async (method, path, body) => {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  const ok = async (method, path, body) => {
    const r = await call(method, path, body);
    if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  return { raw: call, get: (p) => ok('GET', p), post: (p, b = {}) => ok('POST', p, b), patch: (p, b) => ok('PATCH', p, b) };
}
const pNo = (n) => `P-${String(n).padStart(5, '0')}`;

(async () => {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const browser = await launchBrowser();
  try {
    const owner = client(await login('owner@dev.morbeez.local'));
    const farmers = (await owner.get('/farmers?pageSize=100')).items;
    const products = (await owner.get('/products?pageSize=100')).items;
    const vehicles = (await owner.get('/vehicles?pageSize=100')).items;
    const workers = (await owner.get('/workforce?pageSize=100')).items;
    const ramesh = farmers.find((f) => f.name === 'Ramesh Patil');
    const lakshmi = farmers.find((f) => f.name === 'Lakshmi Devi');
    const tomato = products.find((p) => p.name === 'Tomato');
    const onion = products.find((p) => p.name === 'Onion');
    const truck = vehicles.find((v) => v.registrationNumber === 'MH12AB4521');
    const suresh = workers.find((w) => w.name === 'Suresh Kale');
    const tz = (await db.query('SELECT timezone FROM tenant.tenant WHERE id = (SELECT tenant_id FROM trading_partners.farmer WHERE id = $1)', [ramesh.id])).rows[0].timezone;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(Date.now() + 86400000));

    // ---- Farmer's place ----
    const placed = await owner.patch(`/farmers/${ramesh.id}`, { version: ramesh.version, place: 'Nanjangud' });
    check("a farmer's village is saved", placed.place === 'Nanjangud', placed.place);

    // ---- Agents ----
    const agent = await owner.post('/procurement/agents', { name: 'Manju Agent', phone: '98450 11111', defaultCommissionPerKg: 1.5 });
    check('an agent is added with a usual commission', agent.defaultCommissionPerKg === '1.50' && agent.status === 'active');
    const agents = await owner.get('/procurement/agents');
    check('…and listed', agents.some((a) => a.id === agent.id));
    const badAgent = await owner.raw('POST', '/procurement/agents', { name: 'X' });
    check('an agent needs a name', badAgent.status === 400);

    // ---- Create with the plan, bags, agent; confirm on save ----
    const before = await owner.get('/procurement/board?day=today');
    const po = await owner.post('/procurement/purchase-orders', {
      farmerId: ramesh.id,
      pickupDate: today,
      pickupTime: '08:30',
      driverEmployeeId: suresh.id,
      vehicleId: truck.id,
      agentId: agent.id,
      commissionPerKg: 1.5,
      notes: 'Bring 10 empty crates',
      confirm: true,
      lines: [
        { productId: tomato.id, expectedQuantity: 420, indicativePrice: 22, bags: 10, kgPerBag: 42 },
        { productId: onion.id, expectedQuantity: 100, indicativePrice: 18 },
      ],
    });
    check('saving confirms the order straight away', po.status === 'confirmed', po.status);
    check('it gets a number', Number.isInteger(po.number) && po.number > 0, pNo(po.number));
    check('the plan, agent and notes are kept', po.pickupDate === today && po.pickupTime === '08:30' && po.plannedDriverId === suresh.id && po.plannedVehicleId === truck.id && po.agentId === agent.id && po.commissionPerKg === '1.50' && po.notes === 'Bring 10 empty crates');
    const bagLine = po.lines.find((l) => l.productId === tomato.id);
    check('a line bought by the bag keeps bags and kg per bag', bagLine.bags === '10.000' && bagLine.kgPerBag === '42.000' && Number(bagLine.expectedQuantity) === 420, JSON.stringify(bagLine));
    const pickups = await owner.get(`/procurement/purchase-orders/${po.id}/pickups`);
    const local = pickups[0] && new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(pickups[0].scheduledAt));
    check('the pickup is scheduled with the driver, vehicle and local time', pickups.length === 1 && pickups[0].status === 'scheduled' && pickups[0].driverEmployeeId === suresh.id && pickups[0].vehicleId === truck.id && local === '08:30', `${pickups.length} ${local}`);

    const second = await owner.post('/procurement/purchase-orders', { farmerId: lakshmi.id, pickupDate: tomorrow, lines: [{ productId: onion.id, expectedQuantity: 50, indicativePrice: 18 }] });
    check('numbers run in order', second.number === po.number + 1, `${po.number} → ${second.number}`);
    check('without confirm it waits to be confirmed, as before', second.status === 'placed');

    // ---- Refusals ----
    const wrongBags = await owner.raw('POST', '/procurement/purchase-orders', { farmerId: ramesh.id, lines: [{ productId: tomato.id, expectedQuantity: 400, indicativePrice: 20, bags: 10, kgPerBag: 42 }] });
    check('bags × kg per bag must match the kilos', wrongBags.status === 400, wrongBags.body?.error?.message);
    const halfBags = await owner.raw('POST', '/procurement/purchase-orders', { farmerId: ramesh.id, lines: [{ productId: tomato.id, expectedQuantity: 420, indicativePrice: 20, bags: 10 }] });
    check('bags need the kg in each bag', halfBags.status === 400);
    const noAgent = await owner.raw('POST', '/procurement/purchase-orders', { farmerId: ramesh.id, commissionPerKg: 2, lines: [{ productId: tomato.id, expectedQuantity: 10, indicativePrice: 20 }] });
    check('a commission needs an agent', noAgent.status === 400);
    const noDate = await owner.raw('POST', '/procurement/purchase-orders', { farmerId: ramesh.id, pickupTime: '08:00', lines: [{ productId: tomato.id, expectedQuantity: 10, indicativePrice: 20 }] });
    check('a pickup time needs a date', noDate.status === 400);
    const badTime = await owner.raw('POST', '/procurement/purchase-orders', { farmerId: ramesh.id, pickupDate: today, pickupTime: '25:00', lines: [{ productId: tomato.id, expectedQuantity: 10, indicativePrice: 20 }] });
    check('a wrong time is refused', badTime.status === 400);

    // ---- The board ----
    const board = await owner.get('/procurement/board?day=today');
    const card = board.items.find((c) => c.id === po.id);
    check("today's list has the order", !!card && board.counts.today === before.counts.today + 1, `${before.counts.today} → ${board.counts.today}`);
    check('the card shows number, farmer, place, time, driver, vehicle', card.number === po.number && card.farmerName === 'Ramesh Patil' && card.farmerPlace === 'Nanjangud' && card.pickupTime === '08:30' && card.driverName === 'Suresh Kale' && card.vehicle === 'MH12AB4521', JSON.stringify(card));
    const tomatoOnCard = card.products.find((x) => x.name === 'Tomato');
    check('…its products, bags included', tomatoOnCard?.bags === '10.000' && tomatoOnCard?.kgPerBag === '42.000' && card.products.length === 2, JSON.stringify(card.products));
    check('…and it is Pending', card.stage === 'pending', card.stage);
    const tmr = await owner.get('/procurement/board?day=tomorrow');
    check("tomorrow's order is on Tomorrow, not Today", tmr.items.some((c) => c.id === second.id) && !board.items.some((c) => c.id === second.id));
    const all = await owner.get('/procurement/board?day=all');
    check('All has both', all.items.some((c) => c.id === po.id) && all.items.some((c) => c.id === second.id) && all.counts.all >= 2);
    for (const [q, label] of [['nanjan', 'place'], ['ramesh', 'farmer'], ['toma', 'product'], [pNo(po.number), 'P-number']]) {
      const found = await owner.get(`/procurement/board?day=all&q=${encodeURIComponent(q)}`);
      check(`search finds it by ${label}`, found.items.some((c) => c.id === po.id), `${q}: ${found.items.length}`);
    }
    const none = await owner.get('/procurement/board?day=all&q=zzzz');
    check('a search with no match returns nothing', none.items.length === 0 && none.counts.all === 0);

    // ---- Statuses follow the work ----
    const pk = pickups[0];
    await owner.post(`/procurement/pickups/${pk.id}/complete`, { version: pk.version, vehicleId: truck.id, driverEmployeeId: suresh.id });
    let stage = (await owner.get('/procurement/board?day=today')).items.find((c) => c.id === po.id).stage;
    check('picked up → In Progress', stage === 'in_progress', stage);
    await owner.post(`/procurement/purchase-orders/${po.id}/receive-goods`, { pickupId: pk.id, lines: [{ productId: tomato.id, receivedQuantity: 420 }, { productId: onion.id, receivedQuantity: 100 }] });
    for (const lot of await owner.get(`/procurement/purchase-orders/${po.id}/lots`)) {
      await owner.post(`/procurement/lots/${lot.id}/grade`, { version: lot.version, acceptedQuantity: Number(lot.receivedQuantity), rejectedQuantity: 0, unitCost: 20 });
    }
    stage = (await owner.get('/procurement/board?day=today')).items.find((c) => c.id === po.id).stage;
    check('graded → Completed', stage === 'completed', stage);
    const fresh = await owner.get(`/procurement/purchase-orders/${second.id}`);
    await owner.post(`/procurement/purchase-orders/${second.id}/cancel`, { version: fresh.version });
    const tmr2 = await owner.get('/procurement/board?day=tomorrow');
    const allCancelled = (await owner.get('/procurement/board?day=all')).items.find((c) => c.id === second.id);
    check('a cancelled order leaves Tomorrow but stays in All as Cancelled', !tmr2.items.some((c) => c.id === second.id) && allCancelled.stage === 'cancelled');

    // ---- Over the approval limit: waits, then the planned pickup follows ----
    const big = await owner.post('/procurement/purchase-orders', { farmerId: lakshmi.id, pickupDate: today, driverEmployeeId: suresh.id, vehicleId: truck.id, confirm: true, lines: [{ productId: tomato.id, expectedQuantity: 3000, indicativePrice: 20 }] });
    check('over the limit it waits for approval', big.status === 'placed' && !!big.approvalRequestId, big.status);
    const bigCard = (await owner.get('/procurement/board?day=today')).items.find((c) => c.id === big.id);
    check('…shown as Awaiting approval, no pickup yet', bigCard.stage === 'awaiting_approval' && (await owner.get(`/procurement/purchase-orders/${big.id}/pickups`)).length === 0, bigCard.stage);
    const ops = client(await login('ops-manager@dev.morbeez.local'));
    const request = await ops.get(`/approval-requests/${big.approvalRequestId}`);
    await ops.post(`/approval-requests/${big.approvalRequestId}/approve`, { version: request.version, note: 'ok' });
    const finalized = await owner.post(`/procurement/purchase-orders/${big.id}/finalize-confirmation`);
    const bigPickups = await owner.get(`/procurement/purchase-orders/${big.id}/pickups`);
    check('once approved it is confirmed and the planned pickup scheduled', finalized.status === 'confirmed' && bigPickups.length === 1 && bigPickups[0].driverEmployeeId === suresh.id);

    // ---- Another business sees none of it ----
    const otherPhone = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
    const signup = await fetch(`${API}/tenants`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ businessName: 'Other Traders', ownerPhone: otherPhone, ownerPassword: 'another-password-1' }) });
    const other = client((await signup.json()).accessToken);
    const otherBoard = await other.get('/procurement/board?day=all');
    check("another business's list is empty", otherBoard.counts.all === 0 && otherBoard.items.length === 0);
    const otherNo = await other.post('/farmers', { name: 'First Farmer' });
    const otherPo = await other.post('/procurement/purchase-orders', { farmerId: otherNo.id, lines: [{ productId: (await other.post('/products', { name: 'Beans', baseUom: 'kg', kind: 'standard' })).id, expectedQuantity: 5, indicativePrice: 10 }] });
    check("each business's numbers start at 1", otherPo.number === 1, otherPo.number);

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
    await page.goto(`${BASE}/procurement`);
    await page.waitForSelector('.list-card', { timeout: 20000 });
    const tabs = await page.locator('.day-tabs button').allInnerTexts();
    check('tabs show Today / Tomorrow / All with counts', /^Today \(\d+\)$/.test(tabs[0]) && /^Tomorrow \(\d+\)$/.test(tabs[1]) && /^All \(\d+\)$/.test(tabs[2]), tabs.join(' | '));
    const firstCard = (await page.locator('.list-card', { hasText: pNo(po.number) }).textContent()).replace(/\s+/g, ' ');
    check('the card reads like the design', /Ramesh Patil/.test(firstCard) && /Nanjangud/.test(firstCard) && /Tomato 10 bags \(420 kg\)|Onion 100 kg/.test(firstCard) && /08:30 AM/.test(firstCard) && /Completed/.test(firstCard), firstCard);
    await page.fill('.search-filter input', 'lakshmi');
    await page.waitForTimeout(800);
    const searched = await page.locator('.list-card-title').allInnerTexts();
    check('search narrows the cards', searched.length > 0 && searched.every((n) => /Lakshmi/.test(n)), searched.join(', '));
    await page.fill('.search-filter input', '');
    await page.locator('.filter-select select').selectOption('completed');
    await page.waitForTimeout(300);
    const statuses = await page.locator('.list-card-status').allInnerTexts();
    check('the status filter keeps only that status', statuses.length > 0 && statuses.every((s) => s === 'Completed'), statuses.join(', '));
    await page.locator('.filter-select select').selectOption('all');

    // Create one on the form, with bags and a brand-new agent.
    await page.getByRole('button', { name: 'Create Procurement' }).click();
    const dialog = () => page.locator('dialog[open]').last();
    await dialog().getByLabel('Farmer', { exact: true }).click();
    await dialog().locator('.picker-search').fill('Ramesh');
    await dialog().getByRole('option', { name: /Ramesh Patil/ }).click();
    check('the chosen farmer shows as a card with View', (await dialog().locator('.farmer-card').textContent()).includes('Nanjangud'));
    await dialog().getByLabel('Pickup time (optional)').fill('10:00');
    await dialog().getByLabel('Driver', { exact: true }).selectOption({ label: 'Suresh Kale' });
    await dialog().getByLabel('Vehicle', { exact: true }).selectOption({ label: 'MH12AB4521' });
    await dialog().getByLabel('Line 1 product', { exact: true }).click();
    await dialog().locator('.picker-search').fill('Toma');
    await dialog().getByRole('option', { name: 'Tomato', exact: true }).click();
    await dialog().getByLabel(/Line 1 quantity/).fill('10');
    await dialog().getByLabel('Line 1 counted in').selectOption('bag');
    await dialog().getByLabel('Line 1 kg per bag').fill('42');
    const auto = await dialog().locator('.line-bag .line-hint').innerText();
    check('bags show the kilos, auto calculated', /= 420 kg/.test(auto), auto);
    await dialog().getByLabel(/Line 1 rate/).fill('21');
    await dialog().getByLabel('Agent (optional)', { exact: true }).click();
    await dialog().locator('.picker-search').fill('Ravi Broker');
    await dialog().getByRole('button', { name: /Create new agent/ }).click();
    await page.locator('dialog[open]').last().getByLabel('Usual commission (₹/kg)').fill('2');
    await page.locator('dialog[open]').last().getByRole('button', { name: 'Add agent' }).click();
    await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 1);
    const commission = await dialog().getByLabel('Commission (₹/kg)').inputValue();
    check('a new agent is chosen and their commission filled in', commission === '2.00', commission);
    await dialog().getByLabel('Notes (optional)').fill('Morning pickup');
    await dialog().getByRole('button', { name: 'Save Procurement' }).click();
    await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 0, null, { timeout: 15000 });
    await page.waitForFunction(() => /Awaiting produce/.test(document.querySelector('.detail')?.textContent ?? ''), null, { timeout: 15000 });
    const detailText = (await page.locator('.detail').textContent()).replace(/\s+/g, ' ');
    check('the saved order opens with its number, agent and commission', /P-\d{5}/.test(detailText) && /Ravi Broker/.test(detailText) && /₹2(\.00)? \/ kg/.test(detailText) && /10 bags × 42 kg/.test(detailText) && /Morning pickup/.test(detailText) && /Awaiting produce/.test(detailText), detailText.slice(0, 300));
    const newCard = (await page.locator('.list-card', { hasText: '10:00 AM' }).first().textContent()).replace(/\s+/g, ' ');
    check('…and appears on today\'s list as Pending', /Tomato 10 bags \(420 kg\)/.test(newCard) && /Pending/.test(newCard), newCard);
    check('no page errors', errors.length === 0, errors.join('; '));
  } catch (e) {
    check('flow', false, e.message.split('\n')[0]);
  } finally {
    await browser.close();
    await db.end();
  }
  console.log(results.join('\n'));
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);
})();
