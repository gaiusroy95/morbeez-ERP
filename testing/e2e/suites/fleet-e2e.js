// Vehicle economics through the real HTTP API, after the other suites (the
// seeded MH12AB4521 already has trips; the books are closed through last
// month). Every figure is checked exactly.
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
  const periods = must(await owner.get('/accounting/periods'), 'periods');
  const today = periods.today;
  const shift = (date, days) => {
    const x = new Date(`${date}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + days);
    return x.toISOString().slice(0, 10);
  };
  const month = (n) => {
    const [y, m] = today.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
  };
  const thisMonth = month(0);
  const lastMonth = month(-1); // YYYY-MM-01
  const twoAgo = month(-2);
  const bal = async () => Object.fromEntries(must(await owner.get('/accounting/accounts'), 'accounts').map((a) => [a.code, a.balance]));
  const before = await bal();

  // ---- Settings and the fleet ----
  const settings = must(await owner.get('/fleet/settings'), 'settings');
  check('settings default: 30-day reminder, expired documents block trips', settings.version === 0 && settings.documentReminderDays === 30 && settings.blockTripsOnExpired === true);
  let fleet = must(await ops.get('/fleet/vehicles'), 'fleet');
  const main = fleet.find((v) => v.registrationNumber === 'MH12AB4521');
  check('the seeded vehicle shows as owned and fit', main && main.ownership === 'owned' && main.fitForTrips && main.issues.length === 0);

  // ---- Documents and roadworthiness ----
  must(await ops.post('/fleet/documents', { vehicleId: main.vehicleId, docType: 'insurance', docNumber: 'POL-1', validUntil: shift(today, -1) }), 'lapsed insurance');
  must(await ops.post('/fleet/documents', { vehicleId: main.vehicleId, docType: 'puc', validUntil: shift(today, 10) }), 'puc');
  const noExpiry = await ops.post('/fleet/documents', { vehicleId: main.vehicleId, docType: 'fitness' });
  check('a fitness certificate needs its expiry', noExpiry.status === 400, msg(noExpiry));
  let detail = must(await ops.get(`/fleet/vehicles/${main.vehicleId}`), 'detail');
  check('lapsed insurance makes it unfit; PUC due in 10 days is flagged', !detail.fitForTrips && detail.issues.some((i) => /Insurance expired/.test(i)) && detail.issues.some((i) => /PUC certificate expires/.test(i)), detail.issues.join('; '));

  const drivers = must(await owner.get('/workforce?page=1&pageSize=50'), 'employees').items;
  const suresh = drivers.find((e) => e.name === 'Suresh Kale');
  const blocked = await owner.post('/logistics/trips', { vehicleId: main.vehicleId, driverEmployeeId: suresh.id });
  check('dispatch refuses a trip on a vehicle with lapsed insurance', blocked.status === 409 && /Insurance/.test(msg(blocked)), msg(blocked));

  must(await ops.post('/fleet/documents', { vehicleId: main.vehicleId, docType: 'insurance', docNumber: 'POL-2', validFrom: today, validUntil: shift(today, 364), amount: 24000, paidFrom: 'bank' }), 'renewal');
  detail = must(await ops.get(`/fleet/vehicles/${main.vehicleId}`), 'detail');
  check('the renewal supersedes it; fit again', detail.fitForTrips && detail.allDocuments.filter((d) => d.docType === 'insurance').map((d) => d.superseded).join() === 'false,true');
  const trip = await owner.post('/logistics/trips', { vehicleId: main.vehicleId, driverEmployeeId: suresh.id });
  check('dispatch goes through once renewed', trip.status === 201, msg(trip));
  if (trip.status === 201) must(await owner.post(`/logistics/trips/${trip.body.id}/cancel`, { version: trip.body.version }), 'cancel trip');
  const accFuel = await acc.post('/fleet/fuel', { vehicleId: main.vehicleId, filledOn: today, litres: 10, amount: 900, paidFrom: 'bank' });
  check('the accountant does not record running costs', accFuel.status === 403);

  // ---- Fuel and maintenance ----
  must(await ops.post('/fleet/fuel', { vehicleId: main.vehicleId, filledOn: shift(today, -5), litres: 40, amount: 3600, odometerKm: 20000, station: 'HP Wakad', paidFrom: 'cash_on_hand' }), 'fill 1');
  must(await ops.post('/fleet/fuel', { vehicleId: main.vehicleId, filledOn: shift(today, -1), litres: 50, amount: 4500, odometerKm: 20450, paidFrom: 'bank' }), 'fill 2');
  const backwards = await ops.post('/fleet/fuel', { vehicleId: main.vehicleId, filledOn: today, litres: 5, amount: 450, odometerKm: 19000, paidFrom: 'cash_on_hand' });
  check('the odometer never goes backwards', backwards.status === 400, msg(backwards));
  const noPay = await ops.post('/fleet/maintenance', { vehicleId: main.vehicleId, serviceDate: today, kind: 'repair', description: 'Clutch plate', amount: 1200 });
  check('a paid repair says how it was paid', noPay.status === 400, msg(noPay));
  must(await ops.post('/fleet/maintenance', { vehicleId: main.vehicleId, serviceDate: shift(today, -6), kind: 'service', description: 'Oil and filters', vendor: 'Sai Motors', odometerKm: 19900, amount: 2500, paidFrom: 'cash_on_hand', nextDueKm: 20400 }), 'service');
  must(await ops.post('/fleet/maintenance', { vehicleId: main.vehicleId, serviceDate: today, kind: 'tyres', description: 'Puncture under warranty', amount: 0 }), 'warranty');
  detail = must(await ops.get(`/fleet/vehicles/${main.vehicleId}`), 'detail');
  check('service due at 20,400 km is overdue at 20,450', detail.maintenanceDue?.overdue === true && detail.lastOdometerKm === 20450 && detail.issues.some((i) => /Maintenance overdue/.test(i)), JSON.stringify(detail.maintenanceDue));

  // ---- An owned vehicle on the books: capitalise, depreciate, finance, dispose ----
  const truck = must(await owner.post('/vehicles', { registrationNumber: 'MH12XY0001', capacityKg: 3000, fuelType: 'diesel' }), 'truck');
  const opsCap = await ops.post(`/fleet/vehicles/${truck.id}/capitalize`, { capitalizedOn: twoAgo, cost: 1200000, salvageValue: 120000, method: 'straight_line', usefulLifeMonths: 96, fundedBy: 'owner_capital' });
  check('the ops manager does not keep the fleet books', opsCap.status === 403);
  if (periods.lockedThrough) {
    const closed = await acc.post(`/fleet/vehicles/${truck.id}/capitalize`, { capitalizedOn: periods.lockedThrough, cost: 1200000, salvageValue: 120000, method: 'straight_line', usefulLifeMonths: 96, fundedBy: 'owner_capital' });
    check('capitalising into a closed period is refused', closed.status === 409 && closed.body.error.code === 'PERIOD_CLOSED', `locked through ${periods.lockedThrough}`);
    const latest = periods.closes.filter((c) => !c.reopenedAt).sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1))[0];
    must(await owner.post(`/accounting/periods/${latest.id}/reopen`, { reason: 'Fleet register catch-up' }), 'reopen');
  }
  const capitalizedOn = `${twoAgo.slice(0, 8)}16`;
  const cap = must(await acc.post(`/fleet/vehicles/${truck.id}/capitalize`, { capitalizedOn, cost: 1200000, salvageValue: 120000, method: 'straight_line', usefulLifeMonths: 96, fundedBy: 'owner_capital' }), 'capitalize');
  check('capitalised at cost', cap.asset.cost === '1200000.00' && cap.asset.netBookValue === '1200000.00' && cap.netBookValue === '1200000.00');
  const twice = await acc.post(`/fleet/vehicles/${truck.id}/capitalize`, { capitalizedOn, cost: 1, salvageValue: 0, method: 'straight_line', usefulLifeMonths: 1, fundedBy: 'bank' });
  check('only once', twice.status === 409);
  const editCost = await owner.patch(`/vehicles/${truck.id}`, { version: 2, acquisitionCost: 1000000 });
  check("the vehicle record's cost follows the asset register", editCost.status === 409, msg(editCost));
  const notOver = await acc.post('/fleet/depreciation/run', { throughMonth: thisMonth.slice(0, 7) });
  check("depreciation waits for the month to end", notOver.status === 400, msg(notOver));

  const dim = (m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
  const firstMonth = Math.round((1125000 * (dim(twoAgo) - 16 + 1)) / dim(twoAgo)); // 11,250.00 × days owned, in cents
  const run = must(await acc.post('/fleet/depreciation/run', { throughMonth: lastMonth.slice(0, 7) }), 'depreciation');
  const truckMonths = run.months.map((m) => `${m.month}:${m.total}`).join(', ');
  check('two months charged, the first for the days owned', run.months.length === 2 && run.months[0].total === money(firstMonth) && run.months[1].total === '11250.00', truckMonths);
  const rerun = await acc.post('/fleet/depreciation/run', { throughMonth: lastMonth.slice(0, 7) });
  check('a month is charged once', rerun.status === 409, msg(rerun));
  const accumulated = firstMonth + 1125000;

  const loan = must(await acc.post('/fleet/loans', { vehicleId: truck.id, lender: 'HDFC Bank', accountNumber: 'CV-889', principal: 800000, annualRate: 9, tenureMonths: 60, disbursedOn: `${twoAgo.slice(0, 8)}10`, firstEmiOn: `${lastMonth.slice(0, 8)}10` }), 'loan').loans[0];
  const lastEmi = loan.schedule[59];
  check('loan: EMI by the reducing-balance formula; the 60th clears it', loan.emi === '16606.68' && loan.schedule.length === 60 && lastEmi.outstandingAfter === '0.00' && loan.nextDue.interest === '6000.00', `${loan.emi} over ${loan.schedule.length}`);
  const p1 = must(await acc.post(`/fleet/loans/${loan.id}/payments`, { version: loan.version, paidOn: `${lastMonth.slice(0, 8)}10`, paidFrom: 'bank', reference: 'ECS' }), 'emi 1').loans[0];
  const stale = await acc.post(`/fleet/loans/${loan.id}/payments`, { version: loan.version, paidOn: today, paidFrom: 'bank' });
  check('a stale form cannot pay twice', stale.status === 409, msg(stale));
  const p2 = must(await acc.post(`/fleet/loans/${loan.id}/payments`, { version: p1.version, paidOn: today, paidFrom: 'bank' }), 'emi 2').loans[0];
  const left1 = 80000000 - (1660668 - 600000);
  const i2 = Math.round((left1 * 900) / 120000); // 0.75% of what EMI 1 left
  check('EMIs: interest first, then principal', p2.payments[0].interest === '6000.00' && p2.payments[0].principal === '10606.68' && p2.payments[1].interest === money(i2) && p2.outstanding === money(left1 - (1660668 - i2)), p2.payments.map((p) => `${p.interest}+${p.principal}`).join(', '));
  const over = await acc.post(`/fleet/loans/${loan.id}/payments`, { version: p2.version, paidOn: today, paidFrom: 'bank', amount: 900000 });
  check('paying more than is owed is refused', over.status === 400, msg(over));

  const early = await acc.post(`/fleet/vehicles/${truck.id}/dispose`, { disposedOn: `${lastMonth.slice(0, 8)}20`, method: 'sold', proceeds: 1, receivedInto: 'bank' });
  check('a disposal is dated after the last month charged', early.status === 409, msg(early));
  const statusDispose = await owner.patch(`/vehicles/${truck.id}/status`, { status: 'disposed' });
  check('a vehicle on the books leaves only through its disposal', statusDispose.status === 409, msg(statusDispose));
  const nbv = 120000000 - accumulated;
  const disposed = must(await acc.post(`/fleet/vehicles/${truck.id}/dispose`, { disposedOn: today, method: 'sold', proceeds: 1150000, receivedInto: 'bank', buyer: 'Shree Logistics' }), 'dispose');
  check('sold below book value: a loss', disposed.status === 'disposed' && disposed.asset.disposal.netBookValue === money(nbv) && disposed.asset.disposal.gainLoss === money(115000000 - nbv), JSON.stringify(disposed.asset.disposal));
  const back = await owner.patch(`/vehicles/${truck.id}/status`, { status: 'active' });
  const fuelAfter = await ops.post('/fleet/fuel', { vehicleId: truck.id, filledOn: today, litres: 5, amount: 450, paidFrom: 'cash_on_hand' });
  check('a disposal is final', back.status === 409 && fuelAfter.status === 409, `${msg(back)} / ${msg(fuelAfter)}`);

  // ---- A hired vehicle ----
  const hired = must(await owner.post('/vehicles', { registrationNumber: 'MH14HR7777', capacityKg: 2000, fuelType: 'diesel' }), 'hired');
  const noContract = await acc.post(`/fleet/vehicles/${hired.id}/hire-contracts`, { ownerName: 'Ravi Transport', rateBasis: 'per_trip', rate: 1800, includesFuel: false, effectiveFrom: thisMonth });
  check('a hire rate needs the vehicle marked hired', noContract.status === 409, msg(noContract));
  must(await ops.put(`/fleet/vehicles/${hired.id}/profile`, { version: 0, ownership: 'hired', makeModel: 'Eicher Pro 2049' }), 'mark hired');
  const capHired = await acc.post(`/fleet/vehicles/${hired.id}/capitalize`, { capitalizedOn: today, cost: 100, salvageValue: 0, method: 'straight_line', usefulLifeMonths: 12, fundedBy: 'bank' });
  check('a hired vehicle is not an asset', capHired.status === 409);
  must(await acc.post(`/fleet/vehicles/${hired.id}/hire-contracts`, { ownerName: 'Ravi Transport', ownerPan: 'ABCPR1234K', rateBasis: 'per_trip', rate: 1800, includesFuel: false, effectiveFrom: thisMonth }), 'contract');
  const suggestion = must(await acc.get(`/fleet/vehicles/${hired.id}/hire-suggestion?from=${thisMonth}&to=${today}`), 'suggestion');
  check('the bill is counted from its trips', suggestion.rateBasis === 'per_trip' && suggestion.quantity === '0.000' && suggestion.trips === 0, suggestion.basis);
  const bill = must(await acc.post('/fleet/hire-bills', { vehicleId: hired.id, periodStart: thisMonth, periodEnd: shift(thisMonth, 14), quantity: 5, billReference: 'RT/112' }), 'bill');
  check('hire bill at the contract rate', bill.amount === '9000.00' && bill.status === 'unpaid');
  const overlap = await acc.post('/fleet/hire-bills', { vehicleId: hired.id, periodStart: shift(thisMonth, 10), periodEnd: shift(thisMonth, 20), quantity: 1 });
  check('a period is billed once', overlap.status === 409, msg(overlap));
  const backToOwned = await ops.put(`/fleet/vehicles/${hired.id}/profile`, { version: 1, ownership: 'owned' });
  check('a vehicle with hire contracts stays hired', backToOwned.status === 409, msg(backToOwned));
  const paid = must(await acc.post(`/fleet/hire-bills/${bill.id}/pay`, { version: bill.version, paidOn: today, paidFrom: 'bank', tdsSectionCode: '194C' }), 'pay bill');
  check('194C withheld at 1% for an individual owner', paid.status === 'paid' && paid.tdsAmount === '90.00' && paid.tdsSection === '194C');
  const payAgain = await acc.post(`/fleet/hire-bills/${bill.id}/pay`, { version: paid.version, paidOn: today, paidFrom: 'bank' });
  check('a bill is paid once', payAgain.status === 409);

  // ---- The books ----
  const after = await bal();
  const delta = (code) => money(cents(after[code] ?? '0') - cents(before[code] ?? '0'));
  const interest = 600000 + i2;
  check('fuel, maintenance and documents expensed', delta('vehicle_fuel') === '8100.00' && delta('repairs_maintenance') === '2500.00' && delta('vehicle_insurance_taxes') === '24000.00', `${delta('vehicle_fuel')} ${delta('repairs_maintenance')} ${delta('vehicle_insurance_taxes')}`);
  check('the disposed asset left no cost or depreciation behind', after.fixed_assets_vehicles === '0.00' && after.accumulated_depreciation === '0.00', `${after.fixed_assets_vehicles} / ${after.accumulated_depreciation}`);
  check('depreciation and the loss on disposal', delta('depreciation_expense') === money(accumulated) && delta('loss_on_disposal') === money(nbv - 115000000));
  check('loan: principal still owed, interest expensed', after.vehicle_loans === p2.outstanding && delta('loan_interest') === money(interest), `${after.vehicle_loans} ${delta('loan_interest')}`);
  check('hire: expensed, nothing left payable, TDS owed to the government', delta('vehicle_hire_charges') === '9000.00' && after.hire_payable === '0.00' && delta('tds_payable') === '90.00');
  const tb = must(await owner.get('/accounting/trial-balance'), 'tb');
  const bs = must(await owner.get('/accounting/balance-sheet'), 'bs');
  check('trial balance and balance sheet balance', tb.balanced && bs.balanced);

  // ---- The cost report ----
  const report = must(await acc.get(`/fleet/economics?from=${twoAgo}&to=${today}`), 'economics');
  const row = (r) => report.rows.find((x) => x.registrationNumber === r);
  const m = row('MH12AB4521');
  const t = row('MH12XY0001');
  const h = row('MH14HR7777');
  const parts = (x) => cents(x.fuel) + cents(x.maintenance) + cents(x.documents) + cents(x.depreciation) + cents(x.loanInterest) + cents(x.hire);
  check('running vehicle: trips, km from odometer, 9 km/L, costs add up', m && m.trips >= 2 && m.km === 450 && m.kmPerLitre === '9.00' && m.litres === '90.000' && cents(m.fuel) >= 810000 && m.maintenance === '2500.00' && m.documents === '24000.00' && cents(m.total) === parts(m) && m.costPerKm === money(Math.round(cents(m.total) / 450)), m && `${m.trips} trips, fuel ${m.fuel}, total ${m.total}, per km ${m.costPerKm}`);
  check('the truck carries its depreciation and interest', t && t.depreciation === money(accumulated) && t.loanInterest === money(interest) && t.trips === 0 && t.costPerTrip === null);
  check('the hired vehicle carries its hire', h && h.hire === '9000.00' && h.ownership === 'hired');
  check('report totals', cents(report.totals.total) === report.rows.reduce((s, r) => s + cents(r.total), 0));

  // ---- Back to how the books were ----
  if (periods.lockedThrough) {
    const reclosed = await owner.post('/accounting/periods/close', { through: periods.lockedThrough });
    check('books closed again through last month, fleet entries included', reclosed.status === 201 && reclosed.body.lockedThrough === periods.lockedThrough, msg(reclosed));
  }

  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
})().catch((e) => {
  console.error('FAILED:', e.stack);
  process.exit(1);
});
