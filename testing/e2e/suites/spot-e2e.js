// Driver spot sales through the real HTTP API, after the other suites
// (onion carries 5% GST, tomato is exempt; MH12AB4521 is fit for trips).
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
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), put: (p, b) => call('PUT', p, b) };
}
const must = (r, what) => {
  if (r.status >= 300) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const msg = (r) => r.body?.error?.message ?? JSON.stringify(r.body);
const cents = (v) => Math.round(Number(v) * 100);
const money = (c) => (c / 100).toFixed(2);

(async () => {
  // Provisioning (DRV.16): the seeded driver login is Suresh's.
  const pg = new Client({ connectionString: DB_URL });
  await pg.connect();
  await pg.query(`UPDATE trading_partners.employee SET user_id = (SELECT id FROM identity.app_user WHERE email = 'driver@dev.morbeez.local') WHERE name = 'Suresh Kale'`);
  await pg.end();

  const owner = as(await login('owner@dev.morbeez.local'));
  const ops = as(await login('ops-manager@dev.morbeez.local'));
  const acc = as(await login('accountant@dev.morbeez.local'));
  const driverLogin = as(await login('driver@dev.morbeez.local'));
  const today = must(await owner.get('/accounting/periods'), 'periods').today;
  const bal = async () => Object.fromEntries(must(await owner.get('/accounting/accounts'), 'accounts').map((a) => [a.code, a.balance]));

  const products = must(await owner.get('/products?page=1&pageSize=50'), 'products').items;
  const tomato = products.find((p) => p.name === 'Tomato');
  const onion = products.find((p) => p.name === 'Onion');
  const farmers = must(await owner.get('/farmers?page=1&pageSize=50'), 'farmers').items;
  const ramesh = farmers.find((f) => f.name === 'Ramesh Patil');
  const vehicles = must(await owner.get('/vehicles?page=1&pageSize=50'), 'vehicles').items;
  const van = vehicles.find((v) => v.registrationNumber === 'MH12AB4521');
  const staff = must(await owner.get('/workforce?page=1&pageSize=50'), 'staff').items;
  const suresh = staff.find((e) => e.name === 'Suresh Kale');
  const hotel = must(await owner.get('/customers?page=1&pageSize=50'), 'customers').items.find((c) => c.name === 'Hotel Sagar');

  const buy = async (lines) => {
    const po = must(await owner.post('/procurement/purchase-orders', { farmerId: ramesh.id, lines }), 'po');
    must(await owner.post(`/procurement/purchase-orders/${po.id}/confirm`, { version: po.version }), 'po confirm');
    must(await owner.post(`/procurement/purchase-orders/${po.id}/receive-goods`, { lines: lines.map((l) => ({ productId: l.productId, receivedQuantity: l.expectedQuantity })) }), 'receive');
    const lots = must(await owner.get(`/procurement/purchase-orders/${po.id}/lots`), 'lots');
    const graded = [];
    for (const l of lines) {
      const lot = lots.find((x) => x.productId === l.productId);
      graded.push(must(await owner.post(`/procurement/lots/${lot.id}/grade`, { version: lot.version, acceptedQuantity: l.expectedQuantity, rejectedQuantity: 0, unitCost: l.indicativePrice }), 'grade'));
    }
    return graded;
  };

  // A delivery to start the trip with (its order reserves its own stock first).
  await buy([{ productId: tomato.id, expectedQuantity: 5, indicativePrice: 20 }]);
  const o = must(await owner.post('/orders', { customerId: hotel.id, lines: [{ productId: tomato.id, quantity: 5, unitPrice: 32 }] }), 'order');
  must(await owner.post(`/orders/${o.id}/confirm`, { version: o.version }), 'order confirm');

  // Stock for the road: 50 kg tomato at 20, 30 kg onion at 40, moved onto the van.
  const [tLot, oLot] = await buy([
    { productId: tomato.id, expectedQuantity: 50, indicativePrice: 20 },
    { productId: onion.id, expectedQuantity: 30, indicativePrice: 40 },
  ]);
  const loc = must(await owner.post('/inventory/locations', { name: 'Van MH12AB4521', type: 'vehicle', vehicleId: van.id }), 'location');
  for (const lot of [tLot, oLot]) must(await owner.post(`/inventory/lots/${lot.id}/transfer`, { version: lot.version, toLocationId: loc.id }), 'transfer');

  let trip = must(await owner.post('/logistics/trips', { vehicleId: van.id, driverEmployeeId: suresh.id, advanceAmount: 500 }), 'trip');
  must(await owner.post(`/logistics/trips/${trip.id}/stops/delivery`, { orderId: o.id }), 'stop');
  const planned = await driverLogin.post('/spot-sales', { clientRef: randomUUID(), tripId: trip.id, paymentMethod: 'cash', lines: [{ productId: tomato.id, quantity: 1, unitPrice: 30 }] });
  check('only on a trip on the road', planned.status === 409 && /on the road/.test(msg(planned)), msg(planned));
  trip = must(await owner.post(`/logistics/trips/${trip.id}/start`, { version: trip.version }), 'start');

  // ---- Price bands ----
  must(await ops.post('/spot-sales/price-bands', { productId: onion.id, minPrice: 35, maxPrice: 50, effectiveFrom: '2026-04-01', notes: 'Mandi rate' }), 'band');
  const accBand = await acc.post('/spot-sales/price-bands', { productId: tomato.id, minPrice: 1, effectiveFrom: '2026-04-01' });
  check('only spot_sales:configure sets bands', accBand.status === 403);
  const stock = must(await driverLogin.get(`/spot-sales/trips/${trip.id}/stock`), 'stock');
  const st = stock.find((s) => s.productId === tomato.id);
  const so = stock.find((s) => s.productId === onion.id);
  check("the driver sees the van's stock and each band: tomato by default ±10/25% of ₹32, onion its own", st?.sellable === '50.000' && st.band.source === 'default' && st.band.min === '28.80' && st.band.max === '40.00' && so?.band.source === 'band' && so.band.min === '35.00', JSON.stringify(stock.map((s) => [s.productName, s.sellable, s.band])));

  const before = await bal();

  // ---- In band: completes at once ----
  const ref1 = randomUUID();
  const s1 = must(await driverLogin.post('/spot-sales', { clientRef: ref1, tripId: trip.id, paymentMethod: 'cash', buyerName: 'Roadside stall', lines: [{ productId: tomato.id, quantity: 20, unitPrice: 30 }, { productId: onion.id, quantity: 10, unitPrice: 45 }] }), 'sale 1');
  // The driver's copy never carries cost (Security Audit SA-05); the owner's does.
  const s1Owner = must(await owner.get(`/spot-sales/${s1.id}`), 'sale as owner');
  check('the driver gets the sale back without cost or margin', s1.costTotal === null && s1.margin === null && s1.lines.every((l) => l.unitCostEstimate === null && l.lots.length === 0));
  check('in band: completed, invoiced with onion GST 5%, costed at the lots\' cost', s1.status === 'completed' && /^SPT-\d{6}$/.test(s1.invoiceNumber) && s1.subtotal === '1050.00' && s1.taxTotal === '22.50' && s1.total === '1072.50' && s1Owner.costTotal === '800.00' && s1Owner.margin === '250.00', JSON.stringify({ st: s1.status, inv: s1.invoiceNumber, total: s1.total, tax: s1.taxTotal, cost: s1Owner.costTotal }));
  const again = must(await driverLogin.post('/spot-sales', { clientRef: ref1, tripId: trip.id, paymentMethod: 'cash', lines: [{ productId: tomato.id, quantity: 20, unitPrice: 30 }] }), 'replay');
  check('a replayed operation returns the same sale, sold once (DRV.6)', again.id === s1.id);
  const lots = must(await owner.get(`/inventory/products/${tomato.id}/lots`), 'lots');
  const tNow = lots.find((l) => l.id === tLot.id);
  const moves = must(await owner.get(`/inventory/lots/${tLot.id}/movements?page=1&pageSize=20`), 'moves').items;
  check('inventory: the van\'s lot drawn down, with a spot_sold movement', tNow.currentQuantity === '30.000' && moves.some((m) => m.movementType === 'spot_sold' && m.quantity === '20.000'), `${tNow.currentQuantity}; ${moves.map((m) => m.movementType).join(',')}`);

  // ---- Out of band: held for approval ----
  const s2 = must(await driverLogin.post('/spot-sales', { clientRef: randomUUID(), tripId: trip.id, paymentMethod: 'upi', paymentReference: 'UPI-778812', lines: [{ productId: tomato.id, quantity: 10, unitPrice: 25 }] }), 'sale 2');
  check('below the band: awaiting approval, sized by the shortfall (3.80 × 10)', s2.status === 'pending_approval' && s2.exceptionValue === '38.00' && s2.lines[0].exception === 'below_band' && s2.invoiceId === null);
  const stock2 = must(await driverLogin.get(`/spot-sales/trips/${trip.id}/stock`), 'stock');
  check('its stock is held, not drawn', stock2.find((s) => s.productId === tomato.id).held === '10.000' && stock2.find((s) => s.productId === tomato.id).sellable === '20.000');
  const tooMuch = await driverLogin.post('/spot-sales', { clientRef: randomUUID(), tripId: trip.id, paymentMethod: 'cash', lines: [{ productId: tomato.id, quantity: 25, unitPrice: 30 }] });
  check("can't sell more than is free on the van", tooMuch.status === 409 && /only 20.000 kg of Tomato free/.test(msg(tooMuch)), msg(tooMuch));
  const selfDecide = await driverLogin.post(`/spot-sales/${s2.id}/decision`, { approved: true });
  const accDecide = await acc.post(`/spot-sales/${s2.id}/decision`, { approved: true });
  check('the driver cannot decide; the accountant has no spot-price limit', selfDecide.status === 403 && accDecide.status === 403, `${msg(accDecide)}`);
  const upiBefore = await bal();
  const s2done = must(await ops.post(`/spot-sales/${s2.id}/decision`, { approved: true, note: 'Last crate, soft fruit' }), 'approve');
  const upiAfter = await bal();
  check('approved within the ops manager\'s limit: completes, UPI to the bank', s2done.status === 'completed' && s2done.approvalStatus === 'approved' && cents(upiAfter.bank) - cents(upiBefore.bank) === 25000, `${s2done.status} bank +${money(cents(upiAfter.bank) - cents(upiBefore.bank))}`);

  // Rejected: onion under cost.
  const s3 = must(await driverLogin.post('/spot-sales', { clientRef: randomUUID(), tripId: trip.id, paymentMethod: 'cash', lines: [{ productId: onion.id, quantity: 5, unitPrice: 20 }] }), 'sale 3');
  check('under cost as well as the band: the larger gap counts', s3.lines[0].exception === 'below_cost' && s3.exceptionValue === '100.00', `${s3.lines[0].exception} ${s3.exceptionValue}`);
  const s3done = must(await ops.post(`/spot-sales/${s3.id}/decision`, { approved: false, note: 'Too cheap' }), 'reject');
  check('rejected: closed, stock released', s3done.status === 'rejected' && /Too cheap/.test(s3done.closedReason));

  // Withdrawn by the driver.
  const s4 = must(await driverLogin.post('/spot-sales', { clientRef: randomUUID(), tripId: trip.id, paymentMethod: 'cash', lines: [{ productId: tomato.id, quantity: 5, unitPrice: 45 }] }), 'sale 4');
  const s4done = must(await driverLogin.post(`/spot-sales/${s4.id}/cancel`), 'cancel');
  check('above the ceiling, then withdrawn by the driver', s4.lines[0].exception === 'above_band' && s4.exceptionValue === '25.00' && s4done.status === 'cancelled');

  // Past the ops manager's limit: only the owner can approve.
  const s5 = must(await driverLogin.post('/spot-sales', { clientRef: randomUUID(), tripId: trip.id, paymentMethod: 'cash', lines: [{ productId: onion.id, quantity: 20, unitPrice: 5 }] }), 'sale 5');
  const opsBig = await ops.post(`/spot-sales/${s5.id}/decision`, { approved: true });
  const s5done = must(await owner.post(`/spot-sales/${s5.id}/decision`, { approved: true }), 'owner approves');
  // (40 cost − 5) × 20 beats (35 floor − 5) × 20
  check('an exception past the ops limit (₹700 under cost > ₹500) goes to the owner', s5.exceptionValue === '700.00' && opsBig.status === 403 && s5done.status === 'completed' && s5done.total === '105.00', `${s5.exceptionValue} ${msg(opsBig)}`);

  // Someone else's trip.
  const vijay = must(await owner.post('/workforce', { name: 'Vijay Rao', roleType: 'driver' }), 'vijay');
  const other = vehicles.find((v) => v.registrationNumber === 'MH14HR7777');
  const vTrip = must(await owner.post('/logistics/trips', { vehicleId: other.id, driverEmployeeId: vijay.id }), 'other trip');
  const notMine = await driverLogin.post('/spot-sales', { clientRef: randomUUID(), tripId: vTrip.id, paymentMethod: 'cash', lines: [{ productId: tomato.id, quantity: 1, unitPrice: 30 }] });
  const notMineStock = await driverLogin.get(`/spot-sales/trips/${vTrip.id}/stock`);
  check("a driver can't sell from, or see, another driver's trip (DRV.15)", notMine.status === 403 && notMineStock.status === 403);
  const mine = must(await driverLogin.get('/spot-sales?pageSize=100'), 'my sales').items;
  check('a driver lists only their own sales', mine.length === 5 && mine.every((s) => s.driverName === 'Suresh Kale'));

  // ---- The books ----
  const after = await bal();
  const d = (code) => cents(after[code] ?? '0') - cents(before[code] ?? '0');
  // revenue 1050 + 250 + 100; COGS 800 + 200 + 800; GST 22.50 + 5; cash 1072.50 + 105; bank 250
  check('sales, cost of goods and GST booked', d('revenue_sales') === 140000 && d('cost_of_goods_sold') === 180000 && d('inventory_asset') === -180000 && d('output_cgst') + d('output_sgst') === 2750, JSON.stringify({ rev: d('revenue_sales'), cogs: d('cost_of_goods_sold'), gst: d('output_cgst') + d('output_sgst') }));
  check('cash sits with the driver; the walk-in customer owes nothing', d('cash_with_drivers') === 117750 && d('bank') === 25000 && d('accounts_receivable') === 0, JSON.stringify({ cwd: d('cash_with_drivers'), bank: d('bank'), ar: d('accounts_receivable') }));
  const summary = must(await ops.get(`/spot-sales/summary?from=${today}&to=${today}`), 'summary');
  check('summary', summary.completed === 3 && summary.revenue === '1400.00' && summary.cost === '1800.00' && summary.margin === '-400.00' && summary.cash === '1177.50' && summary.upi === '250.00' && summary.exceptionsApproved === 2, JSON.stringify(summary));
  const reg = must(await owner.get(`/tax/invoices?from=${today}&to=${today}`), 'register');
  check('the GST register includes spot-sale invoices', reg.some((i) => i.invoiceNumber === s1.invoiceNumber && i.total === '1072.50'));

  // ---- Reconciliation expects the spot cash back ----
  const stops = must(await owner.get(`/logistics/trips/${trip.id}/stops`), 'stops');
  must(await owner.post(`/logistics/trips/${trip.id}/stops/${stops[0].id}/complete-delivery`, { recipientName: 'Manager', signatureData: 'data:image/png;base64,iVBORw0KGgo=' }), 'deliver');
  trip = must(await owner.get(`/logistics/trips/${trip.id}`), 'trip');
  trip = must(await owner.post(`/logistics/trips/${trip.id}/complete`, { version: trip.version }), 'complete');
  const afterTrip = await driverLogin.post('/spot-sales', { clientRef: randomUUID(), tripId: trip.id, paymentMethod: 'cash', lines: [{ productId: tomato.id, quantity: 1, unitPrice: 30 }] });
  check('no spot sales once the trip is back', afterTrip.status === 409);
  const cwdBefore = cents((await bal()).cash_with_drivers);
  const rec = must(await owner.post(`/logistics/trips/${trip.id}/reconcile`, { version: trip.version, cashReturned: 1677.5 }), 'reconcile');
  const cwdAfter = cents((await bal()).cash_with_drivers);
  check('reconciliation: advance 500 + spot cash 1,177.50 returned in full, no variance', rec.spotCash === '1177.50' && Number(rec.variance) === 0 && cwdBefore - cwdAfter === 167750, `${rec.spotCash} var ${rec.variance}`);
  const tb = must(await owner.get('/accounting/trial-balance'), 'tb');
  check('trial balance balances', tb.balanced);

  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
})().catch((e) => {
  console.error('FAILED:', e.stack);
  process.exit(1);
});
