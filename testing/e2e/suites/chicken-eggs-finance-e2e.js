// Live chicken, eggs, pricing, finance charges and disputes through the real
// API (client Q&A 1–2 Oct 2026): the farm weighment received at the pickup,
// a customer-end weight settling the invoice with shrinkage checked against
// the owner's tolerance, eggs by the tray with breakage at grading and on
// delivery, the last actual price suggested for a new order, the finance
// charge at an annual rate ÷ 365 paused on a disputed amount, and a dispute
// left untouched for 30 days alerting the owner. Makes its own data.
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
    const res = await call(method, path, body);
    if (res.status >= 300) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  };
  return { raw: call, get: (p) => ok('GET', p), post: (p, b = {}) => ok('POST', p, b), patch: (p, b) => ok('PATCH', p, b) };
}

(async () => {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const owner = client(await login('owner@dev.morbeez.local'));
  const s = Date.now().toString(36);

  try {
    // ---- Setup ----
    const farmer = await owner.post('/farmers', { name: `Poultry Farm ${s}` });
    const vehicle = await owner.post('/vehicles', { registrationNumber: `KL09${s}`.slice(0, 12).toUpperCase(), capacityKg: 2000, fuelType: 'diesel' });
    const driver = await owner.post('/workforce', { name: `Chicken Driver ${s}`, roleType: 'driver' });
    const hotel = await owner.post('/customers', { name: `Hotel Malabar ${s}`, creditLimit: 500000, paymentTermsDays: 7 });
    const shop = await owner.post('/customers', { name: `Egg Shop ${s}`, creditLimit: 500000, paymentTermsDays: 7 });
    await owner.patch('/tenants/me', { defaultShrinkageTolerancePct: 2, defaultBreakageTolerancePct: 1, weighmentPhoto: 'optional' });

    // ---- Products ----
    const birds = await owner.post('/products', { name: `Broiler live ${s}`, baseUom: 'unit', kind: 'live_bird' });
    check('live birds are sold by kg, with no base price', birds.kind === 'live_bird' && birds.baseUom === 'kg' && birds.basePrice === null, `${birds.baseUom} ${birds.basePrice}`);
    const eggs = await owner.post('/products', { name: `Eggs ${s}`, baseUom: 'unit', kind: 'egg', packSize: 30 });
    check('eggs are counted in pieces, 30 to a tray', eggs.kind === 'egg' && eggs.baseUom === 'piece' && eggs.packSize === 30);
    const badTray = await owner.raw('POST', '/products', { name: `Okra ${s}`, baseUom: 'kg', packSize: 30 });
    check('only eggs come in trays', badTray.status === 400, String(badTray.status));

    // ---- Farm weighment at the pickup ----
    const deliverTrip = async (order, lines) => {
      let trip = await owner.post('/logistics/trips', { vehicleId: vehicle.id, driverEmployeeId: driver.id, advanceAmount: 0 });
      const stop = await owner.post(`/logistics/trips/${trip.id}/stops/delivery`, { orderId: order.id });
      trip = await owner.post(`/logistics/trips/${trip.id}/start`, { version: trip.version });
      const res = await owner.raw('POST', `/logistics/trips/${trip.id}/stops/${stop.id}/complete-delivery`, { recipientName: 'Manager', signatureData: 'data:image/png;base64,iVBORw0KGgo=', lines });
      return { trip, stop, res };
    };
    const buyBirds = async (kg) => {
      let po = await owner.post('/procurement/purchase-orders', { farmerId: farmer.id, lines: [{ productId: birds.id, expectedQuantity: kg, indicativePrice: 95 }] });
      po = await owner.post(`/procurement/purchase-orders/${po.id}/confirm`, { version: po.version });
      const pickup = await owner.post(`/procurement/purchase-orders/${po.id}/pickups`, {});
      let trip = await owner.post('/logistics/trips', { vehicleId: vehicle.id, driverEmployeeId: driver.id, advanceAmount: 0 });
      const stop = await owner.post(`/logistics/trips/${trip.id}/stops/pickup`, { pickupId: pickup.id });
      trip = await owner.post(`/logistics/trips/${trip.id}/start`, { version: trip.version });
      await owner.post(`/logistics/trips/${trip.id}/stops/${stop.id}/complete-pickup`, { weights: [{ productId: birds.id, netQuantity: kg }] });
      const [lot] = await owner.get(`/procurement/purchase-orders/${po.id}/lots`);
      await owner.post(`/procurement/lots/${lot.id}/grade`, { version: lot.version, acceptedQuantity: kg, rejectedQuantity: 0, unitCost: 95, grade: 'A' });
      return lot;
    };
    // The confirm response carries no lines; read the order back for them.
    const confirmOrder = async (path, body) => {
      const o = await owner.post(path, body);
      return owner.get(`/orders/${o.id}`);
    };
    const lot = await buyBirds(500);
    check('the farm weight entered at the pickup receives the goods', Number(lot.receivedQuantity) === 500 && lot.pickupId !== null, `${lot.receivedQuantity}`);

    // ---- Customer-end weight settles the sale ----
    const order1 = await owner.post('/orders', { customerId: hotel.id, lines: [{ productId: birds.id, quantity: 500, unitPrice: 120 }] });
    const confirmed1 = await confirmOrder(`/orders/${order1.id}/confirm`, { version: order1.version });
    const d1 = await deliverTrip(confirmed1, [{ orderLineId: confirmed1.lines[0].id, customerWeight: 490 }]);
    const [inv1] = (await owner.get(`/finance/invoices?customerId=${hotel.id}`)).items;
    check("the invoice is on the customer's weight: 490 kg × ₹120", d1.res.status < 300 && Number(inv1?.amount) === 58800, `${d1.res.status} ${inv1?.amount}`);
    const m1 = (await db.query('SELECT * FROM fulfilment.delivery_line_measure WHERE trip_stop_id = $1', [d1.stop.id])).rows[0];
    check('the measure keeps both weights: 500 farm, 490 customer, 2% — within tolerance', m1 && m1.dispatched_quantity === '500.000' && m1.settled_quantity === '490.000' && m1.loss_pct === '2.00' && m1.within_tolerance === true, JSON.stringify(m1 && { d: m1.dispatched_quantity, s: m1.settled_quantity, p: m1.loss_pct }));

    await buyBirds(300);
    const order2 = await owner.post('/orders', { customerId: hotel.id, lines: [{ productId: birds.id, quantity: 300 }] });
    check("a new order is priced at the customer's last actual price", Number(order2.lines[0].unitPrice) === 120, order2.lines[0].unitPrice);
    const confirmed2 = await confirmOrder(`/orders/${order2.id}/confirm`, { version: order2.version });
    await owner.patch('/tenants/me', { weighmentPhoto: 'required' });
    const noPhoto = await deliverTrip(confirmed2, [{ orderLineId: confirmed2.lines[0].id, customerWeight: 288 }]);
    check("when the owner requires it, a customer weight needs the scale photo", noPhoto.res.status === 400 && /Photograph/.test(noPhoto.res.body?.error?.message ?? ''), noPhoto.res.body?.error?.message);
    await owner.patch('/tenants/me', { weighmentPhoto: 'optional' });
    const d2 = await owner.raw('POST', `/logistics/trips/${noPhoto.trip.id}/stops/${noPhoto.stop.id}/complete-delivery`, {
      recipientName: 'Manager',
      signatureData: 'data:image/png;base64,iVBORw0KGgo=',
      lines: [{ orderLineId: confirmed2.lines[0].id, customerWeight: 288 }],
    });
    const alerts = await owner.get('/alerts?unread=true');
    const shrink = alerts.find((a) => a.kind === 'shrinkage' && a.tripId === noPhoto.trip.id);
    check('shrinkage above tolerance (12 of 300 kg, 4%) alerts the owner', d2.status < 300 && !!shrink && /4\.00%/.test(shrink.title), shrink?.title ?? `${d2.status} ${JSON.stringify(d2.body)}`);
    await owner.post(`/logistics/trips/${noPhoto.trip.id}/complete`, { version: (await owner.get(`/logistics/trips/${noPhoto.trip.id}`)).version, cashDeclared: 0 });
    const review = await owner.get(`/logistics/trips/${noPhoto.trip.id}/review`);
    const load = review.checklist.find((c) => c.area === 'load');
    check('…and is a load exception when closing the trip', load.status === 'exception' && /Shrinkage 4\.00%/.test(load.detail), load.detail);

    // ---- Pricing suggestions ----
    const sugg = await owner.get(`/orders/price-suggestions?customerId=${shop.id}&productIds=${birds.id},${eggs.id}`);
    const byId = Object.fromEntries(sugg.map((x) => [x.productId, x]));
    check("another customer is suggested the product's last price", byId[birds.id].price === '120.00' && byId[birds.id].source === 'product_last', JSON.stringify(byId[birds.id]));
    check('a never-sold product has no suggestion', byId[eggs.id].price === null);
    const unpriced = await owner.raw('POST', '/orders', { customerId: shop.id, lines: [{ productId: eggs.id, quantity: 30 }] });
    check('…so an order for it needs a price — none is invented', unpriced.status === 400 && /never been sold/.test(unpriced.body?.error?.message ?? ''), unpriced.body?.error?.message);

    // ---- Eggs: breakage at grading and on delivery ----
    let epo = await owner.post('/procurement/purchase-orders', { farmerId: farmer.id, lines: [{ productId: eggs.id, expectedQuantity: 300, indicativePrice: 5 }] });
    epo = await owner.post(`/procurement/purchase-orders/${epo.id}/confirm`, { version: epo.version });
    await owner.post(`/procurement/purchase-orders/${epo.id}/receive-goods`, { lines: [{ productId: eggs.id, receivedQuantity: 300 }] });
    const [elot] = await owner.get(`/procurement/purchase-orders/${epo.id}/lots`);
    await owner.post(`/procurement/lots/${elot.id}/grade`, { version: elot.version, acceptedQuantity: 291, rejectedQuantity: 9, unitCost: 5, rejectionReason: 'Broken' });
    const lotAlert = (await owner.get('/alerts?unread=true')).find((a) => a.kind === 'breakage' && a.title.includes(eggs.name));
    check('eggs broken at grading above tolerance (9 of 300, 3%) alert the owner', !!lotAlert && /3\.00%/.test(lotAlert.title), lotAlert?.title);
    const eorder = await owner.post('/orders', { customerId: shop.id, lines: [{ productId: eggs.id, quantity: 270, unitPrice: 6 }] }); // 9 trays
    const econf = await confirmOrder(`/orders/${eorder.id}/confirm`, { version: eorder.version });
    const ed = await deliverTrip(econf, [{ orderLineId: econf.lines[0].id, brokenQuantity: 6 }]);
    const [einv] = (await owner.get(`/finance/invoices?customerId=${shop.id}`)).items;
    check('broken eggs come off the invoice: 264 × ₹6', ed.res.status < 300 && Number(einv?.amount) === 1584, `${ed.res.status} ${einv?.amount}`);
    const repeat = await owner.post('/orders', { customerId: shop.id, lines: [{ productId: eggs.id, quantity: 30 }] });
    check('the next egg order is priced from that sale', Number(repeat.lines[0].unitPrice) === 6, repeat.lines[0].unitPrice);

    // ---- Finance charge: annual rate ÷ 365, paused on a disputed amount ----
    const today = (await db.query(`SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS d`)).rows[0].d;
    let terms = await owner.get(`/customers/${hotel.id}`);
    terms = await owner.post(`/customers/${hotel.id}/credit-terms`, { version: terms.version, financeChargeRateAnnual: 18.25, financeChargeGraceDays: 0 });
    check('credit terms take an annual rate', terms.financeChargeRateAnnual === '18.25', terms.financeChargeRateAnnual);
    const hotelInvoices = (await owner.get(`/finance/invoices?customerId=${hotel.id}`)).items;
    for (const i of hotelInvoices) {
      await db.query(`UPDATE money.invoice SET due_date = $2::date - 20, issued_at = issued_at - interval '27 days' WHERE id = $1`, [i.id, today]);
    }
    const [invA, invB] = hotelInvoices;
    const tooBig = await owner.raw('POST', '/finance/disputes', { invoiceId: invB.id, amount: Number(invB.amount) + 1, reason: 'All of it' });
    check('a dispute can be no larger than what is owed', tooBig.status === 400, String(tooBig.status));
    const dispute = await owner.post('/finance/disputes', { invoiceId: invB.id, amount: 10000, reason: '12 kg short against the farm weight' });
    const run = await owner.post('/finance/finance-charges/run', { asOf: today });
    const chargeOf = (inv) => run.charges.find((c) => c.sourceInvoiceId === inv.id);
    const expect = (principal) => (Math.round(principal * 0.1825 * 20 / 365 * 100) / 100).toFixed(2);
    const cA = chargeOf(invA);
    const cB = chargeOf(invB);
    check('the charge is outstanding × 18.25% × 20 days ÷ 365', cA && cA.amount === expect(Number(invA.amount)) && cA.rateAnnualPercent === '18.25', `${cA?.amount} vs ${expect(Number(invA.amount))}`);
    check('…and leaves out the disputed ₹10,000', cB && cB.principal === (Number(invB.amount) - 10000).toFixed(2) && cB.amount === expect(Number(invB.amount) - 10000), `${cB?.principal} ${cB?.amount}`);

    // ---- A dispute left alone for 30 days ----
    await owner.post(`/finance/disputes/${dispute.id}/notes`, { note: 'Asked the driver for the scale slip' });
    await db.query(`UPDATE money.invoice_dispute SET last_activity_at = now() - interval '31 days' WHERE id = $1`, [dispute.id]);
    await owner.get('/alerts/unread-count');
    const stale = (await owner.get('/alerts?unread=true')).find((a) => a.kind === 'dispute_stale' && a.title.includes(hotel.name));
    check('untouched for 30 days, the dispute is a critical exception', !!stale && stale.severity === 'critical', stale?.title);
    const listed = await owner.get(`/finance/disputes?status=open&customerId=${hotel.id}`);
    check('open disputes list their age and notes', listed[0]?.idleDays >= 30 && listed[0].notes.length === 1, `${listed[0]?.idleDays} ${listed[0]?.notes.length}`);
    const closed = await owner.post(`/finance/disputes/${dispute.id}/close`, { version: listed[0].version, outcome: 'resolved', resolution: 'Customer accepted the farm weight after seeing the slip' });
    const owedAfter = (await owner.get(`/finance/invoices/${invB.id}`)).outstanding;
    check('closing records the outcome and moves no money', closed.status === 'resolved' && owedAfter === invB.outstanding, `${closed.status} ${owedAfter} vs ${invB.outstanding}`);
    const unbalanced = await db.query(`SELECT e.id FROM money.ledger_entry e JOIN money.ledger_line l ON l.entry_id = e.id GROUP BY e.id HAVING SUM(l.debit) <> SUM(l.credit)`);
    check('every ledger entry balances', unbalanced.rowCount === 0);
  } finally {
    await db.end();
  }
  console.log(results.join('\n'));
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
})().catch((e) => {
  console.log(results.join('\n'));
  console.error('FAILED:', e.message);
  process.exit(1);
});
