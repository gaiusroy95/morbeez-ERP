// Driver app V1, Phase D8 — field hardening (docs/redesign/driver-app-v1-plan.md;
// Driver App Architecture DRV.5–DRV.9). What the phone's offline queue counts
// on from the server, checked through the real API: an action sent again with
// its key is the same action, once; the same key for something else is
// refused; the office's refusals come back as 4xx in words a driver can read
// — never a 5xx, which the phone would take for "try later" — and a refused
// action's key isn't spent: corrected, it's sent again under the same key.
// Conflicts from the office's side: a stop done twice, a trip the owner
// cancelled, another driver's trip, a closing KM below the opening.
// Runs after the Phase 8 suite in the redesign chain; makes its own trips.
const { API, PASSWORD } = require('../lib/env');
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
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  const ok = async (method, path, body, headers) => {
    const r = await call(method, path, body, headers);
    if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const upload = async (path, photoType) => {
    const form = new FormData();
    form.append('photoType', photoType);
    const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
    form.append('file', new Blob([jpeg], { type: 'image/jpeg' }), 'photo.jpg');
    const r = await fetch(`${API}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
    if (r.status >= 300) throw new Error(`upload ${path} -> ${r.status}`);
  };
  return { raw: call, get: (p) => ok('GET', p), post: (p, b = {}, h) => ok('POST', p, b, h), upload };
}
const words = (r) => r.body?.error?.message ?? '';
/** The phone's rule: only a 4xx with the office's words is a refusal it shows the driver. */
const refused = (r) => r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 402 && words(r).length > 0;
const key = () => ({ 'idempotency-key': randomUUID() });

(async () => {
  const owner = client(await login('owner@dev.morbeez.local'));
  const driver = client(await login('driver@dev.morbeez.local'));
  const customers = (await owner.get('/customers?pageSize=100')).items;
  const sagar = customers.find((c) => c.name === 'Hotel Sagar');
  const tomato = (await owner.get('/products?pageSize=100')).items.find((p) => p.name === 'Tomato');
  const van = (await owner.get('/vehicles?pageSize=100')).items.find((v) => v.registrationNumber === 'KA01D10001');
  const staff = (await owner.get('/workforce?pageSize=100')).items;
  const raju = staff.find((w) => w.name === 'Raju Driver');
  const other = staff.find((w) => w.name === 'Mohan Driver');
  if (!van || !raju || !other) throw new Error('run the driver-app suites first (the dev drivers and the van)');
  const rajuId = raju.employeeId ?? raju.id;
  const day = await driver.get('/logistics/trips/mine/day');
  const today = day.today;

  // ---- A trip: one shop, delivered ----
  const order = await owner.post('/orders', { customerId: sagar.id, deliveryDate: today, creditTermDays: 0, confirm: true, lines: [{ productId: tomato.id, quantity: 10, unitPrice: 30 }] });
  let trip = await owner.post('/logistics/trips', { vehicleId: van.id, driverEmployeeId: rajuId, plannedDate: today, orderIds: [order.id] });
  // The day's last reading, unless another trip read the odometer since — then the refusal says so, and the
  // phone's Start Day correction reads it again (D8); here, from the office's words.
  let opening = Math.ceil(Number(day.lastOdometerKm ?? 0)) + 10;
  const tryStart = await driver.raw('POST', `/logistics/trips/${trip.id}/start`, { version: trip.version, openingKm: opening });
  if (tryStart.status === 400 && /last reading, ([\d.]+) km/.test(words(tryStart))) {
    opening = Math.ceil(Number(words(tryStart).match(/last reading, ([\d.]+) km/)[1])) + 10;
    trip = await driver.post(`/logistics/trips/${trip.id}/start`, { version: trip.version, openingKm: opening });
  } else if (tryStart.status >= 300) throw new Error(`start -> ${tryStart.status} ${words(tryStart)}`);
  else trip = tryStart.body;
  const base = `/logistics/trips/${trip.id}`;
  const [shop] = await driver.get(`${base}/stops`);
  await driver.post(`${base}/start-deliveries`);
  await driver.upload(`${base}/stops/${shop.id}/photos`, 'pod');
  const delivery = { recipientName: 'Manager', allUnloaded: true, qrToken: shop.party.qrToken };
  await driver.post(`${base}/stops/${shop.id}/complete-delivery`, delivery);

  // ---- The office's side of a conflict (DRV.8) ----
  const twice = await driver.raw('POST', `${base}/stops/${shop.id}/complete-delivery`, delivery);
  check('a stop done twice is refused in words — a 4xx the phone shows, not a 5xx it would retry', refused(twice), `${twice.status} ${words(twice)}`);

  // ---- Collections: once per key; a refusal doesn't spend the key ----
  const collectKey = key();
  const tooMuch = await driver.raw('POST', `${base}/stops/${shop.id}/collections`, { amount: 150, method: 'barter' }, collectKey);
  const corrected = await driver.raw('POST', `${base}/stops/${shop.id}/collections`, { amount: 150, method: 'cash' }, collectKey);
  check(
    'a refused collection stores nothing under its key — corrected, the same key goes through',
    refused(tooMuch) && corrected.status < 300,
    `${tooMuch.status} ${words(tooMuch)} → ${corrected.status}`,
  );
  const replay = await driver.raw('POST', `${base}/stops/${shop.id}/collections`, { amount: 150, method: 'cash' }, collectKey);
  const changed = await driver.raw('POST', `${base}/stops/${shop.id}/collections`, { amount: 175, method: 'cash' }, collectKey);
  const collected = (await driver.get(`${base}/stops/${shop.id}/collections`)).filter((c) => Number(c.amount) === 150).length;
  check('sent again (no signal, it wasn’t sure), it’s the same collection — once', replay.status < 300 && replay.body.id === corrected.body.id && collected === 1, `${replay.status} ${collected}`);
  check('the same key for a different amount is refused', changed.status === 409 && refused(changed), `${changed.status} ${words(changed)}`);

  // ---- An expense with the phone's own id ----
  const expenseId = randomUUID();
  const toll = { id: expenseId, category: 'toll', amount: 80 };
  const first = await driver.post(`${base}/expenses`, toll, key());
  const again = await driver.raw('POST', `${base}/expenses`, toll, key());
  const differs = await driver.raw('POST', `${base}/expenses`, { ...toll, amount: 95 }, key());
  check('an expense sent again under its id is the same expense; the same id for another is refused', again.status < 300 && again.body.id === first.id && refused(differs), `${again.status} ${differs.status} ${words(differs)}`);

  // ---- Return: the reading is checked ----
  const below = await driver.raw('POST', `${base}/closing-km`, { closingKm: opening - 5 });
  const returned = await driver.raw('POST', `${base}/closing-km`, { closingKm: opening + 42 });
  check('a closing KM below the opening is refused in words; read again, it goes through', refused(below) && returned.status < 300, `${below.status} ${words(below)} → ${returned.status}`);

  // ---- A trip the owner cancelled, and another driver's ----
  const order2 = await owner.post('/orders', { customerId: sagar.id, deliveryDate: today, creditTermDays: 0, confirm: true, lines: [{ productId: tomato.id, quantity: 5, unitPrice: 30 }] });
  const planned = await owner.post('/logistics/trips', { vehicleId: van.id, driverEmployeeId: rajuId, plannedDate: today, orderIds: [order2.id] });
  await owner.post(`/logistics/trips/${planned.id}/cancel`, { version: planned.version });
  const startCancelled = await driver.raw('POST', `/logistics/trips/${planned.id}/start`, { version: planned.version, openingKm: opening + 50 });
  check(
    'starting a trip the owner cancelled meanwhile is refused — saying it was cancelled',
    refused(startCancelled) && words(startCancelled) === `The office cancelled trip ${planned.number}`,
    `${startCancelled.status} ${words(startCancelled)}`,
  );

  const order3 = await owner.post('/orders', { customerId: sagar.id, deliveryDate: today, creditTermDays: 0, confirm: true, lines: [{ productId: tomato.id, quantity: 5, unitPrice: 30 }] });
  const theirs = await owner.post('/logistics/trips', { vehicleId: van.id, driverEmployeeId: other.employeeId ?? other.id, plannedDate: today, orderIds: [order3.id] });
  const [theirStop] = await owner.get(`/logistics/trips/${theirs.id}/stops`);
  const notMine = await driver.raw('POST', `/logistics/trips/${theirs.id}/stops/${theirStop.id}/skip`, { reason: 'Shop closed' });
  check('a stop on another driver’s trip is refused — never done', refused(notMine) || notMine.status === 404, `${notMine.status} ${words(notMine)}`);

  const fivexx = [twice, tooMuch, changed, differs, below, startCancelled, notMine].filter((r) => r.status >= 500);
  check('no refusal is a server error', fivexx.length === 0, fivexx.map((r) => r.status).join(','));

  console.log(results.join('\n'));
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);
})().catch((e) => {
  console.log(results.join('\n'));
  console.error('FAILED:', e.message);
  process.exit(1);
});
