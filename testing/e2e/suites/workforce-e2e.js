// Workforce and payroll through the real HTTP API, after the other suites
// (the driver Suresh already has completed trips from them). Every figure
// is checked exactly.
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

(async () => {
  const owner = as(await login('owner@dev.morbeez.local'));
  const ops = as(await login('ops-manager@dev.morbeez.local'));
  const acc = as(await login('accountant@dev.morbeez.local'));
  const today = must(await owner.get('/accounting/periods'), 'periods').today;
  const from = `${today.slice(0, 8)}01`;
  const d = (n) => {
    const x = new Date(`${today}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() - n);
    return x.toISOString().slice(0, 10);
  };

  // ---- Rules ----
  must(await owner.put('/workforce/payroll/settings', { version: 0, defaultStateCode: '27', minWagePolicy: 'top_up' }), 'settings');
  must(await owner.post('/workforce/minimum-wages', { stateCode: '27', skillCategory: 'unskilled', dailyRate: 500, effectiveFrom: '2026-04-01', source: 'Test notification' }), 'min wage');
  const mw = must(await owner.post('/workforce/minimum-wages', { stateCode: '27', skillCategory: 'semi_skilled', dailyRate: 550, effectiveFrom: '2026-04-01' }), 'min wage 2');
  check('minimum wages entered per state and skill', mw.length === 2);
  must(await owner.post('/workforce/incentive-rules', { name: 'Extra trips', roleType: 'driver', basis: 'per_trip', threshold: 1, amount: 150, effectiveFrom: '2026-04-01' }), 'incentive');
  const inc = must(await owner.post('/workforce/incentive-rules', { name: 'Attendance bonus', basis: 'attendance', threshold: 2, amount: 200, effectiveFrom: '2026-04-01' }), 'incentive 2');
  check('incentive rules', inc.length === 2);
  const accRule = await acc.post('/workforce/minimum-wages', { stateCode: '27', skillCategory: 'skilled', dailyRate: 600, effectiveFrom: '2026-04-01' });
  check('accountant cannot change rules', accRule.status === 403);

  // ---- Workers ----
  const workers = must(await owner.get('/workforce/workers'), 'workers');
  const suresh = workers.find((w) => w.name === 'Suresh Kale');
  must(await owner.put(`/workforce/workers/${suresh.employeeId}/profile`, { version: 0, employmentType: 'permanent', skillCategory: 'semi_skilled', joinedOn: '2026-01-01' }), 'suresh profile');
  must(await owner.post(`/workforce/workers/${suresh.employeeId}/pay-rates`, { payBasis: 'daily', rate: 450, effectiveFrom: '2026-01-01' }), 'suresh rate');
  const raju = must(await owner.post('/workforce', { name: 'Raju Shinde', roleType: 'warehouse' }), 'raju');
  must(await owner.put(`/workforce/workers/${raju.id}/profile`, { version: 0, employmentType: 'casual', skillCategory: 'unskilled', phone: '98220 11111' }), 'raju profile');
  const piece = await owner.post(`/workforce/workers/${raju.id}/pay-rates`, { payBasis: 'piece', rate: 3, effectiveFrom: '2026-01-01' });
  check('a piece rate must say what a piece is', piece.status === 400, msg(piece));
  must(await owner.post(`/workforce/workers/${raju.id}/pay-rates`, { payBasis: 'piece', rate: 3, unitLabel: 'crate', effectiveFrom: '2026-01-01' }), 'raju rate');

  // ---- Assignments ----
  const trips = must(await owner.get(`/workforce/assignments?from=${from}&to=${today}&employeeId=${suresh.employeeId}`), 'suresh work');
  check('completed trips recorded the driver\'s work automatically', trips.length >= 2 && trips.every((a) => a.kind === 'trip' && a.status === 'completed' && a.tripId && a.hours), trips.map((a) => `${a.workDate} ${a.hours}h ${a.units} stops`).join('; '));
  const tripEdit = await ops.patch(`/workforce/assignments/${trips[0].id}`, { version: trips[0].version, status: 'absent' });
  check('a trip assignment follows its trip', tripEdit.status === 409, msg(tripEdit));
  const a1 = must(await ops.post('/workforce/assignments', { employeeId: raju.id, workDate: d(4), kind: 'loading', status: 'completed', units: 200 }), 'a1');
  must(await ops.post('/workforce/assignments', { employeeId: raju.id, workDate: d(3), kind: 'loading', status: 'planned' }), 'a2');
  const planned = (await ops.get(`/workforce/assignments?from=${d(3)}&to=${d(3)}&employeeId=${raju.id}`)).body[0];
  const done = must(await ops.patch(`/workforce/assignments/${planned.id}`, { version: planned.version, status: 'completed', units: 150 }), 'complete');
  check('a planned assignment is completed with its units', done.status === 'completed' && done.units === '150.000');
  must(await ops.post('/workforce/assignments', { employeeId: raju.id, workDate: d(2), kind: 'loading', status: 'absent', notes: 'Sick' }), 'absent');
  const future = await ops.post('/workforce/assignments', { employeeId: raju.id, workDate: '2099-01-01', kind: 'loading', status: 'completed', units: 1 });
  check('work can\'t be recorded as done in the future', future.status === 400);

  // ---- Advance ----
  // Whatever the earlier suites left closed: an advance dated on the lock date is refused.
  const locked = must(await owner.get('/accounting/periods'), 'periods').lockedThrough;
  if (locked) {
    const closed = await ops.post('/workforce/advances', { employeeId: raju.id, amount: 500, paidOn: locked, paidFrom: 'cash_on_hand' });
    check('an advance dated in a closed period is refused', closed.status === 409 && closed.body.error.code === 'PERIOD_CLOSED', `locked through ${locked}`);
  }
  const adv = must(await ops.post('/workforce/advances', { employeeId: raju.id, amount: 500, paidOn: today, paidFrom: 'cash_on_hand', notes: 'Festival' }), 'advance');
  check('advance recorded, all outstanding', adv[0].outstanding === '500.00');

  // ---- Earnings preview ----
  const preview = must(await ops.get(`/workforce/earnings?from=${from}&to=${today}`), 'earnings');
  const ps = preview.find((p) => p.employeeId === suresh.employeeId);
  const pr = preview.find((p) => p.employeeId === raju.id);
  const kinds = (p) => p.lines.map((l) => `${l.kind}:${l.amount}`).join(', ');
  check(
    'driver: one day at ₹450, trip incentive, topped up to the ₹550 minimum',
    ps.gross === '700.00' && ps.net === '700.00' && ps.lines.find((l) => l.kind === 'minimum_wage_topup')?.amount === '100.00' && ps.lines.find((l) => l.kind === 'incentive')?.amount === '150.00',
    kinds(ps),
  );
  check(
    'loader: 350 crates × ₹3, attendance bonus, advance recovered',
    pr.gross === '1250.00' && pr.deductions === '500.00' && pr.net === '750.00' && pr.daysWorked === 2 && !pr.lines.some((l) => l.kind === 'minimum_wage_topup'),
    kinds(pr),
  );

  // ---- Settlements ----
  const drafts = must(await ops.post('/workforce/settlements', { from, to: today, employeeIds: [suresh.employeeId, raju.id] }), 'draft');
  check('ops manager drafts both', drafts.length === 2 && drafts.every((s) => s.status === 'draft'));
  const sS = drafts.find((s) => s.employeeId === suresh.employeeId);
  const sR = drafts.find((s) => s.employeeId === raju.id);
  const again = await ops.post('/workforce/settlements', { from, to: today, employeeIds: [raju.id] });
  check('the same period can\'t be settled twice', again.status === 409, msg(again));
  const settledEdit = await ops.patch(`/workforce/assignments/${a1.id}`, { version: a1.version, status: 'absent' });
  check('work on a settlement is locked', settledEdit.status === 409, msg(settledEdit));
  const opsApprove = await ops.post(`/workforce/settlements/${sR.id}/approve`, { version: sR.version });
  check('ops manager cannot approve', opsApprove.status === 403);

  const approvedR = must(await acc.post(`/workforce/settlements/${sR.id}/approve`, { version: sR.version }), 'approve raju');
  const approvedS = must(await acc.post(`/workforce/settlements/${sS.id}/approve`, { version: sS.version }), 'approve suresh');
  check('accountant approves both', approvedR.status === 'approved' && approvedS.status === 'approved');
  const voided = must(await owner.post(`/workforce/settlements/${sS.id}/void`, { version: approvedS.version, reason: 'Night delivery allowance missed' }), 'void');
  check('owner voids an approved, unpaid settlement', voided.status === 'void');
  const bal = async () => Object.fromEntries(must(await owner.get('/accounting/accounts'), 'accounts').map((a) => [a.code, a.balance]));
  let b = await bal();
  check('the void reversed its accrual', b.salaries_wages === '1050.00' && b.incentives_expense === '200.00' && b.wages_payable === '750.00' && b.employee_advance === '0.00', JSON.stringify({ w: b.salaries_wages, i: b.incentives_expense, p: b.wages_payable, a: b.employee_advance }));

  const redraft = must(await owner.post('/workforce/settlements', { from, to: today, employeeIds: [suresh.employeeId], adjustments: [{ description: 'Night delivery allowance', amount: 50 }] }), 'redraft');
  check('released work is settled again, with the adjustment', redraft[0].gross === '750.00', redraft[0].lines.map((l) => l.kind).join(','));
  const self = await owner.post(`/workforce/settlements/${redraft[0].id}/approve`, { version: redraft[0].version });
  check('nobody approves their own draft', self.status === 403, msg(self));
  const approved2 = must(await acc.post(`/workforce/settlements/${redraft[0].id}/approve`, { version: redraft[0].version }), 'approve 2');

  const paid1 = must(await acc.post(`/workforce/settlements/${sR.id}/pay`, { version: approvedR.version, paidFrom: 'bank', reference: 'NEFT 1' }), 'pay raju');
  must(await acc.post(`/workforce/settlements/${redraft[0].id}/pay`, { version: approved2.version, paidFrom: 'cash_on_hand' }), 'pay suresh');
  check('settlements paid', paid1.status === 'paid');
  const payTwice = await acc.post(`/workforce/settlements/${sR.id}/pay`, { version: paid1.version, paidFrom: 'bank' });
  const voidPaid = await owner.post(`/workforce/settlements/${sR.id}/void`, { version: paid1.version, reason: 'try it' });
  check('a paid settlement can\'t be paid again or voided', payTwice.status === 409 && voidPaid.status === 409, msg(voidPaid));

  b = await bal();
  // wages: 1050 (Raju) + 450 + 100 top-up + 50 allowance (Suresh) = 1650; incentives 200 + 150
  check('ledger: wage cost, incentives, nothing left payable, advance recovered', b.salaries_wages === '1650.00' && b.incentives_expense === '350.00' && b.wages_payable === '0.00' && b.employee_advance === '0.00', JSON.stringify({ w: b.salaries_wages, i: b.incentives_expense, p: b.wages_payable, a: b.employee_advance }));
  const tb = must(await owner.get('/accounting/trial-balance'), 'tb');
  const bs = must(await owner.get('/accounting/balance-sheet'), 'bs');
  check('trial balance and balance sheet still balance', tb.balanced && bs.balanced);
  const advAfter = must(await owner.get('/workforce/advances'), 'advances');
  check('advance fully recovered', advAfter[0].outstanding === '0.00' && advAfter[0].recovered === '500.00');

  const rateInSettled = await owner.post(`/workforce/workers/${raju.id}/pay-rates`, { payBasis: 'piece', rate: 3.5, unitLabel: 'crate', effectiveFrom: d(3) });
  check('a rate can\'t change inside a settled period', rateInSettled.status === 409, msg(rateInSettled));

  const list = must(await acc.get('/workforce/settlements'), 'list');
  check('settlement register', list.length === 3 && list.filter((s) => s.status === 'paid').length === 2 && list.some((s) => s.status === 'void'));

  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
})().catch((e) => {
  console.error('FAILED:', e.stack);
  process.exit(1);
});
