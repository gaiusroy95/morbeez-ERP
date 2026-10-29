// Driver app V1, Phase D1 — Start Day and the Dashboard's data
// (docs/redesign/driver-app-v1-plan.md): the driver's day (today's trip
// only — the owner plans first), the vehicle and its last odometer
// reading, this week's earnings, the stops' phone, place, address and map
// pin, and Start Day itself: opening KM never below the last reading, the
// phone's position, never a trip planned for a later day. Runs in the
// redesign chain, on the seeded business, with its own driver and vehicle.
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
  return { raw: call, get: (p) => ok('GET', p), post: (p, b = {}) => ok('POST', p, b), put: (p, b) => ok('PUT', p, b) };
}
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

(async () => {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  try {
    const owner = client(await login('owner@dev.morbeez.local'));
    const customers = (await owner.get('/customers?pageSize=100')).items;
    const farmers = (await owner.get('/farmers?pageSize=100')).items;
    const products = (await owner.get('/products?pageSize=100')).items;
    const sagar = customers.find((c) => c.name === 'Hotel Sagar');
    const ramesh = farmers.find((f) => f.name === 'Ramesh Patil');
    const tomato = products.find((p) => p.name === 'Tomato');

    // The dev driver login, linked to a driver of its own.
    const raju = await owner.post('/workforce', { name: 'Raju Driver', roleType: 'driver' });
    const driverUser = (await db.query(`SELECT id FROM identity.app_user WHERE email = 'driver@dev.morbeez.local'`)).rows[0].id;
    await db.query('UPDATE trading_partners.employee SET user_id = NULL WHERE user_id = $1', [driverUser]);
    await db.query('UPDATE trading_partners.employee SET user_id = $1, delegation_level = 4, standing_delegation = true WHERE id = $2', [driverUser, raju.id]);
    const driver = client(await login('driver@dev.morbeez.local'));
    const van = await owner.post('/vehicles', { registrationNumber: 'KA01D10001', capacityKg: 1500, fuelType: 'diesel' });
    const tz = (await db.query('SELECT timezone FROM tenant.tenant WHERE id = (SELECT tenant_id FROM trading_partners.customer WHERE id = $1)', [sagar.id])).rows[0].timezone;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    await owner.post('/fleet/fuel', { vehicleId: van.id, filledOn: today, litres: 40, amount: 3800, odometerKm: 48620, paidFrom: 'cash_on_hand' });

    // ---- Before the owner plans ----
    let day = await driver.get('/logistics/trips/mine/day');
    const monday = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
    check('no trip planned: the day says so, with who the driver is', day.trip === null && day.driver?.name === 'Raju Driver' && day.today === today, JSON.stringify({ ...day, vehicleStock: undefined }));
    check("this week's earnings run from Monday", day.weekFrom === monday && day.earnedThisWeek !== undefined, `${day.weekFrom} ${day.earnedThisWeek}`);

    // ---- A trip for tomorrow isn't today's ----
    const tomorrowOrder = await owner.post('/orders', { customerId: sagar.id, deliveryDate: addDays(today, 1), confirm: true, lines: [{ productId: tomato.id, quantity: 5, unitPrice: 30 }] });
    const later = await owner.post('/logistics/trips', { vehicleId: van.id, driverEmployeeId: raju.id, plannedDate: addDays(today, 1), orderIds: [tomorrowOrder.id] });
    day = await driver.get('/logistics/trips/mine/day');
    check("tomorrow's trip isn't today's", day.trip === null);
    const early = await driver.raw('POST', `/logistics/trips/${later.id}/start`, { version: later.version, openingKm: 48700 });
    check('…and the driver can’t start it early', early.status === 409 && /planned for/.test(early.body?.error?.message ?? ''), early.body?.error?.message);
    await owner.post(`/logistics/trips/${later.id}/cancel`, { version: later.version });

    // ---- Today's trip: a farm, then a cash customer ----
    await owner.put('/logistics/pins', { kind: 'farmer', refId: ramesh.id, latitude: 12.2958, longitude: 76.6394 });
    await owner.put('/logistics/pins', { kind: 'customer', refId: sagar.id, latitude: 12.3051, longitude: 76.6551 });
    let po = await owner.post('/procurement/purchase-orders', { farmerId: ramesh.id, lines: [{ productId: tomato.id, expectedQuantity: 120, indicativePrice: 20 }] });
    po = await owner.post(`/procurement/purchase-orders/${po.id}/confirm`, { version: po.version });
    const pickup = await owner.post(`/procurement/purchase-orders/${po.id}/pickups`, {});
    const order = await owner.post('/orders', {
      customerId: sagar.id,
      deliveryDate: today,
      creditTermDays: 0,
      deliveryAddress: 'Back gate, Sayyaji Rao Road',
      confirm: true,
      lines: [{ productId: tomato.id, quantity: 100, unitPrice: 30 }],
    });
    let trip = await owner.post('/logistics/trips', { vehicleId: van.id, driverEmployeeId: raju.id, plannedDate: today, pickupIds: [pickup.id], orderIds: [order.id] });
    day = await driver.get('/logistics/trips/mine/day');
    check("today's trip, its vehicle and the last odometer reading", day.trip?.id === trip.id && day.vehicle?.registrationNumber === 'KA01D10001' && day.lastOdometerKm === '48620.0', JSON.stringify({ trip: day.trip?.number, vehicle: day.vehicle, km: day.lastOdometerKm }));
    check('…and what the vehicle must deliver', day.vehicleStock?.rows.some((r) => r.product === 'Tomato' && r.toDeliver === '100.000'), JSON.stringify(day.vehicleStock?.rows));
    const stops = await driver.get(`/logistics/trips/${trip.id}/stops`);
    const farm = stops.find((s) => s.stopType === 'pickup');
    const shop = stops.find((s) => s.stopType === 'delivery');
    check(
      'each stop carries its party’s phone, place and map pin',
      farm?.party?.latitude === '12.295800' && farm.party.longitude === '76.639400' && shop?.party?.latitude === '12.305100',
      JSON.stringify(farm?.party),
    );
    check("a delivery goes to the order's own address", shop?.party?.address === 'Back gate, Sayyaji Rao Road', shop?.party?.address);
    check("an order with no credit days is cash at the door — the order's own term counts", shop?.collect?.terms === 'cash' && shop.collect.amount === '3000.00', JSON.stringify(shop?.collect));

    // ---- Start Day ----
    const low = await driver.raw('POST', `/logistics/trips/${trip.id}/start`, { version: trip.version, openingKm: 48600, latitude: 12.31, longitude: 76.64 });
    check("opening KM below the vehicle's last reading is refused", low.status === 400 && /48620/.test(low.body?.error?.message ?? ''), low.body?.error?.message);
    const half = await driver.raw('POST', `/logistics/trips/${trip.id}/start`, { version: trip.version, openingKm: 48650, latitude: 12.31 });
    check('half a position is refused', half.status === 400);
    trip = await driver.post(`/logistics/trips/${trip.id}/start`, { version: trip.version, openingKm: 48650, latitude: 12.3108, longitude: 76.6402, accuracyMeters: 8 });
    check('Start Day: on the road, with the opening KM and where the phone was', trip.status === 'in_progress' && trip.openingKm === '48650.0' && trip.startLatitude === '12.310800' && trip.startLongitude === '76.640200' && !!trip.startedAt, JSON.stringify({ s: trip.status, km: trip.openingKm, lat: trip.startLatitude }));
    const accuracy = (await db.query('SELECT start_accuracy_m::text AS a FROM fulfilment.trip WHERE id = $1', [trip.id])).rows[0].a;
    check('…and how sure the position was', accuracy === '8.0', accuracy);
    day = await driver.get('/logistics/trips/mine/day');
    check('the day now shows the trip on the road', day.trip?.status === 'in_progress' && day.trip.openingKm === '48650.0');
    const next = await owner.post('/logistics/trips', { vehicleId: van.id, driverEmployeeId: raju.id, plannedDate: addDays(today, 1) });
    const nextKm = (await db.query(`SELECT GREATEST((SELECT max(opening_km) FROM fulfilment.trip WHERE vehicle_id = $1)) ::text AS km`, [van.id])).rows[0].km;
    check("the next trip's last reading is this one's opening KM", nextKm === '48650.0', nextKm);
    await owner.post(`/logistics/trips/${next.id}/cancel`, { version: next.version });
    const again = await driver.raw('POST', `/logistics/trips/${trip.id}/start`, { version: trip.version, openingKm: 48650 });
    check('a trip can only be started once', again.status === 409, String(again.status));

    // ---- Another driver's day is theirs ----
    const someone = await owner.get('/logistics/trips/mine/day');
    check("the owner, not being a driver, has no day of their own", someone.driver === null && someone.trip === null);
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
