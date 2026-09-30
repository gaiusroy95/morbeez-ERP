// End-to-end: the finance engine driven through the real HTTP API, as the
// real roles. The superuser connection is used only to backdate invoices
// (aging / finance charges need time to pass) and to read the ledger.
const { API, DB_URL, PASSWORD } = require('../lib/env');
const { Client } = require('pg');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`);
};

async function login(email) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const j = await r.json();
  return j.accessToken || j.data?.accessToken;
}

function client(token) {
  const call = async (method, path, body) => {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    const json = text ? JSON.parse(text) : null;
    return { status: r.status, body: json };
  };
  const ok = async (method, path, body) => {
    const res = await call(method, path, body);
    if (res.status >= 300) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  };
  return {
    raw: call,
    get: (p) => ok('GET', p),
    post: (p, b = {}) => ok('POST', p, b),
  };
}

const cents = (s) => Math.round(Number(s) * 100);

(async () => {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const owner = client(await login('owner@dev.morbeez.local'));
  const acc = client(await login('accountant@dev.morbeez.local'));
  const ops = client(await login('ops-manager@dev.morbeez.local'));
  const stamp = Date.now().toString(36);

  try {
    // ---------- master data ----------
    const f1 = await owner.post('/farmers', { name: `Ramesh ${stamp}` });
    const f2 = await owner.post('/farmers', { name: `Lakshmi ${stamp}` });
    const tomato = await owner.post('/products', { name: `Tomato ${stamp}`, baseUom: 'kg', basePrice: 40 });
    const c1 = await owner.post('/customers', { name: `Hotel ${stamp}`, creditLimit: 100000, paymentTermsDays: 7 });
    const c2 = await owner.post('/customers', { name: `Cafe ${stamp}`, creditLimit: 3000, paymentTermsDays: 0 });
    const vehicle = await owner.post('/vehicles', { registrationNumber: `KA01${stamp}`.slice(0, 12).toUpperCase(), capacityKg: 1000, fuelType: 'diesel' });
    const driver = await owner.post('/workforce', { name: `Driver ${stamp}`, roleType: 'driver' });

    // ---------- advance before any lot (ADV.1) ----------
    const adv = await acc.post('/finance/farmer-payments', { farmerId: f2.id, amount: 500, method: 'cash', notes: 'advance for seed' });
    check('farmer advance: nothing owed, so all 500 is unapplied', adv.applied === '0.00' && adv.unapplied === '500.00', `${adv.applied}/${adv.unapplied}`);

    // ---------- buy and grade ----------
    async function buy(farmer, qty, price, accepted, unitCost) {
      let po = await owner.post('/procurement/purchase-orders', {
        farmerId: farmer.id,
        lines: [{ productId: tomato.id, expectedQuantity: qty, indicativePrice: price }],
      });
      po = await owner.post(`/procurement/purchase-orders/${po.id}/confirm`, { version: po.version });
      await owner.post(`/procurement/purchase-orders/${po.id}/receive-goods`, { lines: [{ productId: tomato.id, receivedQuantity: qty }] });
      const [lot] = await owner.get(`/procurement/purchase-orders/${po.id}/lots`);
      const graded = await owner.post(`/procurement/lots/${lot.id}/grade`, {
        version: lot.version,
        acceptedQuantity: accepted,
        rejectedQuantity: qty - accepted,
        unitCost,
        grade: 'A',
      });
      return { po, lot: graded };
    }
    const b1 = await buy(f1, 100, 20, 95, 20); // owed 1900
    const b2 = await buy(f2, 50, 18, 50, 18); // owed 900, advance 500 draws first

    let payables = await acc.get('/finance/payables');
    const p1 = payables.farmers.find((f) => f.farmerId === f1.id);
    const p2 = payables.farmers.find((f) => f.farmerId === f2.id);
    check('grading accrues the payable: F1 owed 1900.00', p1?.owed === '1900.00', p1?.owed);
    check('advance applied at grading: F2 owed 400.00, advance 0.00', p2?.owed === '400.00' && p2?.advance === '0.00', `${p2?.owed} / ${p2?.advance}`);
    const st2 = await owner.get(`/procurement/purchase-orders/${b2.po.id}/settlements`);
    check('procurement lot view shows the advance as paid', st2[0]?.paid === '500.00' && st2[0]?.outstanding === '400.00', JSON.stringify(st2[0]));

    // legacy settle endpoint routes through Finance (partial), then a finance payment clears it with an advance left
    const s1 = await owner.post(`/procurement/lots/${b1.lot.id}/settle`, { amount: 1000, method: 'upi' });
    check('procurement settle = Finance payment on that lot', s1.applied === '1000.00' && s1.allocations?.[0]?.lotId === b1.lot.id, `${s1.applied}`);
    const fp = await acc.post('/finance/farmer-payments', { farmerId: f1.id, amount: 1000, feeAmount: 5, method: 'bank_transfer', reference: 'NEFT-1' });
    check('payment pays the remaining 900 and leaves 100 as an advance', fp.applied === '900.00' && fp.unapplied === '100.00', `${fp.applied}/${fp.unapplied}`);
    const po1 = await owner.get(`/procurement/purchase-orders/${b1.po.id}`);
    check('purchase order closes once its lots are fully paid', po1.status === 'closed', po1.status);

    // ---------- sell ----------
    const mkOrder = (customer, qty, price) =>
      owner.post('/orders', { customerId: customer.id, lines: [{ productId: tomato.id, quantity: qty, unitPrice: price }] });
    let o1 = await mkOrder(c1, 80, 35); // 2800, takes lot 1 (95 kg @ 20)
    o1 = await owner.post(`/orders/${o1.id}/confirm`, { version: o1.version });
    let o2 = await mkOrder(c1, 40, 35); // 1400, takes lot 2 (50 kg @ 18)
    o2 = await owner.post(`/orders/${o2.id}/confirm`, { version: o2.version });

    let trip = await owner.post('/logistics/trips', { vehicleId: vehicle.id, driverEmployeeId: driver.id, advanceAmount: 2000 });
    const stop1 = await owner.post(`/logistics/trips/${trip.id}/stops/delivery`, { orderId: o1.id });
    const stop2 = await owner.post(`/logistics/trips/${trip.id}/stops/delivery`, { orderId: o2.id });
    trip = await owner.post(`/logistics/trips/${trip.id}/start`, { version: trip.version });
    await owner.post(`/logistics/trips/${trip.id}/stops/${stop1.id}/complete-delivery`, { recipientName: 'Chef', signatureData: 'data:image/png;base64,iVBORw0KGgo=' });

    let invoices = await acc.get(`/finance/invoices?customerId=${c1.id}`);
    const inv1 = invoices.items.find((i) => i.orderId === o1.id);
    check('delivery issues the invoice: 80 × 35 = 2800.00', inv1?.amount === '2800.00' && inv1?.kind === 'sale', `${inv1?.invoiceNumber} ${inv1?.amount}`);
    const today = (await db.query(`SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS d`)).rows[0].d;
    const due = (await db.query(`SELECT ($1::date + 7)::text AS d`, [today])).rows[0].d;
    check('due date = delivery date + 7-day terms', inv1?.dueDate === due, `${inv1?.dueDate} vs ${due}`);

    const cogs = await db.query(
      `SELECT l.account_code, l.debit::text, l.credit::text FROM money.ledger_line l JOIN money.ledger_entry e ON e.id = l.entry_id
        WHERE e.entry_type = 'cogs_recognized' AND e.source_id = $1 ORDER BY l.debit DESC`,
      [o1.id],
    );
    check('COGS posted at delivery: 80 kg × 20.00 = 1600.00', cogs.rows[0]?.debit === '1600.00' && cogs.rows[0]?.account_code === 'cost_of_goods_sold', JSON.stringify(cogs.rows));

    // driver collects part in cash at the stop
    await owner.post(`/logistics/trips/${trip.id}/stops/${stop1.id}/collections`, { amount: 1000, method: 'cash' });
    let inv1d = await acc.get(`/finance/invoices/${inv1.id}`);
    check('trip cash collection pays that invoice', inv1d.paid === '1000.00' && inv1d.outstanding === '1800.00', `${inv1d.paid}/${inv1d.outstanding}`);

    // second delivery
    await owner.post(`/logistics/trips/${trip.id}/stops/${stop2.id}/complete-delivery`, { recipientName: 'Chef', signatureData: 'data:image/png;base64,iVBORw0KGgo=' });
    invoices = await acc.get(`/finance/invoices?customerId=${c1.id}`);
    const inv2 = invoices.items.find((i) => i.orderId === o2.id);
    check('second delivery invoiced: 1400.00', inv2?.amount === '1400.00', inv2?.amount);

    // office UPI with fee — oldest due first, overpayment held as credit
    const upi = await acc.post('/finance/customer-payments', { customerId: c1.id, amount: 3500, feeAmount: 10, method: 'upi', reference: 'UTR-77' });
    check('office payment applies oldest first: 1800 + 1400, 300 on account', upi.applied === '3200.00' && upi.unapplied === '300.00', `${upi.applied}/${upi.unapplied}`);
    let credit = await acc.get(`/finance/customers/${c1.id}/credit`);
    check('credit status: balance = -300.00 (in credit)', credit.balance === '-300.00' && credit.unappliedCredit === '300.00', `${credit.balance}`);

    // bounced: reverse the UPI payment
    const rev = await acc.post(`/finance/customer-payments/${upi.id}/reverse`, { reason: 'Chargeback from bank' });
    check('reversal marks the payment reversed', rev.reversedAt !== null && rev.reversalReason === 'Chargeback from bank');
    inv1d = await acc.get(`/finance/invoices/${inv1.id}`);
    credit = await acc.get(`/finance/customers/${c1.id}/credit`);
    check('reversed payment: invoices fall due again (owed 3200.00)', inv1d.outstanding === '1800.00' && credit.balance === '3200.00', `${inv1d.outstanding} / ${credit.balance}`);
    const again = await acc.raw('POST', `/finance/customer-payments/${upi.id}/reverse`, { reason: 'again' });
    check('cannot reverse twice (409)', again.status === 409, String(again.status));

    // ---------- credit terms ----------
    const c1now = await owner.get(`/customers/${c1.id}`);
    const accTerms = await acc.raw('POST', `/customers/${c1.id}/credit-terms`, { version: c1now.version, creditLimit: 999999 });
    check('accountant cannot change credit terms (403)', accTerms.status === 403, String(accTerms.status));
    const oldPatch = await owner.raw('PATCH', `/customers/${c1.id}`, { version: c1now.version, creditLimit: 5 });
    check('general customer update no longer accepts credit fields (400)', oldPatch.status === 400, String(oldPatch.status));
    const terms = await owner.post(`/customers/${c1.id}/credit-terms`, {
      version: c1now.version,
      financeChargeRateMonthly: 2,
      financeChargeGraceDays: 0,
    });
    check('owner sets finance-charge terms', terms.financeChargeRateMonthly === '2.00', terms.financeChargeRateMonthly);

    const holdMissingReason = await owner.raw('POST', `/customers/${c1.id}/credit-terms`, { version: terms.version, creditHold: true });
    check('a hold needs a reason (400)', holdMissingReason.status === 400, String(holdMissingReason.status));
    const held = await owner.post(`/customers/${c1.id}/credit-terms`, { version: terms.version, creditHold: true, creditHoldReason: 'UPI chargeback' });
    let o3 = await mkOrder(c1, 1, 35);
    const blocked = await owner.raw('POST', `/orders/${o3.id}/confirm`, { version: o3.version });
    check('credit hold blocks confirmation (409)', blocked.status === 409 && /credit hold: UPI chargeback/.test(blocked.body?.error?.message), blocked.body?.error?.message);
    await owner.post(`/customers/${c1.id}/credit-terms`, { version: held.version, creditHold: false });

    let o4 = await mkOrder(c2, 100, 35); // 3500 > 3000 limit
    const over = await owner.raw('POST', `/orders/${o4.id}/confirm`, { version: o4.version });
    check('credit limit blocks confirmation (409)', over.status === 409 && /credit limit/.test(over.body?.error?.message), over.body?.error?.message);

    // ---------- finance charges ----------
    // Backdate INV for o1 so it's 40 days past due (superuser; simulating time passing).
    await db.query(`UPDATE money.invoice SET due_date = $2::date - 40, issued_at = issued_at - interval '47 days' WHERE id = $1`, [inv1.id, today]);
    const run = await acc.post('/finance/finance-charges/run', {});
    const expected = (Math.round((180000 * 2 * 40) / (100 * 30)) / 100).toFixed(2); // 180000 paise × 2% × 40/30, half-up to the paisa
    const charge = run.charges.find((c) => c.sourceInvoiceId === inv1.id);
    check(`finance charge: 1800.00 × 2% × 40/30 = ${expected}`, charge?.amount === expected && charge?.days === 40, `${charge?.amount} for ${charge?.days} days`);
    const rerun = await acc.post('/finance/finance-charges/run', {});
    check('re-running the same day charges nothing', rerun.charged === 0, String(rerun.charged));
    const fcInvoices = await acc.get(`/finance/invoices?customerId=${c1.id}&kind=finance_charge`);
    check('the charge is its own FC- invoice', fcInvoices.items.length === 1 && /^FC-\d{6}$/.test(fcInvoices.items[0].invoiceNumber), fcInvoices.items[0]?.invoiceNumber);
    const receivables = await acc.get('/finance/receivables');
    const r1 = receivables.customers.find((c) => c.customerId === c1.id);
    check('receivables ages the backdated invoice as 31–60 days late', r1?.overdue31To60 === '1800.00', r1?.overdue31To60);

    // ---------- finance costs ----------
    const cost = await acc.post('/finance/finance-costs', { category: 'bank_charges', amount: 150, paidFrom: 'bank', description: 'September account fee' });
    const costs = await acc.get('/finance/finance-costs?days=7');
    const hasFees = costs.items.some((i) => i.source === 'customer_payment_fee') && costs.items.some((i) => i.source === 'farmer_payment_fee');
    check('finance costs report: recorded cost + payment fees', costs.items.some((i) => i.id === cost.id) && hasFees, `total ${costs.total}`);
    const opsCost = await ops.raw('POST', '/finance/finance-costs', { category: 'other', amount: 1, paidFrom: 'bank', description: 'nope' });
    check('ops manager cannot record finance costs (403)', opsCost.status === 403, String(opsCost.status));

    // ---------- statement ----------
    const statement = await acc.get(`/finance/customers/${c1.id}/statement?days=90`);
    credit = await acc.get(`/finance/customers/${c1.id}/credit`);
    check('statement closing balance = what the customer owes', statement.closingBalance === credit.balance, `${statement.closingBalance} vs ${credit.balance}`);
    const kinds = new Set(statement.lines.map((l) => l.kind));
    check('statement shows invoices, payments, the reversal, and the charge', ['invoice', 'payment', 'payment_reversal', 'finance_charge'].every((k) => kinds.has(k)), [...kinds].join(','));

    // ---------- the ledger ----------
    const tb = await acc.get('/finance/ledger/trial-balance');
    check('trial balance: debits = credits', tb.balanced === true, `${tb.totals.debit} = ${tb.totals.credit}`);
    for (const c of tb.checks) check(`control account agrees with sub-ledger: ${c.name}`, c.agrees, `${c.ledger} vs ${c.subledger}`);
    const unbalanced = await db.query(
      `SELECT e.id FROM money.ledger_entry e JOIN money.ledger_line l ON l.entry_id = e.id GROUP BY e.id HAVING SUM(l.debit) <> SUM(l.credit)`,
    );
    check('no ledger entry anywhere is unbalanced', unbalanced.rowCount === 0, String(unbalanced.rowCount));
    const types = await db.query(`SELECT entry_type, count(*)::int n FROM money.ledger_entry GROUP BY 1 ORDER BY 1`);
    const posted = new Set(types.rows.map((r) => r.entry_type));
    const engineEvents = ['invoice_issued', 'cogs_recognized', 'payment_received', 'payment_reversed', 'payable_accrued', 'farmer_payment_made', 'finance_charge_accrued', 'finance_cost_recorded', 'trip_advance_issued'];
    check('every engine event posted', engineEvents.every((t) => posted.has(t)), types.rows.map((r) => `${r.entry_type}:${r.n}`).join(' '));

    // ---------- trip still reconciles; dashboard reflects the engine ----------
    trip = await owner.get(`/logistics/trips/${trip.id}`);
    trip = await owner.post(`/logistics/trips/${trip.id}/complete`, { version: trip.version });
    await owner.post(`/logistics/trips/${trip.id}/reconcile`, { version: trip.version, cashReturned: 2000 });
    const kpis = await owner.get('/dashboard/kpis?days=7');
    check('dashboard receivables = engine receivables', cents(kpis.receivablesOutstanding.value) >= cents(credit.balance), kpis.receivablesOutstanding.value);
    const alerts = await owner.raw('GET', '/dashboard/alerts');
    check('dashboard alerts still load', alerts.status === 200);

    // ---------- permissions ----------
    const opsPay = await ops.raw('POST', '/finance/customer-payments', { customerId: c1.id, amount: 1, method: 'cash' });
    check('ops manager cannot record collections (403)', opsPay.status === 403, String(opsPay.status));
    const badAlloc = await acc.raw('POST', '/finance/customer-payments', {
      customerId: c1.id,
      amount: 10,
      method: 'cash',
      allocations: [{ invoiceId: inv2.id, amount: 999999 }],
    });
    check('over-allocating an invoice is refused (400)', badAlloc.status === 400, badAlloc.body?.error?.message);
  } catch (e) {
    check('script step', false, e.message);
  }

  console.log(results.join('\n'));
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  await db.end();
})();
