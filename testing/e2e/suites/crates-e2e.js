// Crate management through the real HTTP API, after the other suites
// (Hotel Sagar, the two farmers and MH12AB4521's completed trips exist).
const { API, PASSWORD } = require('../lib/env');
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
const cents = (v) => Math.round(Number(v) * 100);
const money = (c) => (c / 100).toFixed(2);

(async () => {
  const owner = as(await login('owner@dev.morbeez.local'));
  const ops = as(await login('ops-manager@dev.morbeez.local'));
  const acc = as(await login('accountant@dev.morbeez.local'));
  const today = must(await owner.get('/accounting/periods'), 'periods').today;
  const d = (n) => {
    const x = new Date(`${today}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
  const bal = async () => Object.fromEntries(must(await owner.get('/accounting/accounts'), 'accounts').map((a) => [a.code, a.balance]));
  const before = await bal();

  // ---- Set-up ----
  const opsType = await ops.post('/crates/types', { code: 'PL20', name: 'Plastic 20 kg', replacementCost: 180 });
  check('the ops manager does not configure crate types', opsType.status === 403);
  must(await owner.post('/crates/types', { code: 'pl20', name: 'Plastic crate, 20 kg', capacityKg: 20, replacementCost: 180, hsnCode: '3923', reorderLevel: 150 }), 'PL20');
  const types = must(await owner.post('/crates/types', { code: 'WD', name: 'Wooden crate', replacementCost: 120 }), 'WD');
  const dup = await owner.post('/crates/types', { code: 'PL20', name: 'Again', replacementCost: 1 });
  check('crate types: codes are upper-cased and unique', types.map((t) => t.code).join() === 'PL20,WD' && dup.status === 409);
  const PL = types.find((t) => t.code === 'PL20').id;
  const WD = types.find((t) => t.code === 'WD').id;
  must(await owner.post('/tax/gst-rates', { hsnCode: '3923', description: 'Plastic crates and boxes', supplyKind: 'goods', taxability: 'taxable', rate: 18, effectiveFrom: '2017-07-01' }), 'gst 3923');

  const parties = must(await ops.get('/crates/parties'), 'parties');
  const hotel = parties.customers.find((c) => c.name === 'Hotel Sagar');
  const truck = parties.vehicles.find((v) => v.name === 'MH12AB4521');
  check('the crate pick-list works without customers:read', !!hotel && parties.farmers.length >= 2 && !!truck);

  // ---- Buying and issuing ----
  must(await ops.post('/crates/movements', { kind: 'purchased', lines: [{ crateTypeId: PL, quantity: 200 }, { crateTypeId: WD, quantity: 40 }], cost: 32000, paidFrom: 'bank', reference: 'Bill 88' }), 'buy');
  const issued = must(await ops.post('/crates/movements', { kind: 'issued', partyKind: 'customer', partyId: hotel.id, lines: [{ crateTypeId: PL, quantity: 30 }], occurredOn: d(-10) }), 'issue');
  const tooMany = await ops.post('/crates/movements', { kind: 'returned', partyKind: 'customer', partyId: hotel.id, lines: [{ crateTypeId: PL, quantity: 40 }] });
  check("a return can't be more than the customer holds", tooMany.status === 409 && /holds only 30 PL20/.test(msg(tooMany)), msg(tooMany));
  const returned = must(await ops.post('/crates/movements', { kind: 'returned', partyKind: 'customer', partyId: hotel.id, lines: [{ crateTypeId: PL, quantity: 10 }], reference: 'Morning pickup' }), 'return');
  let h = must(await ops.get(`/crates/holders/customer/${hotel.id}`), 'hotel');
  check('customer balance, aged from the oldest crate still out', h.total === 20 && h.oldestSince === d(-10) && h.daysHeld === 10 && h.value === '3600.00', `${h.total} since ${h.oldestSince}`);
  const future = await ops.post('/crates/movements', { kind: 'issued', partyKind: 'customer', partyId: hotel.id, lines: [{ crateTypeId: PL, quantity: 1 }], occurredOn: d(3) });
  check("crates can't move on a future date", future.status === 400);

  // ---- A trip: load, stops, unload ----
  const trips = must(await owner.get('/logistics/trips?page=1&pageSize=50'), 'trips').items;
  // A stop at someone who holds no crates yet (not Hotel Sagar).
  let trip = null;
  let stop = null;
  for (const t of trips.filter((x) => x.vehicleId === truck.id && ['completed', 'reconciled'].includes(x.status))) {
    const c = must(await ops.get(`/crates/trips/${t.id}`), 'trip crates');
    const s = c.stops.find((x) => x.party.id !== hotel.id);
    if (s) { trip = c; stop = s; break; }
  }
  check('a completed trip with a stop to count crates at', !!stop, stop ? `${stop.party.name}` : '');
  must(await ops.post('/crates/movements', { kind: 'loaded', tripId: trip.tripId, lines: [{ crateTypeId: PL, quantity: 50 }] }), 'load');
  const noneHeld = await ops.post(`/crates/trips/${trip.tripId}/stops/${stop.stopId}`, { lines: [{ crateTypeId: PL, dropped: 0, collected: 5 }] });
  check("can't collect crates the party doesn't hold — it says to record an opening balance", noneHeld.status === 409 && /opening balance/.test(msg(noneHeld)), msg(noneHeld));
  must(await ops.post(`/crates/trips/${trip.tripId}/stops/${stop.stopId}`, { lines: [{ crateTypeId: PL, dropped: 12, collected: 0 }] }), 'drop');
  trip = must(await ops.post(`/crates/trips/${trip.tripId}/stops/${stop.stopId}`, { lines: [{ crateTypeId: PL, dropped: 0, collected: 5 }] }), 'collect');
  const s0 = trip.stops.find((x) => x.stopId === stop.stopId);
  check('trip: loaded 50, left 12 at the stop, collected 5, 43 still on board', trip.loaded === 50 && s0.dropped === 12 && s0.collected === 5 && trip.onVehicle[0]?.balance === 43, JSON.stringify({ loaded: trip.loaded, s0, on: trip.onVehicle }));
  let alerts = must(await ops.get('/crates/alerts'), 'alerts');
  check('alerts: overdue customer, crates on a vehicle not on the road, yard below reorder level',
    alerts.some((a) => a.kind === 'overdue' && a.holderId === hotel.id && a.severity === 'attention') &&
    alerts.some((a) => a.kind === 'vehicle_idle' && a.holderId === truck.id && a.crates === 43) &&
    alerts.some((a) => a.kind === 'yard_low' && /PL20: 130 in the yard/.test(a.message)),
    alerts.map((a) => `${a.kind}:${a.holderName}:${a.crates}`).join(', '));
  must(await ops.post('/crates/movements', { kind: 'unloaded', vehicleId: truck.id, tripId: trip.tripId, lines: [{ crateTypeId: PL, quantity: 43 }] }), 'unload');
  alerts = must(await ops.get('/crates/alerts'), 'alerts');
  check('unloaded: the vehicle alert clears', !alerts.some((a) => a.kind === 'vehicle_idle'));

  // ---- Limits ----
  const opsLimit = await ops.put('/crates/limits', { holderKind: 'customer', holderId: hotel.id, maxCrates: 15 });
  must(await owner.put('/crates/limits', { holderKind: 'customer', holderId: hotel.id, maxCrates: 15 }), 'limit');
  alerts = must(await ops.get('/crates/alerts'), 'alerts');
  check('over its limit: a red alert, listed first', opsLimit.status === 403 && alerts[0].kind === 'over_limit' && alerts[0].severity === 'bad' && /over the limit of 15/.test(alerts[0].message), alerts[0]?.message);

  // ---- Losses ----
  const broken = must(await ops.post('/crates/losses', { holderKind: 'yard', crateTypeId: PL, quantity: 5, recovery: 'absorbed', reason: 'Cracked while unloading' }), 'yard loss');
  check('a loss written off: no charge', broken.recovery === 'absorbed' && broken.amount === '0.00');
  const opsCharge = await ops.post('/crates/losses/charge', { holderKind: 'customer', holderId: hotel.id, crateTypeId: PL, quantity: 4, recovery: 'charge', reason: 'Not returned' });
  const wrongRoute = await acc.post('/crates/losses', { holderKind: 'customer', holderId: hotel.id, crateTypeId: PL, quantity: 4, recovery: 'charge', reason: 'Not returned' });
  check('charging is crates:charge, through its own route', opsCharge.status === 403 && wrongRoute.status === 403);
  const charged = must(await acc.post('/crates/losses/charge', { holderKind: 'customer', holderId: hotel.id, crateTypeId: PL, quantity: 4, recovery: 'charge', reason: 'Not returned after a month' }), 'charge customer');
  check('customer charged: CRT invoice at replacement cost plus 18% GST on HSN 3923', charged.recovery === 'invoiced' && /^CRT-\d{6}$/.test(charged.invoiceNumber) && charged.amount === '849.60' && charged.taxAmount === '129.60', `${charged.invoiceNumber} ${charged.amount} (${charged.taxAmount})`);
  const invoice = must(await acc.get(`/finance/invoices/${charged.invoiceId}`), 'invoice');
  check('the invoice is open on the customer\'s account', invoice.kind === 'crate_charge' && invoice.amount === '849.60' && /4 lost Plastic crate, 20 kg crates/.test(invoice.lines[0].description), `${invoice.kind} ${invoice.state}`);
  const r1 = must(await owner.get(`/tax/gstr1?from=${today.slice(0, 8)}01&to=${today}`), 'gstr1');
  const hsnRows = [...(r1.hsn?.b2b ?? []), ...(r1.hsn?.b2c ?? [])];
  check('GSTR-1 reports it under HSN 3923, counted in units', hsnRows.some((x) => x.hsnCode === '3923' && x.uqc === 'NOS'), JSON.stringify(hsnRows.find((x) => x.hsnCode === '3923')));

  // A farmer: crates issued, two lost, charged against what they're owed.
  const payables = must(await acc.get('/finance/payables'), 'payables');
  const rows = Array.isArray(payables) ? payables : payables.farmers ?? payables.rows ?? payables.items;
  const owedFarmer = rows.filter((r) => cents(r.owed) >= 36000).sort((a, b) => cents(b.owed) - cents(a.owed))[0];
  const farmerId = owedFarmer?.farmerId ?? parties.farmers[0].id;
  must(await ops.post('/crates/movements', { kind: 'issued', partyKind: 'farmer', partyId: farmerId, lines: [{ crateTypeId: PL, quantity: 6 }] }), 'issue farmer');
  const farmerCharge = await acc.post('/crates/losses/charge', { holderKind: 'farmer', holderId: farmerId, crateTypeId: PL, quantity: 2, recovery: 'charge', reason: 'Two crates missing at pickup' });
  let deducted = 0;
  if (owedFarmer) {
    const after = must(await acc.get('/finance/payables'), 'payables');
    const row = (Array.isArray(after) ? after : after.farmers ?? after.rows ?? after.items).find((r) => r.farmerId === farmerId);
    deducted = 36000;
    check('farmer charged: 2 × 180 taken off what they are owed', farmerCharge.status === 201 && farmerCharge.body.recovery === 'deducted' && cents(owedFarmer.owed) - cents(row?.owed ?? '0') === 36000, `${owedFarmer.owed} → ${row?.owed}`);
  } else {
    check('farmer owed nothing: the deduction is refused', farmerCharge.status === 409 && /owed to this farmer/.test(msg(farmerCharge)), msg(farmerCharge));
  }

  // ---- Corrections ----
  const rev = must(await ops.post(`/crates/movements/${returned[0].id}/reverse`, { reason: 'Counted twice' }), 'reverse');
  const again = await ops.post(`/crates/movements/${returned[0].id}/reverse`, { reason: 'again' });
  h = must(await ops.get(`/crates/holders/customer/${hotel.id}`), 'hotel');
  check('a mistaken return is reversed, once; both stay in the history', rev.kind === 'correction' && again.status === 409 && h.total === 26 && h.movements.some((m) => m.id === returned[0].id && m.reversedBy === rev.id), `holds ${h.total}`);
  const chargedMove = h.movements.find((m) => m.kind === 'lost');
  const revCharged = await ops.post(`/crates/movements/${chargedMove.id}/reverse`, { reason: 'Found them' });
  const buy = must(await ops.get(`/crates/movements?from=${today}&to=${today}`), 'moves').find((m) => m.kind === 'purchased');
  const revBuy = await ops.post(`/crates/movements/${buy.id}/reverse`, { reason: 'Wrong count' });
  check('a charged loss and a costed purchase are corrected in Finance, not here — and say so up front', revCharged.status === 409 && revBuy.status === 409 && chargedMove.reversible === false && buy.reversible === false && h.movements.some((m) => m.kind === 'issued' && m.reversible), `${msg(revCharged)} / ${msg(revBuy)}`);

  // ---- Retiring a type ----
  const wd = types.find((t) => t.code === 'WD');
  must(await owner.patch(`/crates/types/${WD}`, { version: wd.version, name: wd.name, replacementCost: 120, reorderLevel: 0, isActive: false }), 'retire');
  const retiredOut = await ops.post('/crates/movements', { kind: 'issued', partyKind: 'customer', partyId: hotel.id, lines: [{ crateTypeId: WD, quantity: 1 }] });
  check("a retired type can't go out", retiredOut.status === 409);

  // ---- Totals and books ----
  const overview = must(await ops.get('/crates/overview'), 'overview');
  const pl = overview.types.find((t) => t.code === 'PL20');
  const lostPl = 5 + 4 + (deducted ? 2 : 0);
  check('every crate accounted for: owned + lost = bought', pl.owned + pl.lost === 200 && pl.lost === lostPl && pl.vehicles === 0, JSON.stringify({ owned: pl.owned, yard: pl.yard, customers: pl.customers, farmers: pl.farmers, lost: pl.lost }));
  const after = await bal();
  const delta = (code) => money(cents(after[code] ?? '0') - cents(before[code] ?? '0'));
  check('books: crates expensed when bought; recoveries are income; GST owed', delta('crate_purchases') === '32000.00' && delta('crate_recoveries') === money(72000 + deducted) && money(cents(delta('output_cgst')) + cents(delta('output_sgst')) + cents(delta('output_igst'))) === '129.60', `${delta('crate_purchases')} / ${delta('crate_recoveries')}`);
  const tb = must(await owner.get('/accounting/trial-balance'), 'tb');
  check('trial balance balances', tb.balanced);
  const losses = must(await acc.get('/crates/losses'), 'losses');
  check('loss register', losses.length === (deducted ? 3 : 2) && losses.some((l) => l.recovery === 'invoiced'));

  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
})().catch((e) => {
  console.error('FAILED:', e.stack);
  process.exit(1);
});
