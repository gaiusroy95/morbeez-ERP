// Driver app V1, Phase D0 — stock by the kilo, vehicle stock
// (docs/redesign/driver-app-v1-plan.md). Same day, farm to customer: orders
// confirmed before the produce is in, a trip that picks up 985 kg at a farm
// (15 kg rejected there), delivers 600 kg to two customers from the vehicle,
// shows 385 kg left on it, and on closing brings it back to the store —
// stock, cost of goods and the books agreeing. Then a trip that loads part
// of a lot from the store, delivers short and closes with kilos missing;
// and a trip that sets off with an earlier, unclosed trip's stock aboard.
// Runs after the other redesign suites, on the seeded business.
const { API, DB_URL, PASSWORD } = require('../lib/env');
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
  return { raw: call, get: (p) => ok('GET', p), post: (p, b = {}) => ok('POST', p, b) };
}
const SIGNED = { recipientName: 'Manager', signatureData: 'data:image/png;base64,iVBORw0KGgo=' };

(async () => {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  try {
    const owner = client(await login('owner@dev.morbeez.local'));
    const farmers = (await owner.get('/farmers?pageSize=100')).items;
    const workers = (await owner.get('/workforce?pageSize=100')).items;
    const ramesh = farmers.find((f) => f.name === 'Ramesh Patil');
    const suresh = workers.find((w) => w.name === 'Suresh Kale');
    const tenantId = (await db.query('SELECT tenant_id FROM trading_partners.farmer WHERE id = $1', [ramesh.id])).rows[0].tenant_id;

    const beans = await owner.post('/products', { name: 'Beans', category: 'vegetable', baseUom: 'kg', basePrice: 30 });
    const van = await owner.post('/vehicles', { registrationNumber: 'KA09KG0985', capacityKg: 2000, fuelType: 'diesel' });
    const annapurna = await owner.post('/customers', { name: 'Annapurna Mess', place: 'Mysuru', creditLimit: 500000, paymentTermsDays: 15 });
    const udupi = await owner.post('/customers', { name: 'Udupi Grand', place: 'Mysuru', creditLimit: 500000, paymentTermsDays: 15 });

    const ledger = async (account) =>
      Number((await db.query('SELECT COALESCE(SUM(debit - credit), 0) AS v FROM money.ledger_line WHERE tenant_id = $1 AND account_code = $2', [tenantId, account])).rows[0].v);
    const stockValue = async () =>
      Number((await db.query(`SELECT COALESCE(SUM(current_quantity * unit_cost), 0) AS v FROM commerce.lot WHERE tenant_id = $1 AND status = 'available'`, [tenantId])).rows[0].v);
    const before = { inventory: await ledger('inventory_asset'), cogs: await ledger('cost_of_goods_sold'), shrinkage: await ledger('shrinkage_expense'), stock: await stockValue() };
    check('before: the books and the stock agree', Math.abs(before.inventory - before.stock) < 0.005, `${before.inventory} vs ${before.stock}`);

    // ---- Orders taken before the beans are in ----
    const orderA = await owner.post('/orders', { customerId: annapurna.id, confirm: true, lines: [{ productId: beans.id, quantity: 350, unitPrice: 30 }] });
    const orderB = await owner.post('/orders', { customerId: udupi.id, confirm: true, lines: [{ productId: beans.id, quantity: 260, unitPrice: 32 }] });
    check('orders with no beans in the store are still confirmed — the beans are to come', orderA.status === 'confirmed' && orderB.status === 'confirmed' && !orderA.confirmProblem, `${orderA.status} ${orderB.status}`);
    const held = (await db.query('SELECT count(*)::int AS n FROM commerce.lot_allocation a JOIN commerce.customer_order_line ol ON ol.id = a.order_line_id WHERE ol.order_id = ANY($1)', [[orderA.id, orderB.id]])).rows[0].n;
    check('…and nothing is reserved for them', held === 0);

    // ---- The trip: a farm, then the two customers ----
    let po = await owner.post('/procurement/purchase-orders', { farmerId: ramesh.id, lines: [{ productId: beans.id, expectedQuantity: 1000, indicativePrice: 12 }] });
    po = await owner.post(`/procurement/purchase-orders/${po.id}/confirm`, { version: po.version });
    const pickup = await owner.post(`/procurement/purchase-orders/${po.id}/pickups`, {});
    let trip = await owner.post('/logistics/trips', { vehicleId: van.id, driverEmployeeId: suresh.id, advanceAmount: 0 });
    const farmStop = await owner.post(`/logistics/trips/${trip.id}/stops/pickup`, { pickupId: pickup.id });
    const stopA = await owner.post(`/logistics/trips/${trip.id}/stops/delivery`, { orderId: orderA.id });
    const stopB = await owner.post(`/logistics/trips/${trip.id}/stops/delivery`, { orderId: orderB.id });
    let vs = await owner.get(`/logistics/trips/${trip.id}/vehicle-stock`);
    let beansRow = vs.rows.find((r) => r.productId === beans.id);
    check('before the farm: the vehicle is empty and the deliveries are 610 kg short', beansRow?.onVehicle === '0.000' && beansRow.toDeliver === '610.000' && beansRow.short === '610.000', JSON.stringify(beansRow));

    trip = await owner.post(`/logistics/trips/${trip.id}/start`, { version: trip.version });
    const loadedOnStart = (await db.query(`SELECT count(*)::int AS n FROM stock.inventory_movement WHERE trip_id = $1 AND movement_type = 'loaded'`, [trip.id])).rows[0].n;
    check('starting it loads nothing from the store — nothing was reserved there', loadedOnStart === 0);

    await owner.post(`/logistics/trips/${trip.id}/stops/${farmStop.id}/complete-pickup`, {
      weights: [{ productId: beans.id, netQuantity: 985, rejectedQuantity: 15, rejectionReason: 'Damaged' }],
    });
    const [lot] = await owner.get(`/procurement/purchase-orders/${po.id}/lots`);
    check(
      "at the farm: 1,000 kg weighed, 985 accepted at the owner's ₹12, 15 rejected — graded there",
      lot.receivedQuantity === '1000.000' && lot.acceptedQuantity === '985.000' && lot.rejectedQuantity === '15.000' && lot.unitCost === '12.00' && lot.status === 'available' && lot.rejectionReason === 'Damaged',
      JSON.stringify(lot).slice(0, 300),
    );
    const payable = (await db.query('SELECT amount FROM money.farmer_payable WHERE lot_id = $1', [lot.id])).rows[0];
    check('…and Ramesh is owed for the 985 kg at once: ₹11,820', payable?.amount === '11820.00', payable?.amount);
    vs = await owner.get(`/logistics/trips/${trip.id}/vehicle-stock`);
    beansRow = vs.rows.find((r) => r.productId === beans.id);
    check('the 985 kg are on the vehicle, free, covering the 610 kg to deliver', beansRow?.onVehicle === '985.000' && beansRow.free === '985.000' && beansRow.short === '0.000' && vs.registrationNumber === 'KA09KG0985', JSON.stringify(beansRow));
    const ownerView = await owner.get(`/inventory/vehicle-stock?vehicleId=${van.id}`);
    check("the owner's vehicle stock shows them too, at cost", ownerView.length === 1 && ownerView[0].onVehicle === '985.000' && ownerView[0].valueAtCost === '11820.00', JSON.stringify(ownerView));
    const storeAtFarm = (await owner.get('/inventory/stock')).find((r) => r.productId === beans.id);
    check('…counted in stock as on vehicles', storeAtFarm?.physical === '985.000' && storeAtFarm.onVehicles === '985.000', JSON.stringify(storeAtFarm));

    // ---- Deliveries from the vehicle ----
    await owner.post(`/logistics/trips/${trip.id}/stops/${stopA.id}/complete-delivery`, SIGNED);
    const fullB = await owner.get(`/orders/${orderB.id}`);
    const tooMuch = await owner.raw('POST', `/logistics/trips/${trip.id}/stops/${stopB.id}/complete-delivery`, { ...SIGNED, lines: [{ orderLineId: fullB.lines[0].id, deliveredQuantity: 700 }] });
    check("a delivery the vehicle can't cover is refused", tooMuch.status === 409 && /Not enough Beans on the vehicle/.test(tooMuch.body?.error?.message ?? ''), tooMuch.body?.error?.message);
    await owner.post(`/logistics/trips/${trip.id}/stops/${stopB.id}/complete-delivery`, { ...SIGNED, lines: [{ orderLineId: fullB.lines[0].id, deliveredQuantity: 250 }] });
    const deliveredB = await owner.get(`/orders/${orderB.id}`);
    check('Udupi Grand took 250 of the 260 kg ordered — kept on the order line', deliveredB.status === 'delivered' && deliveredB.lines[0].deliveredQuantity === '250.000', JSON.stringify(deliveredB.lines[0]));
    const [invA] = (await owner.get(`/finance/invoices?customerId=${annapurna.id}`)).items;
    const [invB] = (await owner.get(`/finance/invoices?customerId=${udupi.id}`)).items;
    check('each is invoiced on what was delivered: 350 × ₹30, 250 × ₹32', Number(invA?.amount) === 10500 && Number(invB?.amount) === 8000, `${invA?.amount} ${invB?.amount}`);
    const cogs = (await ledger('cost_of_goods_sold')) - before.cogs;
    check('cost of goods is exactly the 600 kg delivered at ₹12: ₹7,200', Math.abs(cogs - 7200) < 0.005, String(cogs));
    vs = await owner.get(`/logistics/trips/${trip.id}/vehicle-stock`);
    beansRow = vs.rows.find((r) => r.productId === beans.id);
    check('385 kg are left on the vehicle, nothing more to deliver', beansRow?.onVehicle === '385.000' && beansRow.toDeliver === '0.000', JSON.stringify(beansRow));
    const qty = await owner.get(`/logistics/trips/${trip.id}/quantities`);
    const qRow = qty.rows.find((r) => r.productId === beans.id);
    check('the quantities: picked up 985, delivered 600 → 385 should be on the vehicle', qRow?.loaded === '0.000' && qRow.procured === '985.000' && qRow.delivered === '600.000' && qRow.expected === '385.000', JSON.stringify(qRow));

    // ---- Closing: the 385 kg go back to the owner ----
    trip = await owner.post(`/logistics/trips/${trip.id}/complete`, { version: (await owner.get(`/logistics/trips/${trip.id}`)).version, cashDeclared: 0 });
    const closed = await owner.post(`/logistics/trips/${trip.id}/reconcile`, { version: trip.version, cashReturned: 0, closingStock: [{ productId: beans.id, quantity: 385 }] });
    check('the count matches: 385 kg counted, 385 kg expected', closed.closingStock?.find((c) => c.productId === beans.id)?.counted === '385.000' && closed.closingStock.find((c) => c.productId === beans.id).expected === '385.000', JSON.stringify(closed.closingStock));
    check('…and the load check passes', closed.checklist.find((c) => c.area === 'load')?.status === 'pass', JSON.stringify(closed.checklist.find((c) => c.area === 'load')));
    const vanAfter = await owner.get(`/inventory/vehicle-stock?vehicleId=${van.id}`);
    const storeAfter = (await owner.get('/inventory/stock')).find((r) => r.productId === beans.id);
    check('closing empties the vehicle into the store: 385 kg free there', vanAfter.length === 0 && storeAfter?.physical === '385.000' && storeAfter.onVehicles === '0.000' && storeAfter.available === '385.000', JSON.stringify(storeAfter));
    const closedQty = (await owner.get(`/logistics/trips/${trip.id}/quantities`)).rows.find((r) => r.productId === beans.id);
    check('…and the trip shows 385 kg came back, nothing written off', closedQty?.returned === '385.000' && closedQty.writtenOff === '0.000', JSON.stringify(closedQty));
    const inv1 = (await ledger('inventory_asset')) - before.inventory;
    const stock1 = (await stockValue()) - before.stock;
    check('the books agree with the stock: +₹11,820 bought − ₹7,200 sold = ₹4,620 = 385 kg × ₹12', Math.abs(inv1 - 4620) < 0.005 && Math.abs(stock1 - 4620) < 0.005, `${inv1} ${stock1}`);

    // ---- Part of a lot loaded from the store; delivered short; kilos missing at closing ----
    const orderC = await owner.post('/orders', { customerId: annapurna.id, confirm: true, lines: [{ productId: beans.id, quantity: 100, unitPrice: 30 }] });
    const storeHeld = (await owner.get('/inventory/stock')).find((r) => r.productId === beans.id);
    check('a new order reserves 100 kg of the 385 in the store — only what it needs', storeHeld?.reserved === '100.000' && storeHeld.available === '285.000', JSON.stringify(storeHeld));
    const orderD = await owner.post('/orders', { customerId: udupi.id, confirm: true, lines: [{ productId: beans.id, quantity: 50, unitPrice: 32 }] });
    await owner.post(`/orders/${orderD.id}/cancel`, { version: orderD.version });
    const storeReleased = (await owner.get('/inventory/stock')).find((r) => r.productId === beans.id);
    check('cancelling an order lets its kilos go', storeReleased?.reserved === '100.000' && storeReleased.available === '285.000', JSON.stringify(storeReleased));

    let trip2 = await owner.post('/logistics/trips', { vehicleId: van.id, driverEmployeeId: suresh.id, advanceAmount: 0 });
    const stopC = await owner.post(`/logistics/trips/${trip2.id}/stops/delivery`, { orderId: orderC.id });
    trip2 = await owner.post(`/logistics/trips/${trip2.id}/start`, { version: trip2.version });
    const split = (await db.query('SELECT location_id IS NULL AS in_store, quantity::text, reserved_quantity::text FROM stock.lot_balance WHERE lot_id = $1 AND quantity > 0 ORDER BY quantity', [lot.id])).rows;
    check(
      'starting the trip loads just the 100 kg reserved — the lot is split: 100 on the vehicle, 285 left in the store',
      split.length === 2 && split[0].in_store === false && split[0].quantity === '100.000' && split[0].reserved_quantity === '100.000' && split[1].in_store === true && split[1].quantity === '285.000',
      JSON.stringify(split),
    );
    const lineC = (await owner.get(`/orders/${orderC.id}`)).lines[0];
    await owner.post(`/logistics/trips/${trip2.id}/stops/${stopC.id}/complete-delivery`, { ...SIGNED, lines: [{ orderLineId: lineC.id, deliveredQuantity: 90 }] });
    vs = await owner.get(`/logistics/trips/${trip2.id}/vehicle-stock`);
    beansRow = vs.rows.find((r) => r.productId === beans.id);
    check('delivered 90 of 100: the other 10 kg are free on the vehicle', beansRow?.onVehicle === '10.000' && beansRow.reserved === '0.000' && beansRow.free === '10.000', JSON.stringify(beansRow));
    trip2 = await owner.post(`/logistics/trips/${trip2.id}/complete`, { version: (await owner.get(`/logistics/trips/${trip2.id}`)).version, cashDeclared: 0 });
    const noReason = await owner.raw('POST', `/logistics/trips/${trip2.id}/reconcile`, { version: trip2.version, cashReturned: 0, closingStock: [{ productId: beans.id, quantity: 8 }] });
    check('2 kg missing at closing is an exception that needs the owner’s reason', noReason.status === 409 && /load/.test(noReason.body?.error?.message ?? ''), noReason.body?.error?.message);
    await owner.post(`/logistics/trips/${trip2.id}/reconcile`, { version: trip2.version, cashReturned: 0, closingStock: [{ productId: beans.id, quantity: 8 }], exceptionNote: 'Two kg went bad' });
    const written = (await db.query(`SELECT quantity::text, reason FROM stock.inventory_movement WHERE trip_id = $1 AND movement_type = 'shrinkage'`, [trip2.id])).rows;
    const shrink = (await ledger('shrinkage_expense')) - before.shrinkage;
    check('the 2 kg are written off at cost (₹24) with the owner’s reason', written.length === 1 && written[0].quantity === '2.000' && written[0].reason === 'Two kg went bad' && Math.abs(shrink - 24) < 0.005, `${JSON.stringify(written)} ${shrink}`);
    const storeEnd = (await owner.get('/inventory/stock')).find((r) => r.productId === beans.id);
    check('the 8 kg counted come back: 293 kg in the store', storeEnd?.physical === '293.000' && storeEnd.onVehicles === '0.000', JSON.stringify(storeEnd));
    const inv2 = (await ledger('inventory_asset')) - before.inventory;
    const stock2 = (await stockValue()) - before.stock;
    check('the books still agree with the stock: ₹4,620 − ₹1,080 sold − ₹24 written off = ₹3,516', Math.abs(inv2 - 3516) < 0.005 && Math.abs(stock2 - 3516) < 0.005, `${inv2} ${stock2}`);
    const lotNow = (await db.query('SELECT current_quantity::text AS q, (SELECT SUM(quantity)::text FROM stock.lot_balance WHERE lot_id = $1) AS placed FROM commerce.lot WHERE id = $1', [lot.id])).rows[0];
    check("the lot's total is always the sum of its places", lotNow.q === lotNow.placed && lotNow.q === '293.000', JSON.stringify(lotNow));

    // ---- A trip not closed yet: the next one sets off with its stock aboard ----
    const orderE = await owner.post('/orders', { customerId: udupi.id, confirm: true, lines: [{ productId: beans.id, quantity: 20, unitPrice: 32 }] });
    let trip3 = await owner.post('/logistics/trips', { vehicleId: van.id, driverEmployeeId: suresh.id, advanceAmount: 0 });
    const stopE = await owner.post(`/logistics/trips/${trip3.id}/stops/delivery`, { orderId: orderE.id });
    trip3 = await owner.post(`/logistics/trips/${trip3.id}/start`, { version: trip3.version });
    await owner.post(`/logistics/trips/${trip3.id}/stops/${stopE.id}/skip`, { reason: 'Shop shut' });
    trip3 = await owner.post(`/logistics/trips/${trip3.id}/complete`, { version: (await owner.get(`/logistics/trips/${trip3.id}`)).version, cashDeclared: 0 });
    const orderF = await owner.post('/orders', { customerId: annapurna.id, confirm: true, lines: [{ productId: beans.id, quantity: 10, unitPrice: 30 }] });
    let trip4 = await owner.post('/logistics/trips', { vehicleId: van.id, driverEmployeeId: suresh.id, advanceAmount: 0 });
    const stopF = await owner.post(`/logistics/trips/${trip4.id}/stops/delivery`, { orderId: orderF.id });
    trip4 = await owner.post(`/logistics/trips/${trip4.id}/start`, { version: trip4.version });
    const q4 = (await owner.get(`/logistics/trips/${trip4.id}/quantities`)).rows.find((r) => r.productId === beans.id);
    check(
      "the next trip sets off with the 20 kg the last one brought back still aboard, plus its own 10 kg",
      q4?.loaded === '30.000' && q4.expected === '30.000',
      JSON.stringify(q4),
    );
    const closed3 = await owner.post(`/logistics/trips/${trip3.id}/reconcile`, {
      version: trip3.version,
      cashReturned: 0,
      closingStock: [{ productId: beans.id, quantity: 20 }],
      exceptionNote: 'Udupi Grand was shut',
    });
    const vanStill = await owner.get(`/inventory/vehicle-stock?vehicleId=${van.id}`);
    check(
      'closing the earlier trip counts against its own 20 kg and moves nothing — the van has gone on with it',
      closed3.closingStock?.find((c) => c.productId === beans.id)?.expected === '20.000' && vanStill[0]?.onVehicle === '30.000',
      `${JSON.stringify(closed3.closingStock)} ${JSON.stringify(vanStill)}`,
    );
    const lineF = (await owner.get(`/orders/${orderF.id}`)).lines[0];
    await owner.post(`/logistics/trips/${trip4.id}/stops/${stopF.id}/complete-delivery`, { ...SIGNED, lines: [{ orderLineId: lineF.id, deliveredQuantity: 10 }] });
    trip4 = await owner.post(`/logistics/trips/${trip4.id}/complete`, { version: (await owner.get(`/logistics/trips/${trip4.id}`)).version, cashDeclared: 0 });
    await owner.post(`/logistics/trips/${trip4.id}/reconcile`, { version: trip4.version, cashReturned: 0, closingStock: [{ productId: beans.id, quantity: 20 }] });
    const storeLast = (await owner.get('/inventory/stock')).find((r) => r.productId === beans.id);
    check(
      "the later trip's closing brings the 20 kg back, still held for Udupi Grand's order: 283 kg in the store, 20 of them reserved",
      (await owner.get(`/inventory/vehicle-stock?vehicleId=${van.id}`)).length === 0 && storeLast?.physical === '283.000' && storeLast.reserved === '20.000',
      JSON.stringify(storeLast),
    );

    const unbalanced = await db.query('SELECT e.id FROM money.ledger_entry e JOIN money.ledger_line l ON l.entry_id = e.id GROUP BY e.id HAVING SUM(l.debit) <> SUM(l.credit)');
    check('every ledger entry balances', unbalanced.rowCount === 0);
  } finally {
    await db.end();
  }
  console.log(results.join('\n'));
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);
})().catch((e) => {
  console.log(results.join('\n'));
  console.error('FAILED:', e.message);
  process.exit(1);
});
