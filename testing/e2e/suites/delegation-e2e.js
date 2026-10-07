// Owner independence through the real API (client Q&A 1 Oct 2026, D–E):
// delegation levels and eligibility, per-trip approval, day-off mode with a
// backup driver, the owner-driver, immediate alerts and the evening
// summary, and the driver's PIN on their own phone. Makes its own data on
// the seeded dev business; the dev driver login is linked to a fresh
// backup driver.
const { API, DB_URL, PASSWORD } = require('../lib/env');
const { Client } = require('pg');
const { randomUUID } = require('crypto');

const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`);

async function login(login) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password: PASSWORD }) });
  return (await r.json()).accessToken;
}

function client(token) {
  const call = async (method, path, body, headers = {}) => {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', ...headers },
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
  return { raw: call, get: (p) => ok('GET', p), post: (p, b = {}, h) => ok('POST', p, b, h), patch: (p, b) => ok('PATCH', p, b) };
}

(async () => {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const owner = client(await login('owner@dev.morbeez.local'));
  const stamp = Date.now().toString(36);

  try {
    // ---- Stock and orders to work with ----
    const farmer = await owner.post('/farmers', { name: `Farmer ${stamp}` });
    const product = await owner.post('/products', { name: `Cabbage ${stamp}`, baseUom: 'kg', basePrice: 30 });
    const stock = async (qty) => {
      let po = await owner.post('/procurement/purchase-orders', { farmerId: farmer.id, lines: [{ productId: product.id, expectedQuantity: qty, indicativePrice: 20 }] });
      po = await owner.post(`/procurement/purchase-orders/${po.id}/confirm`, { version: po.version });
      await owner.post(`/procurement/purchase-orders/${po.id}/receive-goods`, { lines: [{ productId: product.id, receivedQuantity: qty }] });
      const [lot] = await owner.get(`/procurement/purchase-orders/${po.id}/lots`);
      await owner.post(`/procurement/lots/${lot.id}/grade`, { version: lot.version, acceptedQuantity: qty, rejectedQuantity: 0, unitCost: 20, grade: 'A' });
    };
    const customer = await owner.post('/customers', { name: `Cash Store ${stamp}`, creditLimit: 100000, paymentTermsDays: 0 });
    // A confirmed order reserves a whole lot, so each order gets its own.
    const order = async (qty) => {
      await stock(qty);
      const o = await owner.post('/orders', { customerId: customer.id, lines: [{ productId: product.id, quantity: qty, unitPrice: 30 }] });
      return owner.post(`/orders/${o.id}/confirm`, { version: o.version });
    };
    const vehicle = await owner.post('/vehicles', { registrationNumber: `KL08${stamp}`.slice(0, 12).toUpperCase(), capacityKg: 1000, fuelType: 'diesel' });

    // ---- A new driver: level 2, standing ----
    const backup = await owner.post('/workforce', { name: `Backup ${stamp}`, roleType: 'driver' });
    check('a new driver delivers and collects on every trip (level 2, standing)', backup.delegationLevel === 2 && backup.standingDelegation === true, `${backup.delegationLevel} ${backup.standingDelegation}`);
    const driverUser = (await db.query(`SELECT id FROM identity.app_user WHERE email = 'driver@dev.morbeez.local'`)).rows[0].id;
    await db.query('UPDATE trading_partners.employee SET user_id = NULL WHERE user_id = $1', [driverUser]);
    await db.query('UPDATE trading_partners.employee SET user_id = $1 WHERE id = $2', [driverUser, backup.id]);
    const driver = client(await login('driver@dev.morbeez.local'));

    const pool = await owner.get('/delegation/drivers');
    const mine = pool.find((d) => d.employeeId === backup.id);
    check('the driver pool shows eligibility, authority and track record', mine && mine.authority.level === 2 && mine.tripsClosed === 0 && mine.hasLogin, JSON.stringify(mine?.authority));
    const notOwner = await driver.raw('GET', '/delegation/drivers');
    check("a driver can't see the pool", notOwner.status === 403, String(notOwner.status));

    // ---- Level 2 on the road: delivers and collects; can't buy; spending waits for approval ----
    let trip = await owner.post('/logistics/trips', { vehicleId: vehicle.id, driverEmployeeId: backup.id, advanceAmount: 500 });
    const o1 = await order(20);
    const s1 = await owner.post(`/logistics/trips/${trip.id}/stops/delivery`, { orderId: o1.id });
    const o2 = await order(10);
    const s2 = await owner.post(`/logistics/trips/${trip.id}/stops/delivery`, { orderId: o2.id });
    trip = await driver.post(`/logistics/trips/${trip.id}/start`, { version: trip.version });
    const auth = await driver.get(`/logistics/trips/${trip.id}/authority`);
    check('the driver sees their authority on the trip', auth.level === 2 && auth.source === 'standing' && auth.can.collect && !auth.can.procure && !auth.can.expense, JSON.stringify(auth.can));
    await driver.post(`/logistics/trips/${trip.id}/stops/${s1.id}/complete-delivery`, { recipientName: 'Owner', signatureData: 'data:image/png;base64,iVBORw0KGgo=' });
    const paid = await driver.raw('POST', `/logistics/trips/${trip.id}/stops/${s1.id}/collections`, { amount: 600, method: 'cash' });
    check('level 2 takes payments', paid.status === 201, String(paid.status));
    const fuel = await driver.post(`/logistics/trips/${trip.id}/expenses`, { category: 'fuel', amount: 150 });
    check("spending below level 4 is recorded, flagged for the owner's approval", fuel.needsApproval === true);
    const skipped = await driver.post(`/logistics/trips/${trip.id}/stops/${s2.id}/skip`, { reason: 'Shop shut, owner away' });
    check('a stop not done keeps its reason', skipped.status === 'skipped' && skipped.notes === 'Shop shut, owner away', skipped.notes);

    // ---- Alerts at once ----
    const reportKey = randomUUID();
    const problem = await driver.post(`/logistics/trips/${trip.id}/problem`, { kind: 'trip_blocked', note: 'Road closed at Aluva bridge' }, { 'idempotency-key': reportKey });
    await driver.post(`/logistics/trips/${trip.id}/problem`, { kind: 'trip_blocked', note: 'Road closed at Aluva bridge' }, { 'idempotency-key': reportKey });
    check('the driver can report a problem', problem.reported === true);
    // Expected: 500 + 600 − 150 = 950; declaring 300 is ₹650 short — over the ₹500 threshold.
    trip = await driver.post(`/logistics/trips/${trip.id}/complete`, { version: trip.version, cashDeclared: 300, note: 'Rest tomorrow' });
    const alerts = await owner.get('/alerts?unread=true');
    const ofTrip = alerts.filter((a) => a.tripId === trip.id);
    const kinds = ofTrip.map((a) => a.kind).sort();
    check('exceptions alert the owner at once: rejection, blocked trip, cash short', JSON.stringify(kinds) === JSON.stringify(['cash_mismatch', 'customer_rejection', 'trip_blocked']), kinds.join(','));
    const rejection = ofTrip.find((a) => a.kind === 'customer_rejection');
    check('the rejection names the customer and why', rejection && rejection.title === `Not delivered: ${customer.name}` && /Shop shut, owner away/.test(rejection.detail), rejection?.title);
    check('a retried problem report is one alert', ofTrip.filter((a) => a.kind === 'trip_blocked').length === 1);
    const cash = ofTrip.find((a) => a.kind === 'cash_mismatch');
    check('the cash alert says how far off', cash && /short by ₹650\.00/.test(cash.title), cash?.title);
    const count = await owner.get('/alerts/unread-count');
    check('unread count, critical ones apart', count.unread >= 3 && count.critical >= 3, JSON.stringify(count));
    const driverAlerts = await driver.raw('GET', '/alerts');
    check("a driver can't read the owner's alerts", driverAlerts.status === 403, String(driverAlerts.status));
    const review = await owner.get(`/logistics/trips/${trip.id}/review`);
    const expenses = review.checklist.find((c) => c.area === 'expenses');
    check('the unapproved spend is an exception at closure', expenses.status === 'exception' && /₹150\.00 beyond the driver's authority/.test(expenses.detail), expenses.detail);
    await owner.post('/alerts/read-all');
    check('read-all clears them', (await owner.get('/alerts/unread-count')).unread === 0);

    // ---- Per-trip approval ----
    await owner.patch(`/delegation/drivers/${backup.id}`, { delegationLevel: 3, standingDelegation: false });
    let trip2 = await owner.post('/logistics/trips', { vehicleId: vehicle.id, driverEmployeeId: backup.id, advanceAmount: 0 });
    const o3 = await order(5);
    await owner.post(`/logistics/trips/${trip2.id}/stops/delivery`, { orderId: o3.id });
    const unapproved = await driver.raw('POST', `/logistics/trips/${trip2.id}/start`, { version: trip2.version });
    check('without standing permission, a trip waits for the owner to approve it', unapproved.status === 403 && /approve/.test(unapproved.body?.error?.message ?? ''), unapproved.body?.error?.message);
    const tooHigh = await owner.raw('POST', '/delegation/grants', { driverEmployeeId: backup.id, level: 4, kind: 'trip', tripId: trip2.id });
    check('a grant above eligibility is refused', tooHigh.status === 409, `${tooHigh.status} ${tooHigh.body?.error?.message}`);
    const grant = await owner.post('/delegation/grants', { driverEmployeeId: backup.id, level: 3, kind: 'trip', tripId: trip2.id, note: 'Market run' });
    trip2 = await driver.post(`/logistics/trips/${trip2.id}/start`, { version: trip2.version });
    const a2 = await driver.get(`/logistics/trips/${trip2.id}/authority`);
    check('approved for the trip at level 3', trip2.status === 'in_progress' && a2.level === 3 && a2.source === 'trip' && a2.can.procure, JSON.stringify(a2));
    await owner.post(`/delegation/grants/${grant.id}/revoke`);
    const revoked = await driver.get(`/logistics/trips/${trip2.id}/authority`);
    check('revoking takes the authority away at once', revoked.level === 0, String(revoked.level));
    await owner.post('/delegation/grants', { driverEmployeeId: backup.id, level: 3, kind: 'trip', tripId: trip2.id });
    const [stop3] = await driver.get(`/logistics/trips/${trip2.id}/stops`);
    await driver.post(`/logistics/trips/${trip2.id}/stops/${stop3.id}/complete-delivery`, { recipientName: 'Owner', signatureData: 'data:image/png;base64,iVBORw0KGgo=' });
    await driver.post(`/logistics/trips/${trip2.id}/stops/${stop3.id}/collections`, { amount: 150, method: 'upi' });
    trip2 = await driver.post(`/logistics/trips/${trip2.id}/complete`, { version: trip2.version, cashDeclared: 0 });
    const ended = await driver.get(`/logistics/trips/${trip2.id}/authority`);
    check('a trip delegation ends with the handover', ended.level === 0, String(ended.level));

    // ---- Day-off mode ----
    let trip3 = await owner.post('/logistics/trips', { vehicleId: vehicle.id, driverEmployeeId: (await owner.post('/workforce', { name: `Regular ${stamp}`, roleType: 'driver' })).id, advanceAmount: 0 });
    const o4 = await order(5);
    await owner.post(`/logistics/trips/${trip3.id}/stops/delivery`, { orderId: o4.id });
    const day = await owner.post('/delegation/day-off', { driverEmployeeId: backup.id, level: 3, tripIds: [trip3.id], note: 'Family function' });
    trip3 = await owner.get(`/logistics/trips/${trip3.id}`);
    check("day-off: the day's trip is handed to the backup driver", trip3.driverEmployeeId === backup.id);
    check('day-off: the owner is away until the operating day ends', day.away === true && new Date(day.until) > new Date(), day.until);
    const a3 = await driver.get(`/logistics/trips/${trip3.id}/authority`);
    check('day-off: the backup driver runs it at the day-off level', a3.level === 3 && a3.source === 'day_off', JSON.stringify(a3));
    const myTrips = await driver.get('/logistics/trips/mine');
    check('the handed-over trip is on the backup driver\'s phone', myTrips.items.some((t) => t.id === trip3.id));
    const back = await owner.post('/delegation/day-off/end');
    const a4 = await driver.get(`/logistics/trips/${trip3.id}/authority`);
    check('the owner back: day-off authority ends', back.away === false && a4.level === 0, String(a4.level));

    // ---- Evening summary ----
    const summary = await owner.get('/alerts/summary');
    check('evening summary: deliveries, collections, expenses and the day\'s exceptions', summary.deliveries.done >= 2 && Number(summary.collections.total) >= 750 && Number(summary.expenses) >= 150 && summary.exceptions.length >= 3,
      `${summary.deliveries.done} ${summary.collections.total} ${summary.expenses} ${summary.exceptions.length}`);
    check('evening summary: per-driver activity', summary.drivers.some((d) => d.name === `Backup ${stamp}` && d.stopsDone >= 2));

    // ---- The owner-driver ----
    const me = await owner.post('/workforce/me/driver', { name: 'Owner (driving)' });
    const again = await owner.post('/workforce/me/driver', { name: 'Owner (driving)' });
    check('the owner drives too: one driver record for their own login', me.id === again.id && me.delegationLevel === 4 && me.standingDelegation);
    const ownTrip = await owner.post('/logistics/trips', { vehicleId: vehicle.id, driverEmployeeId: me.id, advanceAmount: 0 });
    const ownList = await owner.get('/logistics/trips/mine');
    check("the owner's own route shows in Driver mode", ownList.items.some((t) => t.id === ownTrip.id));

    // ---- Driver PIN ----
    const device = `dev-${stamp}-phone`;
    const anon = client(null);
    const weak = await driver.raw('POST', '/auth/pin', { deviceId: device, pin: '1234' });
    check('an easy PIN is refused', weak.status === 400, String(weak.status));
    await driver.post('/auth/pin', { deviceId: device, pin: '4826' });
    const pinIn = await anon.raw('POST', '/auth/pin-login', { login: '9800000004', deviceId: device, pin: '4826' });
    check('the PIN signs the driver in on their own phone', pinIn.status === 200 && !!pinIn.body.accessToken, String(pinIn.status));
    const otherPhone = await anon.raw('POST', '/auth/pin-login', { login: '9800000004', deviceId: `other-${stamp}-phone`, pin: '4826' });
    check('…and nowhere else', otherPhone.status === 401, String(otherPhone.status));
    let last;
    for (let i = 0; i < 5; i++) last = await anon.raw('POST', '/auth/pin-login', { login: '9800000004', deviceId: device, pin: '9071' });
    check('five wrong PINs switch it off', last.status === 401 && /switched off/.test(last.body?.error?.message ?? ''), last.body?.error?.message);
    const afterLock = await anon.raw('POST', '/auth/pin-login', { login: '9800000004', deviceId: device, pin: '4826' });
    check('…even the right PIN no longer works there', afterLock.status === 401, String(afterLock.status));
    const security = (await owner.get('/alerts?unread=true')).find((a) => a.kind === 'security');
    check('the owner is told the PIN was being guessed', !!security && /PIN locked/.test(security.title), security?.title);
    check('the password still works', !!(await login('9800000004')));
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
