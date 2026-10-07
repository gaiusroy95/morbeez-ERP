// Driver money handover and owner trip closure, through the real API: cash
// collected at a delivery stays with the driver; an expense and a bank
// deposit on the road come off what's handed over; the driver submits with
// a declared amount; the owner reviews every area, returns the trip, the
// driver resubmits, and the owner closes it. The ledger's driver float ends
// where it started. Runs on the seeded dev business, with the owner as the
// driver (the owner-driver case).
const { API, DB_URL, PASSWORD } = require('../lib/env');
const { Client } = require('pg');

const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`);
const money = (n) => Number(n).toFixed(2);

async function login(login) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password: PASSWORD }) });
  return (await r.json()).accessToken;
}

function client(token) {
  const call = async (method, path, body, headers = {}) => {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  const ok = async (method, path, body, headers) => {
    const res = await call(method, path, body, headers);
    if (res.status >= 300) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  };
  return { raw: call, get: (p) => ok('GET', p), post: (p, b = {}, h) => ok('POST', p, b, h) };
}

(async () => {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const balance = async (account) =>
    (await db.query(`SELECT COALESCE(SUM(debit - credit), 0)::numeric(14,2)::text AS b FROM money.ledger_line WHERE account_code = $1`, [account])).rows[0].b;
  const owner = client(await login('owner@dev.morbeez.local'));
  const driverApp = client(await login('driver@dev.morbeez.local'));
  const stamp = Date.now().toString(36);

  try {
    // ---- Stock, a cash customer, an order ----
    const farmer = await owner.post('/farmers', { name: `Farmer ${stamp}` });
    const product = await owner.post('/products', { name: `Beans ${stamp}`, baseUom: 'kg', basePrice: 40 });
    let po = await owner.post('/procurement/purchase-orders', { farmerId: farmer.id, lines: [{ productId: product.id, expectedQuantity: 100, indicativePrice: 25 }] });
    po = await owner.post(`/procurement/purchase-orders/${po.id}/confirm`, { version: po.version });
    await owner.post(`/procurement/purchase-orders/${po.id}/receive-goods`, { lines: [{ productId: product.id, receivedQuantity: 100 }] });
    const [lot] = await owner.get(`/procurement/purchase-orders/${po.id}/lots`);
    await owner.post(`/procurement/lots/${lot.id}/grade`, { version: lot.version, acceptedQuantity: 100, rejectedQuantity: 0, unitCost: 25, grade: 'A' });
    const customer = await owner.post('/customers', { name: `Cash Kirana ${stamp}`, creditLimit: 100000, paymentTermsDays: 0 });
    let order = await owner.post('/orders', { customerId: customer.id, lines: [{ productId: product.id, quantity: 50, unitPrice: 40 }] });
    order = await owner.post(`/orders/${order.id}/confirm`, { version: order.version });

    const vehicle = await owner.post('/vehicles', { registrationNumber: `KL07${stamp}`.slice(0, 12).toUpperCase(), capacityKg: 1000, fuelType: 'diesel' });
    // The trip's driver is the dev driver login's own employee record, so
    // the driver-side rules apply to them.
    const driverUser = (await db.query(`SELECT id FROM identity.app_user WHERE email = 'driver@dev.morbeez.local'`)).rows[0].id;
    let driverEmployeeId = (await db.query('SELECT id FROM trading_partners.employee WHERE user_id = $1', [driverUser])).rows[0]?.id;
    if (!driverEmployeeId) {
      driverEmployeeId = (await owner.post('/workforce', { name: `Driver ${stamp}`, roleType: 'driver' })).id;
      await db.query('UPDATE trading_partners.employee SET user_id = $1 WHERE id = $2', [driverUser, driverEmployeeId]);
    }
    const floatBefore = await balance('cash_with_drivers');
    const bankBefore = await balance('bank');

    // ---- On the road ----
    let trip = await owner.post('/logistics/trips', { vehicleId: vehicle.id, driverEmployeeId, advanceAmount: 1000 });
    const stop = await owner.post(`/logistics/trips/${trip.id}/stops/delivery`, { orderId: order.id });
    trip = await owner.post(`/logistics/trips/${trip.id}/start`, { version: trip.version });
    await owner.post(`/logistics/trips/${trip.id}/stops/${stop.id}/complete-delivery`, { recipientName: 'Shopkeeper', signatureData: 'data:image/png;base64,iVBORw0KGgo=' });
    const [invoice] = (await owner.get(`/finance/invoices?customerId=${customer.id}`)).items;
    await owner.post(`/logistics/trips/${trip.id}/stops/${stop.id}/collections`, { amount: Number(invoice.amount), method: 'cash' });
    check('cash collected at the delivery stays with the driver (trip float), not the cash drawer',
      Number(await balance('cash_with_drivers')) - Number(floatBefore) === 1000 + Number(invoice.amount), await balance('cash_with_drivers'));
    await owner.post(`/logistics/trips/${trip.id}/expenses`, { category: 'fuel', amount: 200 });
    const deposit = await owner.post(`/logistics/trips/${trip.id}/deposits`, { amount: 1500, bankAccount: 'SBI ••4321', reference: 'DEP-1' }, { 'idempotency-key': '0b5f6c1e-7d55-4a43-9a3c-5f1f3d2b7a01' });
    const again = await owner.post(`/logistics/trips/${trip.id}/deposits`, { amount: 1500, bankAccount: 'SBI ••4321', reference: 'DEP-1' }, { 'idempotency-key': '0b5f6c1e-7d55-4a43-9a3c-5f1f3d2b7a01' });
    check('a retried bank deposit is recorded once', again.id === deposit.id);
    check('the deposit moves cash from the driver to the bank', money(Number(await balance('bank')) - Number(bankBefore)) === '1500.00');

    // ---- Handover ----
    const expected = money(1000 + Number(invoice.amount) - 200 - 1500);
    const handover = await owner.get(`/logistics/trips/${trip.id}/handover`);
    check('expected handover = opening cash + cash collected − expenses − bank deposit', handover.expected === expected,
      `${handover.openingCash} + ${handover.cashCollections} − ${handover.expenses} − ${handover.deposited} = ${handover.expected}`);
    const mine = await driverApp.raw('GET', `/logistics/trips/${trip.id}/handover`);
    check('the driver sees their own handover', mine.status === 200 && mine.body.expected === expected, String(mine.status));
    const review0 = await driverApp.raw('GET', `/logistics/trips/${trip.id}/review`);
    check("the driver can't open the owner's review", review0.status === 403, String(review0.status));

    // ---- Submit short, the owner returns it ----
    trip = await owner.post(`/logistics/trips/${trip.id}/complete`, { version: trip.version, cashDeclared: Number(expected) - 100, note: '₹100 went on a puncture' });
    check('submitted: completed, awaiting the owner, with the declared cash', trip.status === 'completed' && trip.cashDeclared === money(Number(expected) - 100), trip.status);
    const lateDeposit = await driverApp.raw('POST', `/logistics/trips/${trip.id}/deposits`, { amount: 10, bankAccount: 'SBI', reference: 'LATE-1' });
    check('once submitted, the driver can record no more deposits', lateDeposit.status === 409, `${lateDeposit.status} ${lateDeposit.body?.error?.message}`);
    const driverClose = await driverApp.raw('POST', `/logistics/trips/${trip.id}/reconcile`, { version: trip.version, cashReturned: 0 });
    check('the driver cannot close the trip', driverClose.status === 403, String(driverClose.status));
    let review = await owner.get(`/logistics/trips/${trip.id}/review`);
    const area = (r, name) => r.checklist.find((c) => c.area === name);
    check('review: the short declaration is a handover exception', area(review, 'handover').status === 'exception' && /short by ₹100\.00/.test(area(review, 'handover').detail), area(review, 'handover').detail);
    check('review: deliveries, collections, procurement and returns pass', ['deliveries', 'collections', 'procurement', 'returns'].every((a) => area(review, a).status === 'pass'));
    check('review: the load shows what was delivered', review.load.some((l) => l.product === product.name && Number(l.delivered) === 50), JSON.stringify(review.load));
    const noReason = await owner.raw('POST', `/logistics/trips/${trip.id}/reconcile`, { version: trip.version, cashReturned: Number(expected) - 100 });
    check('closing with an exception and no reason is refused', noReason.status === 409 && /needs a reason/.test(noReason.body?.error?.message), noReason.body?.error?.message);
    const held = await owner.post(`/logistics/trips/${trip.id}/hold`, { version: trip.version, note: 'Asking about the puncture' });
    check('the owner can put it on hold', held.status === 'on_hold' && held.reviewNote === 'Asking about the puncture');
    trip = await owner.post(`/logistics/trips/${trip.id}/return`, { version: held.version, note: 'Record the puncture as an expense' });
    check('…and return it to the driver, with what to correct', trip.status === 'in_progress' && trip.reviewNote === 'Record the puncture as an expense' && trip.cashDeclared === null);

    // ---- Corrected and resubmitted; the owner closes it clean ----
    await owner.post(`/logistics/trips/${trip.id}/expenses`, { category: 'other', amount: 100, notes: 'Puncture' });
    const corrected = money(Number(expected) - 100);
    trip = await owner.post(`/logistics/trips/${trip.id}/complete`, { version: trip.version, cashDeclared: Number(corrected) });
    review = await owner.get(`/logistics/trips/${trip.id}/review`);
    check('resubmitted: every area passes', review.exceptions === 0, review.checklist.filter((c) => c.status === 'exception').map((c) => c.detail).join(' | '));
    const closed = await owner.post(`/logistics/trips/${trip.id}/reconcile`, { version: trip.version, cashReturned: Number(corrected) });
    check('closed as a pass, balanced, with what was checked', closed.outcome === 'pass' && Number(closed.variance) === 0 && closed.checklist.length === 7, `${closed.outcome} ${closed.variance}`);
    check('the closure records the money in each case', closed.cashCollections === money(invoice.amount) && closed.cashDeposited === '1500.00' && closed.directPayments === '0.00');
    const after = await owner.get(`/logistics/trips/${trip.id}`);
    check('only the owner closes: the trip is closed', after.status === 'reconciled');
    check("the driver float is back where it started", (await balance('cash_with_drivers')) === floatBefore, `${floatBefore} → ${await balance('cash_with_drivers')}`);
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
