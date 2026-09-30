// AI suggestions through the real HTTP API, after every other suite.
// Fixture: eight weeks of Tomato spot-sale history inserted directly (the
// other suites only ever trade "today"), so the forecast has a past.
const { API, DB_URL, PASSWORD } = require('../lib/env');
const { Client } = require('pg');
const { randomUUID } = require('crypto');
const results = [];
const check = (name, ok, detail = '') => {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`;
  results.push(line);
  console.log(line);
};
async function login(email) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  return (await r.json()).accessToken;
}
function as(token) {
  const call = async (method, path, body) => {
    const r = await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: r.status, body: json };
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), put: (p, b) => call('PUT', p, b), patch: (p, b) => call('PATCH', p, b) };
}
const must = (r, what) => {
  if (r.status >= 300) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const msg = (r) => r.body?.error?.message ?? JSON.stringify(r.body);
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

(async () => {
  const owner = as(await login('owner@dev.morbeez.local'));
  const ops = as(await login('ops-manager@dev.morbeez.local'));
  const acc = as(await login('accountant@dev.morbeez.local'));
  const today = must(await owner.get('/accounting/periods'), 'periods').today;
  const tomorrow = addDays(today, 1);
  const products = must(await owner.get('/products?page=1&pageSize=50'), 'products').items;
  const tomato = products.find((p) => p.name === 'Tomato');
  const farmers = must(await owner.get('/farmers?page=1&pageSize=50'), 'farmers').items;
  const ramesh = farmers.find((f) => f.name === 'Ramesh Patil');
  const vehicles = must(await owner.get('/vehicles?page=1&pageSize=50'), 'vehicles').items;
  const staff = must(await owner.get('/workforce?page=1&pageSize=50'), 'staff').items;
  const suresh = staff.find((e) => e.name === 'Suresh Kale');

  // ---- Fixture: 8 weeks of Tomato history — 100 kg a day, 200 kg on tomorrow's weekday ----
  const pg = new Client({ connectionString: DB_URL });
  await pg.connect();
  const tpl = (await pg.query(`SELECT * FROM spot.spot_sale WHERE status = 'completed' ORDER BY sold_at LIMIT 1`)).rows[0];
  const weekdayQty = [200, 190, 210, 205, 200, 195, 210, 200];
  for (let i = 2; i <= 56; i++) {
    const day = addDays(today, -i);
    const sameWeekday = (i + 1) % 7 === 0 ? weekdayQty[(i + 1) / 7 - 1] : null; // tomorrow − 7k
    const q = sameWeekday ?? 100;
    const id = randomUUID();
    await pg.query(
      `INSERT INTO spot.spot_sale (id, tenant_id, sale_number, client_ref, trip_id, vehicle_id, driver_employee_id, payment_method, status, subtotal, total, tax_total, cost_total,
         invoice_id, payment_id, sold_at, completed_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'cash', 'completed', $8, $8, 0, $9, $10, $11, ($12::date + time '11:00') AT TIME ZONE 'Asia/Kolkata', now(), $13)`,
      [id, tpl.tenant_id, `HX-${String(i).padStart(4, '0')}`, randomUUID(), tpl.trip_id, tpl.vehicle_id, tpl.driver_employee_id, (q * 30).toFixed(2), (q * 20).toFixed(2), tpl.invoice_id, tpl.payment_id, day, tpl.created_by],
    );
    await pg.query(
      `INSERT INTO spot.spot_sale_line (tenant_id, sale_id, product_id, quantity, unit_price, amount, band_source) VALUES ($1, $2, $3, $4, 30, $5, 'band')`,
      [tpl.tenant_id, id, tomato.id, q, (q * 30).toFixed(2)],
    );
  }
  // DR.1: the AI's role can read but the database refuses its writes.
  let refused = '';
  try {
    await pg.query('BEGIN');
    await pg.query('SET LOCAL ROLE morbeez_ai');
    await pg.query(`SELECT set_config('app.tenant_id', $1, true)`, [tpl.tenant_id]);
    const seen = (await pg.query('SELECT count(*)::int AS n FROM trading_partners.product')).rows[0].n;
    refused = `reads ${seen} products; `;
    await pg.query(`UPDATE trading_partners.product SET base_price = 1`);
    refused += 'UPDATE ALLOWED';
  } catch (e) {
    refused += e.message;
  } finally {
    await pg.query('ROLLBACK');
  }
  check('the AI role reads the business and cannot change it (DR.1)', /reads [1-9]\d* products; permission denied/.test(refused), refused);

  // ---- Stock and orders for routes, loads and a below-cost sale ----
  const buy = async (lines) => {
    const po = must(await owner.post('/procurement/purchase-orders', { farmerId: ramesh.id, lines }), 'po');
    must(await owner.post(`/procurement/purchase-orders/${po.id}/confirm`, { version: po.version }), 'po confirm');
    must(await owner.post(`/procurement/purchase-orders/${po.id}/receive-goods`, { lines: lines.map((l) => ({ productId: l.productId, receivedQuantity: l.expectedQuantity })) }), 'receive');
    const lots = must(await owner.get(`/procurement/purchase-orders/${po.id}/lots`), 'lots');
    for (const lot of lots) must(await owner.post(`/procurement/lots/${lot.id}/grade`, { version: lot.version, acceptedQuantity: Number(lot.receivedQuantity), rejectedQuantity: 0, unitCost: 20 }), 'grade');
  };
  const customers = [];
  for (const name of ['Annapurna Mess', 'Bharat Caterers', 'Canteen Central', 'Deccan Dhaba']) {
    customers.push(must(await owner.post('/customers', { name, creditLimit: 100000, paymentTermsDays: 7 }), name));
  }
  const orders = [];
  for (const c of customers) {
    await buy([{ productId: tomato.id, expectedQuantity: 40, indicativePrice: 20 }]);
    const o = must(await owner.post('/orders', { customerId: c.id, lines: [{ productId: tomato.id, quantity: 40, unitPrice: c.name === 'Deccan Dhaba' ? 12 : 32 }] }), 'order');
    orders.push(must(await owner.post(`/orders/${o.id}/confirm`, { version: o.version }), 'confirm'));
  }
  // Pins: depot in the middle; A east, B far east, C west.
  const P = { depot: [18.52, 73.85], Annapurna: [18.52, 73.95], Bharat: [18.52, 74.05], Canteen: [18.52, 73.75] };
  must(await ops.put('/logistics/pins', { kind: 'depot', latitude: P.depot[0], longitude: P.depot[1] }), 'depot pin');
  for (const [i, key] of ['Annapurna', 'Bharat', 'Canteen'].entries()) must(await ops.put('/logistics/pins', { kind: 'customer', refId: customers[i].id, latitude: P[key][0], longitude: P[key][1] }), 'pin');
  const pinList = must(await ops.get('/logistics/pins'), 'pins');
  check('map pins: the depot and three customers pinned', pinList.filter((p) => p.latitude !== null).length >= 4);

  // The below-cost order is delivered on its own trip.
  const van = vehicles.find((v) => v.registrationNumber === 'MH12AB4521');
  // A second vehicle, free and with no lapsed papers, for the load suggestion.
  const spare = must(await owner.post('/vehicles', { registrationNumber: 'MH12AI0001', capacityKg: 1000, fuelType: 'diesel' }), 'spare vehicle');
  let t2 = must(await owner.post('/logistics/trips', { vehicleId: van.id, driverEmployeeId: suresh.id }), 'trip 2');
  must(await owner.post(`/logistics/trips/${t2.id}/stops/delivery`, { orderId: orders[3].id }), 'stop 2');
  t2 = must(await owner.post(`/logistics/trips/${t2.id}/start`, { version: t2.version }), 'start 2');
  const s2 = must(await owner.get(`/logistics/trips/${t2.id}/stops`), 'stops 2');
  must(await owner.post(`/logistics/trips/${t2.id}/stops/${s2[0].id}/complete-delivery`, { recipientName: 'Owner', signatureData: 'data:image/png;base64,iVBORw0KGgo=' }), 'deliver');
  t2 = must(await owner.get(`/logistics/trips/${t2.id}`), "trip 2");
  must(await owner.post(`/logistics/trips/${t2.id}/complete`, { version: t2.version }), "complete 2");
  // A planned trip in a zig-zag order: far east, west, east.
  let trip = must(await owner.post('/logistics/trips', { vehicleId: van.id, driverEmployeeId: suresh.id }), 'trip');
  for (const i of [1, 2, 0]) must(await owner.post(`/logistics/trips/${trip.id}/stops/delivery`, { orderId: orders[i].id }), 'stop');
  // One more confirmed order with nowhere to go yet — a load to plan.
  await buy([{ productId: tomato.id, expectedQuantity: 30, indicativePrice: 20 }]);
  const lone = must(await owner.post('/orders', { customerId: customers[0].id, lines: [{ productId: tomato.id, quantity: 30, unitPrice: 32 }] }), 'order');
  must(await owner.post(`/orders/${lone.id}/confirm`, { version: lone.version }), 'confirm');
  // 50 kg unreserved, costed stock to price; and the older suites' unreceived 3,000 kg order is called off
  // (it would cover tomorrow on its own — and rightly silence the buying suggestion).
  await buy([{ productId: tomato.id, expectedQuantity: 50, indicativePrice: 20 }]);
  for (const x of (await pg.query(`SELECT id, version FROM commerce.purchase_order WHERE status IN ('placed', 'confirmed')`)).rows) {
    must(await owner.post(`/procurement/purchase-orders/${x.id}/cancel`, { version: x.version }), 'cancel stale PO');
  }

  // ---- Run ----
  const noRead = await as(await login('driver@dev.morbeez.local')).post('/ai/runs');
  check('a role without ai:read gets nothing', noRead.status === 403);
  const run = must(await acc.post('/ai/runs'), 'run');
  check('a run produces every type, or says why not', ['procurement', 'pricing', 'logistics_route', 'logistics_load', 'customer_terms', 'exception'].every((t) => t in run.produced || t in run.suppressed), JSON.stringify({ produced: run.produced, suppressed: run.suppressed }));
  const open = must(await owner.get('/ai/recommendations?status=open&pageSize=100'), 'open').items;
  const of = (type, pred = () => true) => open.find((r) => r.type === type && pred(r));

  // 1. Procurement
  const buyRec = of('procurement', (r) => r.subjectId === tomato.id);
  const ev = (r, fact) => r?.evidence.find((e) => e.fact.startsWith(fact))?.value;
  check('buying: Tomato for tomorrow from the same weekday over 4 weeks', buyRec && buyRec.targetDate === tomorrow && ev(buyRec, `${new Date(tomorrow + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' })}s`) === '200 kg, 190 kg, 210 kg, 205 kg' && Number(buyRec.proposal.demand) > 150 && Number(buyRec.proposal.quantity) > 0, buyRec && `${buyRec.title} — ${ev(buyRec, 'Free stock')}, demand ${buyRec.proposal.demand}`);
  check('buying: evidence and a plain explanation, numbers from code', buyRec && buyRec.evidence.length >= 5 && /sold .* on average over the last 4 weeks/.test(buyRec.explanation) && buyRec.producer === 'baseline:procurement@1' && buyRec.confidence === 'solid');
  const opsBuy = await ops.post(`/ai/recommendations/${buyRec.id}/decision`, { outcome: 'dismissed', reason: 'Not now' });
  check('only the owner decides buying (DR.2)', opsBuy.status === 403, msg(opsBuy));
  const qty = Math.round(Number(buyRec.proposal.quantity) * 0.9);
  const po = must(await owner.post('/procurement/purchase-orders', { farmerId: buyRec.proposal.farmerId, lines: [{ productId: tomato.id, expectedQuantity: qty, indicativePrice: Number(buyRec.proposal.indicativePrice) }] }), 'po from rec');
  const d1 = must(await owner.post(`/ai/recommendations/${buyRec.id}/decision`, { outcome: 'acted', submitted: { quantity: qty.toFixed(3), farmerId: buyRec.proposal.farmerId }, resultRef: { kind: 'purchase_order', id: po.id } }), 'decide buy');
  check('the owner places a smaller PO: recorded as changed, with the PO linked', d1.status === 'modified' && d1.decision.resultRef.id === po.id);
  const again = await owner.post(`/ai/recommendations/${buyRec.id}/decision`, { outcome: 'dismissed', reason: 'Changed my mind' });
  check('a decision is final', again.status === 409);

  // 2. Pricing
  const priceRec = of('pricing', (r) => r.subjectId === tomato.id);
  check('price: Tomato, from cost and target margin, inside market prices, capped step', priceRec && Number(priceRec.proposal.price) >= 20 && Number(priceRec.proposal.bandMin) >= 20 && priceRec.proposal.currentPrice === tomato.basePrice && /How it was worked out/.test(priceRec.evidence.map((e) => e.fact).join()), priceRec && `${priceRec.title}: ${priceRec.evidence.map((e) => e.value).join(' | ')}`);
  const fresh = must(await owner.get(`/products/${tomato.id}`), 'product');
  must(await owner.patch(`/products/${tomato.id}`, { version: fresh.version, basePrice: Number(priceRec.proposal.price) }), 'set price');
  const d2 = must(await owner.post(`/ai/recommendations/${priceRec.id}/decision`, { outcome: 'acted', submitted: { price: priceRec.proposal.price } }), 'decide price');
  check('the owner sets the suggested price: accepted, and the product changed', d2.status === 'accepted' && must(await owner.get(`/products/${tomato.id}`), 'p').basePrice === priceRec.proposal.price);

  // 3. Logistics: route, delegated to the ops manager
  const routeRec = of('logistics_route', (r) => r.subjectId === trip.id);
  const names = routeRec && routeRec.proposal.stopIds.map((id) => routeRec.proposal.stopNames[id]);
  check('route: the zig-zag is straightened and costed', routeRec && Number(routeRec.proposal.newKm) < Number(routeRec.proposal.currentKm) && Number(routeRec.expectedImpact) > 0 && Number(routeRec.proposal.currentKm) > 109 && Number(routeRec.proposal.newKm) < 83 && names.length === 3, routeRec && `${routeRec.proposal.currentKm} → ${routeRec.proposal.newKm} km: ${names.join(' → ')}`);
  trip = must(await ops.get(`/logistics/trips/${trip.id}`), 'trip');
  must(await ops.put(`/logistics/trips/${trip.id}/stops/order`, { version: trip.version, stopIds: routeRec.proposal.stopIds }), 'reorder');
  const d3 = must(await ops.post(`/ai/recommendations/${routeRec.id}/decision`, { outcome: 'acted', submitted: { stopIds: routeRec.proposal.stopIds } }), 'decide route');
  const reordered = must(await ops.get(`/logistics/trips/${trip.id}/stops`), 'stops');
  check('the ops manager, delegated routes, reorders the stops', d3.status === 'accepted' && reordered.map((s) => s.id).join() === routeRec.proposal.stopIds.join());
  const stale = await ops.put(`/logistics/trips/${trip.id}/stops/order`, { version: trip.version, stopIds: routeRec.proposal.stopIds });
  check('a stale plan cannot reorder again', stale.status === 409);

  // Load: the order with no trip yet
  const loadRec = of('logistics_load', (r) => r.proposal.orderIds.includes(lone.id));
  check('load: the waiting order gets a free, fit vehicle (not the van already out)', loadRec && !loadRec.proposal.orderIds.some((id) => orders.slice(0, 3).some((o) => o.id === id)) && loadRec.proposal.vehicleId !== van.id && vehicles.concat([spare]).some((v) => v.id === loadRec.proposal.vehicleId), loadRec && `${loadRec.title}`);
  must(await ops.post(`/ai/recommendations/${loadRec.id}/decision`, { outcome: 'dismissed', reason: 'Other: going with the morning run' }), 'dismiss load');

  // 4. Customer profitability
  const report = must(await acc.get(`/ai/customer-profitability?from=${addDays(today, -89)}&to=${today}`), 'profit');
  const dd = report.rows.find((r) => r.customerName === 'Deccan Dhaba');
  const cents = (v) => Math.round(Number(v) * 100);
  const sumOK = report.rows.every((r) => cents(r.contribution) === cents(r.revenue) - cents(r.cogs) - cents(r.deliveryCost) - cents(r.creditCost) - cents(r.crateLossesAbsorbed) + cents(r.financeChargeIncome) + cents(r.crateRecoveries));
  check('profitability: every row adds up; the below-cost customer is in the red', sumOK && dd && Number(dd.revenue) === 480 && Number(dd.cogs) === 800 && Number(dd.contribution) < 0 && report.rows[0].contribution <= report.rows[report.rows.length - 1].contribution, dd && JSON.stringify(dd));
  const opsProfit = await ops.get(`/ai/customer-profitability?from=${today}&to=${today}`);
  check('profitability needs finance access', opsProfit.status === 403);

  // 5. Exceptions
  const below = of('exception', (r) => r.producer === 'baseline:below-cost@1' && /Tomato/.test(r.title));
  check('exception: the invoice priced below its lots is flagged, worded as worth a look', below && !below.sensitive && /below the ₹20/.test(below.explanation), below && below.title);
  must(await owner.post(`/ai/recommendations/${below.id}/decision`, { outcome: 'acted', reason: 'Agreed price for a new customer' }), 'reviewed');

  // Supersede and the track record
  const run2 = must(await owner.post('/ai/runs'), 'run 2');
  const decided = must(await owner.get('/ai/recommendations?status=decided&pageSize=100'), 'decided').items;
  const superseded = decided.filter((r) => r.status === 'expired' && r.decision?.reason === 'Superseded by a newer suggestion');
  check('a fresh run supersedes what was still open; decisions stand', superseded.length > 0 && decided.some((r) => r.id === buyRec.id && r.status === 'modified') && run2.runId !== run.runId);
  const card = must(await owner.get('/ai/scorecard'), 'scorecard');
  const buyT = card.byType.find((t) => t.type === 'procurement');
  check('track record: outcomes by type, and the baseline backtested on history', buyT && buyT.modified === 1 && card.byType.find((t) => t.type === 'pricing').accepted === 1 && card.buying.backtest.wape !== null && card.buying.backtest.wape < 0.25, JSON.stringify(card.buying.backtest));

  // Settings
  const s0 = must(await owner.get('/ai/settings'), 'settings');
  const opsSet = await ops.put('/ai/settings', { ...s0, targetMarginPct: 25, maxPriceMovePct: 15, minCustomerMarginPct: 5, costOfCapitalPct: 12, defaultCostPerKm: 18 });
  const s1 = must(await owner.put('/ai/settings', { version: s0.version, targetMarginPct: 25, maxPriceMovePct: 10, minCustomerMarginPct: 5, costOfCapitalPct: 14, defaultCostPerKm: 20, disabledTypes: ['customer_terms'] }), 'save settings');
  const run3 = must(await owner.post('/ai/runs'), 'run 3');
  check('settings: owner-only; a switched-off type is not computed', opsSet.status === 403 && s1.targetMarginPct === '25.00' && run3.suppressed.customer_terms === 'Switched off in AI settings' && !('customer_terms' in run3.produced));

  await pg.end();
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
})().catch((e) => {
  console.error('FAILED:', e.stack);
  process.exit(1);
});
