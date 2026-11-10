// Master Spec v3 P6 — finance completions, through the real API and owner app
// (docs/redesign/master-spec-v3-plan.md, rules F1–F8):
//   F1 credit notes with their GST, approved by someone other than the issuer;
//   F2 a dispute settled with accepted and rejected amounts, the paused charge
//      caught up once — and resumed after 30 days without action;
//   F3 a bad debt written off with its provision, the customer held for review;
//   F4 agent commission at grading, paid with TDS 194H;
//   F5 the finance charge switch and the 18% cost of capital;
//   F6 credit terms as dated versions; F7 farmer terms, due dates, overdue,
//   average payment days; F8 customer Bill-to-Bill.
// Every ledger entry balances, the trial balance is even and every control
// account agrees with its sub-ledger. Makes its own data, on the seed.
const path = require('path');
const { API, BASE, DB_URL, PASSWORD, launchBrowser } = require('../lib/env');
const { Client } = require('pg');

const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`);

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function gstin(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return first14 + CHARS[(36 - (sum % 36)) % 36];
}

async function login(login) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password: PASSWORD }) });
  const body = await r.json();
  if (!body.accessToken) throw new Error(`login ${login}: ${r.status}`);
  return body.accessToken;
}

function client(token) {
  const call = async (method, p, body) => {
    const r = await fetch(`${API}${p}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  const ok = async (method, p, body) => {
    const res = await call(method, p, body);
    if (res.status >= 300) throw new Error(`${method} ${p} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  };
  return { raw: call, get: (p) => ok('GET', p), post: (p, b = {}) => ok('POST', p, b), put: (p, b) => ok('PUT', p, b), patch: (p, b) => ok('PATCH', p, b) };
}

const addDays = (d, n) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

(async () => {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const owner = client(await login('owner@dev.morbeez.local'));
  const accountant = client(await login('accountant@dev.morbeez.local'));
  const ops = client(await login('ops-manager@dev.morbeez.local'));
  const s = Date.now().toString(36);
  const today = (await owner.get('/accounting/periods')).today;
  const shots = process.env.E2E_SCREENSHOTS;

  try {
    // ---- Setup: a GST-registered business selling a 5% product ----
    await owner.put('/tax/profile', {
      version: (await owner.get('/tax/profile')).version,
      registrationType: 'regular',
      gstin: '27AAPFU0939F1ZV',
      legalName: 'Dev Wholesaler Co.',
      addressLine1: 'Shop 12, APMC Market',
      city: 'Navi Mumbai',
      pincode: '400703',
      hsnMinDigits: 6,
      b2clThreshold: 100000,
      einvoiceEnabled: false,
    });
    await owner.post('/tax/gst-rates', { hsnCode: '0712', description: 'Dried vegetables', supplyKind: 'goods', taxability: 'taxable', rate: 5, effectiveFrom: '2017-07-01' });
    const onion = await owner.post('/products', { name: `Dried onion ${s}`, baseUom: 'kg' });
    await owner.put(`/tax/products/${onion.id}`, { hsnCode: '07122000' });
    const farmer = await owner.post('/farmers', { name: `P6 Farm ${s}` });
    const vehicle = await owner.post('/vehicles', { registrationNumber: `MH04P6${s}`.slice(0, 12).toUpperCase(), capacityKg: 3000, fuelType: 'diesel' });
    const driver = await owner.post('/workforce', { name: `P6 Driver ${s}`, roleType: 'driver' });
    const hotel = await owner.post('/customers', { name: `P6 Hotel ${s}`, creditLimit: 900000, paymentTermsDays: 7 });
    await owner.put(`/tax/customers/${hotel.id}`, { gstin: gstin('27AABCP1234A1Z'), legalName: `P6 Hotel ${s} Pvt Ltd`, addressLine1: 'Sector 17', city: 'Vashi', pincode: '400703' });
    const shop = await owner.post('/customers', { name: `P6 Shop ${s}`, creditLimit: 900000, paymentTermsDays: 7 });
    const regular = await owner.post('/customers', { name: `P6 Regular ${s}`, creditLimit: 900000, paymentTermsDays: 0 });

    // ---- F4: an agent with a PAN brings the produce; commission at grading ----
    const agent = await owner.post('/procurement/agents', { name: `Ravi Agent ${s}`, phone: '+919800000071', defaultCommissionPerKg: 1.5, pan: 'abcpr1234k' });
    check('F4: the agent keeps a PAN (for TDS on commission)', agent.pan === 'ABCPR1234K', agent.pan);
    const badPan = await owner.raw('POST', '/procurement/agents', { name: `Bad PAN ${s}`, pan: 'ABC12' });
    check('F4: …and a malformed PAN is refused', badPan.status === 400, String(badPan.status));
    const buy = async (kg, accepted, extra = {}) => {
      let po = await owner.post('/procurement/purchase-orders', { farmerId: farmer.id, lines: [{ productId: onion.id, expectedQuantity: kg, indicativePrice: 20 }], ...extra });
      po = await owner.post(`/procurement/purchase-orders/${po.id}/confirm`, { version: po.version });
      await owner.post(`/procurement/purchase-orders/${po.id}/receive-goods`, { lines: [{ productId: onion.id, receivedQuantity: kg }] });
      const [lot] = await owner.get(`/procurement/purchase-orders/${po.id}/lots`);
      return owner.post(`/procurement/lots/${lot.id}/grade`, { version: lot.version, acceptedQuantity: accepted, rejectedQuantity: kg - accepted, unitCost: 20, rejectionReason: kg > accepted ? 'Wet' : undefined });
    };
    const lot1 = await buy(500, 480, { agentId: agent.id, commissionPerKg: 1.5 });
    let account = await owner.get(`/finance/agents/${agent.id}`);
    check(
      'F4: commission earned at grading — 480 kg accepted × ₹1.50 = ₹720, traceable to the lot and rate (AGT.1, AGT.3)',
      account.earned === '720.00' && account.owed === '720.00' && account.commissions.length === 1 && account.commissions[0].lotId === lot1.id && account.commissions[0].acceptedKg === '480.000' && account.commissions[0].ratePerKg === '1.50',
      JSON.stringify({ earned: account.earned, c: account.commissions[0] }),
    );
    const accrual = (
      await db.query(
        `SELECT l.account_code, l.party_type, l.debit::text, l.credit::text FROM money.ledger_line l JOIN money.ledger_entry e ON e.id = l.entry_id
          WHERE e.entry_type = 'agent_commission_accrued' AND e.source_id = (SELECT id FROM money.agent_commission WHERE lot_id = $1) ORDER BY l.debit DESC`,
        [lot1.id],
      )
    ).rows;
    check(
      'F4: Dr Agent commission / Cr Accounts payable — agents, the agent as party (AGT.2)',
      accrual.length === 2 && accrual[0].account_code === 'agent_commission' && accrual[0].debit === '720.00' && accrual[1].account_code === 'accounts_payable_agent' && accrual[1].party_type === 'agent' && accrual[1].credit === '720.00',
      JSON.stringify(accrual),
    );
    await buy(400, 400); // no agent: no commission (and stock for the sales below)
    check('F4: a purchase with no agent earns none', (await owner.get(`/finance/agents/${agent.id}`)).earned === '720.00');
    const tooMuch = await accountant.raw('POST', `/finance/agents/${agent.id}/payments`, { amount: 720.01, method: 'bank_transfer' });
    check('F4: paying an agent more than is owed is refused', tooMuch.status === 409, String(tooMuch.status));
    const paid = await accountant.post(`/finance/agents/${agent.id}/payments`, { amount: 720, method: 'bank_transfer', reference: `UTR${s}`, tdsSectionCode: '194H' });
    check('F4: paid under 194H — 2% withheld with a PAN, ₹705.60 reaches the agent', paid.tdsSection === '194H' && paid.tdsAmount === '14.40' && paid.netPaid === '705.60', JSON.stringify(paid));
    account = await owner.get(`/finance/agents/${agent.id}`);
    check('F4: …and nothing more is owed', account.owed === '0.00' && account.settled === '720.00', account.owed);
    const [y, m] = today.split('-').map(Number);
    const fy = m >= 4 ? `${y}-${String((y + 1) % 100).padStart(2, '0')}` : `${y - 1}-${String(y % 100).padStart(2, '0')}`;
    const quarter = m >= 4 && m <= 6 ? 1 : m <= 9 && m >= 7 ? 2 : m >= 10 ? 3 : 4;
    const register = await owner.get(`/tax/tds/register?fy=${fy}&quarter=${quarter}`);
    const d194h = register.deductions.find((d) => d.sectionCode === '194H' && d.payeeName === agent.name);
    check('F4: the deduction is in the TDS register under 194H, against the PAN', d194h?.tdsAmount === '14.40' && d194h?.payeePan === 'ABCPR1234K' && d194h?.sourceType === 'agent_payment', JSON.stringify(d194h));

    // ---- F5 / F6: the finance charge switch, terms as versions, 18% cost of capital ----
    let h = await owner.get(`/customers/${hotel.id}`);
    check('F5: a new customer’s finance charge is off', h.financeChargeEnabled === false, String(h.financeChargeEnabled));
    const noRate = await owner.raw('POST', `/customers/${hotel.id}/credit-terms`, { version: h.version, financeChargeEnabled: true });
    check('F5: it can’t be switched on without a rate', noRate.status === 400, String(noRate.status));
    h = await owner.post(`/customers/${hotel.id}/credit-terms`, { version: h.version, financeChargeRateAnnual: 18.25, financeChargeGraceDays: 0 });
    check('F5: a rate alone doesn’t switch it on', h.financeChargeEnabled === false && h.financeChargeRateAnnual === '18.25');
    h = await owner.post(`/customers/${hotel.id}/credit-terms`, { version: h.version, financeChargeEnabled: true });
    const history = await owner.get(`/customers/${hotel.id}/terms-history`);
    check(
      'F6: every change is a dated version, newest first (created, rate set, switched on)',
      history.length === 3 && history.map((v) => v.source).join(',') === 'terms,terms,created' && history[0].financeChargeEnabled === true && history[1].financeChargeEnabled === false && history[1].financeChargeRateAnnual === '18.25' && history[2].financeChargeRateAnnual === '0.00' && history.every((v) => v.changedBy),
      JSON.stringify(history.map((v) => [v.version, v.source, v.financeChargeEnabled, v.financeChargeRateAnnual])),
    );
    const settings = await owner.get('/ai/settings');
    check('F5: the internal cost of capital defaults to 18% a year (MS §31)', settings.costOfCapitalPct === '18.00', settings.costOfCapitalPct);

    // ---- Sales: taxed invoices issued by the owner ----
    const sell = async (customer, kg) => {
      const order = await owner.post('/orders', { customerId: customer.id, lines: [{ productId: onion.id, quantity: kg, unitPrice: 50 }] });
      const o = await owner.post(`/orders/${order.id}/confirm`, { version: order.version });
      let trip = await owner.post('/logistics/trips', { vehicleId: vehicle.id, driverEmployeeId: driver.id, advanceAmount: 0 });
      await owner.post(`/logistics/trips/${trip.id}/publish`, { version: trip.version });
      const stop = await owner.post(`/logistics/trips/${trip.id}/stops/delivery`, { orderId: o.id });
      trip = await owner.post(`/logistics/trips/${trip.id}/start`, { version: trip.version });
      await owner.post(`/logistics/trips/${trip.id}/stops/${stop.id}/complete-delivery`, { recipientName: 'Manager', signatureData: 'data:image/png;base64,iVBORw0KGgo=' });
      return (await owner.get(`/finance/invoices?customerId=${customer.id}&kind=sale`)).items.find((i) => i.orderId === o.id);
    };
    const inv1 = await sell(hotel, 400);
    check('sale: 400 kg × ₹50 + 5% GST = ₹21,000, issued by the owner', inv1.amount === '21000.00' && inv1.credited === '0.00' && inv1.writtenOff === '0.00', `${inv1.amount} ${inv1.createdBy}`);

    // ---- F1: credit notes ----
    const own = await owner.raw('POST', '/finance/credit-notes', { invoiceId: inv1.id, amount: 1050, reason: 'Six bags damp on arrival' });
    check('F1/CN.4: the invoice’s issuer can’t approve a credit note against it', own.status === 403, `${own.status} ${own.body?.error?.message}`);
    const cn1 = await accountant.post('/finance/credit-notes', { invoiceId: inv1.id, amount: 1050, reason: 'Six bags damp on arrival' });
    check('F1/CN.1: someone else issues it — CN-…, ₹1,000 value + ₹25 CGST + ₹25 SGST', /^CN-\d{6}$/.test(cn1.creditNoteNumber) && cn1.taxableValue === '1000.00' && cn1.cgst === '25.00' && cn1.sgst === '25.00' && cn1.amount === '1050.00', JSON.stringify(cn1));
    const after1 = await owner.get(`/finance/invoices/${inv1.id}`);
    check('F1: the invoice is untouched; what’s owed comes down', after1.amount === '21000.00' && after1.credited === '1050.00' && after1.outstanding === '19950.00', `${after1.amount} ${after1.credited} ${after1.outstanding}`);
    const over = await accountant.raw('POST', '/finance/credit-notes', { invoiceId: inv1.id, amount: 19950.01, reason: 'Too much' });
    check('F1: never more than is outstanding', over.status === 409, String(over.status));
    const cnLines = (
      await db.query(
        `SELECT l.account_code, l.debit::text, l.credit::text FROM money.ledger_line l JOIN money.ledger_entry e ON e.id = l.entry_id
          WHERE e.entry_type = 'credit_note_issued' AND e.source_id = $1 ORDER BY l.account_code`,
        [cn1.id],
      )
    ).rows.map((r) => `${r.account_code}:${r.debit}/${r.credit}`);
    check(
      'F1/CN.2: Dr Sales returns ₹1,000 + output GST ₹50, Cr receivable ₹1,050',
      cnLines.join(' ') === 'accounts_receivable:0.00/1050.00 output_cgst:25.00/0.00 output_sgst:25.00/0.00 sales_returns:1000.00/0.00',
      cnLines.join(' '),
    );

    // ---- F2: a dispute partly accepted; the rejected part's paused charge caught up once ----
    const inv2 = await sell(hotel, 200);
    await db.query(`UPDATE money.invoice SET due_date = $2::date - 20, issued_at = issued_at - interval '27 days' WHERE id = $1`, [inv2.id, today]);
    const d1 = await owner.post('/finance/disputes', { invoiceId: inv2.id, amount: 4200, reason: 'Moisture above the agreed 8%' });
    let run = await owner.post('/finance/finance-charges/run', { asOf: today });
    const c2 = run.charges.find((c) => c.sourceInvoiceId === inv2.id);
    check('F2: while disputed, the charge leaves the disputed ₹4,200 out — (10,500 − 4,200) × 18.25% × 20 ÷ 365', c2?.principal === '6300.00' && c2?.amount === '63.00' && c2?.disputeId === null, JSON.stringify(c2));
    const pauses = (await db.query('SELECT amount::text FROM money.finance_charge_pause WHERE dispute_id = $1', [d1.id])).rows;
    check('F2: …and records what it left out', pauses.length === 1 && pauses[0].amount === '4200.00', JSON.stringify(pauses));
    const closed = await accountant.post(`/finance/disputes/${d1.id}/close`, { version: d1.version, outcome: 'resolved', resolution: 'A quarter of the claim accepted', acceptedAmount: 1050 });
    check(
      'F2: closed with ₹1,050 accepted (its credit note) and ₹3,150 not',
      closed.status === 'resolved' && closed.acceptedAmount === '1050.00' && closed.rejectedAmount === '3150.00' && /^CN-\d{6}$/.test(closed.creditNoteNumber ?? ''),
      JSON.stringify({ a: closed.acceptedAmount, r: closed.rejectedAmount, cn: closed.creditNoteNumber }),
    );
    check('F2: the accepted part stops for good — the invoice owes ₹9,450', (await owner.get(`/finance/invoices/${inv2.id}`)).outstanding === '9450.00');
    run = await owner.post('/finance/finance-charges/run', { asOf: today });
    const catchUp = run.charges.find((c) => c.disputeId === d1.id);
    check(
      'F2: the next run charges the rejected ₹3,150 for the 20 paused days, once — 3,150 × 18.25% × 20 ÷ 365',
      run.charged === 1 && catchUp?.principal === '3150.00' && catchUp?.days === 20 && catchUp?.amount === '31.50' && catchUp?.sourceInvoiceId === inv2.id,
      JSON.stringify(run.charges.map((c) => [c.principal, c.days, c.amount, c.disputeId])),
    );
    check('F2: …and never again', (await owner.post('/finance/finance-charges/run', { asOf: today })).charged === 0);

    // A dispute left 30 days without action stops pausing and is caught up from the dispute date.
    const inv3 = await sell(hotel, 100);
    await db.query(`UPDATE money.invoice SET due_date = $2::date - 40, issued_at = issued_at - interval '47 days' WHERE id = $1`, [inv3.id, today]);
    const d3 = await owner.post('/finance/disputes', { invoiceId: inv3.id, amount: 2000, reason: 'Short weight claimed' });
    run = await owner.post('/finance/finance-charges/run', { asOf: addDays(today, -10) });
    const c3 = run.charges.find((c) => c.sourceInvoiceId === inv3.id);
    check('F2: paused on the ₹2,000 disputed — (5,250 − 2,000) × 18.25% × 30 ÷ 365', c3?.principal === '3250.00' && c3?.amount === '48.75', JSON.stringify(c3));
    await db.query(`UPDATE money.invoice_dispute SET last_activity_at = now() - interval '31 days' WHERE id = $1`, [d3.id]);
    run = await owner.post('/finance/finance-charges/run', { asOf: today });
    const regular3 = run.charges.find((c) => c.sourceInvoiceId === inv3.id && c.disputeId === null);
    const stale3 = run.charges.find((c) => c.disputeId === d3.id);
    check('F2/MS §32: no action for 30 days — the charge runs on the whole amount again (5,250 × 18.25% × 10 ÷ 365)', regular3?.principal === '5250.00' && regular3?.amount === '26.25', JSON.stringify(regular3));
    check('F2/MS §32: …and catches up the paused days from the dispute date (2,000 × 18.25% × 30 ÷ 365)', stale3?.principal === '2000.00' && stale3?.days === 30 && stale3?.amount === '30.00', JSON.stringify(stale3));
    await owner.get('/alerts/unread-count');
    const staleAlert = (await owner.get('/alerts?unread=true')).find((a) => a.kind === 'dispute_stale' && a.title.includes(hotel.name));
    check('F2: …with a critical exception for the owner', staleAlert?.severity === 'critical', staleAlert?.title);

    // The owner issued inv1, so their accepting part of a dispute on it is refused; withdrawing accepts nothing.
    const d2 = await owner.post('/finance/disputes', { invoiceId: inv1.id, amount: 500, reason: 'Two bags short' });
    const ownAccept = await owner.raw('POST', `/finance/disputes/${d2.id}/close`, { version: d2.version, outcome: 'resolved', resolution: 'Accepted', acceptedAmount: 100 });
    check('F2/CN.4: accepting part of a dispute is a credit note — refused to the invoice’s issuer', ownAccept.status === 403, String(ownAccept.status));
    const blockedWo = await accountant.raw('POST', `/finance/invoices/${inv1.id}/write-off`, { reason: 'Gone' });
    check('F3: nothing is written off while a dispute on it is open', blockedWo.status === 409, String(blockedWo.status));
    const withdrawnAccept = await owner.raw('POST', `/finance/disputes/${d2.id}/close`, { version: d2.version, outcome: 'withdrawn', resolution: 'Found the bags', acceptedAmount: 50 });
    check('F2: a withdrawn dispute accepts nothing', withdrawnAccept.status === 400, String(withdrawnAccept.status));
    const withdrawn = await owner.post(`/finance/disputes/${d2.id}/close`, { version: d2.version, outcome: 'withdrawn', resolution: 'Found the bags' });
    check('F2: …withdrawn: nothing accepted, the whole ₹500 owed', withdrawn.acceptedAmount === '0.00' && withdrawn.rejectedAmount === '500.00' && withdrawn.creditNoteId === null);

    // ---- F3: a bad debt written off ----
    const inv4 = await sell(shop, 50);
    const opsWo = await ops.raw('POST', `/finance/invoices/${inv4.id}/write-off`, { reason: 'Gone' });
    check('F3/BD.2: only the owner or a finance lead writes off', opsWo.status === 403, String(opsWo.status));
    const wo = await accountant.post(`/finance/invoices/${inv4.id}/write-off`, { reason: 'Shop closed; owner unreachable' });
    check('F3: the whole ₹2,625 still owed is written off', wo.amount === '2625.00' && wo.invoiceNumber === inv4.invoiceNumber, JSON.stringify(wo));
    const inv4After = await owner.get(`/finance/invoices/${inv4.id}`);
    check('F3: the invoice stands; nothing is owed on it', inv4After.amount === '2625.00' && inv4After.writtenOff === '2625.00' && inv4After.outstanding === '0.00', `${inv4After.writtenOff} ${inv4After.outstanding}`);
    const woEntries = (
      await db.query(
        `SELECT e.entry_type, l.account_code, l.debit::text, l.credit::text FROM money.ledger_line l JOIN money.ledger_entry e ON e.id = l.entry_id
          WHERE e.source_id = $1 ORDER BY e.entry_type, l.debit DESC`,
        [wo.id],
      )
    ).rows.map((r) => `${r.entry_type}:${r.account_code}:${r.debit}/${r.credit}`);
    check(
      'F3/BD.1–BD.2: provided for (Dr Bad debts / Cr Allowance), then written off against it (Dr Allowance / Cr receivable)',
      woEntries.join(' ') ===
        'bad_debt_provisioned:bad_debt_expense:2625.00/0.00 bad_debt_provisioned:allowance_doubtful_accounts:0.00/2625.00 receivable_written_off:allowance_doubtful_accounts:2625.00/0.00 receivable_written_off:accounts_receivable:0.00/2625.00',
      woEntries.join(' '),
    );
    const shopNow = await owner.get(`/customers/${shop.id}`);
    check('F3/BD.4: the customer goes on credit hold for a review of their terms', shopNow.creditHold && /Bad debt written off/.test(shopNow.creditHoldReason ?? ''), shopNow.creditHoldReason);
    check('F3/F6: …a dated version of their terms', (await owner.get(`/customers/${shop.id}/terms-history`))[0]?.source === 'write_off');
    const again = await accountant.raw('POST', `/finance/invoices/${inv4.id}/write-off`, { reason: 'Again' });
    check('F3: never twice', again.status === 409, String(again.status));
    const heldOrder = await owner.post('/orders', { customerId: shop.id, lines: [{ productId: onion.id, quantity: 5, unitPrice: 50 }] });
    const heldConfirm = await owner.raw('POST', `/orders/${heldOrder.id}/confirm`, { version: heldOrder.version });
    check('F3/BD.4: no more credit-term orders confirm until the terms are reviewed', heldConfirm.status === 409 && /credit hold/.test(heldConfirm.body?.error?.message ?? ''), heldConfirm.body?.error?.message);

    // ---- F8: customer Bill-to-Bill ----
    let r = await owner.get(`/customers/${regular.id}`);
    const noBackstop = await owner.raw('POST', `/customers/${regular.id}/credit-terms`, { version: r.version, billToBill: true });
    check('F8: Bill-to-Bill needs the longest a bill may wait', noBackstop.status === 400, String(noBackstop.status));
    r = await owner.post(`/customers/${regular.id}/credit-terms`, { version: r.version, billToBill: true, paymentTermsDays: 15 });
    const b1 = await sell(regular, 10);
    check('F8: a Bill-to-Bill invoice waits for the next bill, at most 15 days', b1.billToBill === true && b1.dueDate === addDays(today, 15), `${b1.billToBill} ${b1.dueDate}`);
    await sell(regular, 12);
    const b1Now = await owner.get(`/finance/invoices/${b1.id}`);
    check('F8/MS §30: the next bill issued, the previous one falls due that day', b1Now.dueDate === today, b1Now.dueDate);
    const statement = await owner.get(`/finance/customers/${regular.id}/statement?days=30`);
    const dueWords = new Date(`${today}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
    const b1Line = statement.lines.find((l) => l.reference === b1.invoiceNumber);
    check('F8: the customer’s statement says so too — due today, not at the backstop', b1Line?.description === `Invoice, due ${dueWords}`, b1Line?.description);

    // ---- F7: farmer payment terms ----
    let f = await owner.get(`/farmers/${farmer.id}`);
    check('F7: a farmer is paid immediately unless terms say otherwise', f.paymentTerms === 'immediate' && f.paymentTermsDays === null);
    const net12 = await owner.raw('PATCH', `/farmers/${farmer.id}`, { version: f.version, paymentTerms: 'net', paymentTermsDays: 12 });
    check('F7: Net is 3/7/10/15/20/30/45/60 — 12 days is Custom', net12.status === 400 && /Custom/.test(net12.body?.error?.message ?? ''), net12.body?.error?.message);
    f = await owner.patch(`/farmers/${farmer.id}`, { version: f.version, paymentTerms: 'net', paymentTermsDays: 7 });
    const netLot = await buy(50, 50);
    const dueOf = async (lotId) => (await db.query(`SELECT due_date::text AS d FROM money.farmer_payable_balance WHERE lot_id = $1`, [lotId])).rows[0]?.d;
    check('F7: on Net 7, a lot graded today falls due in 7 days', (await dueOf(netLot.id)) === addDays(today, 7), await dueOf(netLot.id));
    check('F7: a lot graded under the earlier terms keeps its due date (today)', (await dueOf(lot1.id)) === today, await dueOf(lot1.id));
    f = await owner.patch(`/farmers/${farmer.id}`, { version: f.version, paymentTerms: 'bill_to_bill', paymentTermsDays: 30 });
    const b2bLot = await buy(40, 40);
    check('F7: on Bill-to-Bill, a lot waits for the next pickup, at most 30 days', (await dueOf(b2bLot.id)) === addDays(today, 30), await dueOf(b2bLot.id));
    await buy(30, 30);
    check('F7: …the next lot graded, the previous one falls due that day', (await dueOf(b2bLot.id)) === today, await dueOf(b2bLot.id));
    // Pay the first lot in full; make the Net lot three days overdue.
    const lot1Owed = (await db.query('SELECT outstanding::text AS o FROM money.farmer_payable_balance WHERE lot_id = $1', [lot1.id])).rows[0].o;
    await accountant.post('/finance/farmer-payments', { farmerId: farmer.id, amount: Number(lot1Owed), method: 'bank_transfer', allocations: [{ lotId: lot1.id, amount: Number(lot1Owed) }] });
    await db.query(`UPDATE money.farmer_payable SET due_date = $2::date - 3 WHERE lot_id = $1`, [netLot.id, today]);
    const netOwed = (await db.query('SELECT outstanding::text AS o FROM money.farmer_payable_balance WHERE lot_id = $1', [netLot.id])).rows[0].o;
    const profile = await owner.get(`/farmers/${farmer.id}/profile`);
    check('F7: the farmer profile shows what’s overdue by its terms', profile.money.overdue === netOwed, `${profile.money.overdue} vs ${netOwed}`);
    check('F7: …and the average days to pay (the lots paid in full)', profile.money.avgPaymentDays !== null && Number(profile.money.avgPaymentDays) >= 0, String(profile.money.avgPaymentDays));

    // ---- GST: the credit notes in GSTR-1 and GSTR-3B ----
    const from = `${today.slice(0, 8)}01`;
    const g1 = await owner.get(`/tax/gstr1?from=${from}&to=${today}`);
    const note1 = g1.cdnr.find((n) => n.noteNumber === cn1.creditNoteNumber);
    check(
      'GST: GSTR-1 reports the credit note to the registered buyer (table 9B, CDNR), against its invoice, at 5%',
      note1?.invoiceNumber === inv1.invoiceNumber && note1.rates.length === 1 && note1.rates[0].rate === '5.00' && note1.rates[0].taxableValue === '1000.00' && note1.rates[0].cgst === '25.00',
      JSON.stringify(note1),
    );
    check('GST: …and counts the credit notes issued (table 13)', g1.creditNotes.issued >= 2, JSON.stringify(g1.creditNotes));
    const g3 = await owner.get(`/tax/gstr3b?from=${from}&to=${today}`);
    const sold = (await db.query(
      `SELECT COALESCE(SUM(lt.cgst), 0)::numeric(14,2)::text AS cgst FROM tax.invoice_line_tax lt JOIN money.invoice i ON i.id = lt.invoice_id
        WHERE lt.taxability = 'taxable' AND (i.issued_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date`,
      [from, today],
    )).rows[0].cgst;
    const credited = (await db.query(
      `SELECT COALESCE(SUM(nl.cgst), 0)::numeric(14,2)::text AS cgst FROM money.credit_note_line nl JOIN money.credit_note n ON n.id = nl.credit_note_id
        WHERE (n.issued_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date`,
      [from, today],
    )).rows[0].cgst;
    check('GST: GSTR-3B’s CGST payable is what was invoiced less what was credited', Number(g3.taxPayable.cgst).toFixed(2) === (Number(sold) - Number(credited)).toFixed(2), `${g3.taxPayable.cgst} = ${sold} − ${credited}`);

    // ---- The books ----
    const unbalanced = await db.query(`SELECT e.id FROM money.ledger_entry e JOIN money.ledger_line l ON l.entry_id = e.id GROUP BY e.id HAVING SUM(l.debit) <> SUM(l.credit)`);
    check('every ledger entry balances', unbalanced.rowCount === 0, String(unbalanced.rowCount));
    const tb = await owner.get('/finance/ledger/trial-balance');
    check('the trial balance is even', tb.balanced === true, JSON.stringify(tb.totals));
    check(
      'every control account agrees with its sub-ledger (receivables, farmer payables and advances, agents)',
      tb.checks.length === 4 && tb.checks.every((c) => c.agrees),
      JSON.stringify(tb.checks.map((c) => [c.name, c.ledger, c.subledger])),
    );
    const allowance = tb.rows.find((x) => x.account === 'allowance_doubtful_accounts');
    check('F3: the allowance is used up by the write-off (nets to nothing)', allowance && Number(allowance.balance) === 0, allowance?.balance);

    // ---- The owner app ----
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
      await page.goto(`${BASE}/login`);
      await page.fill('#login', 'owner@dev.morbeez.local');
      await page.fill('#password', PASSWORD);
      await page.click('button[type=submit]');
      await page.waitForURL((u) => !/\/login/.test(u.toString()));

      await page.goto(`${BASE}/finance#adjustments`);
      await page.locator('table[aria-label="Credit notes"]', { hasText: cn1.creditNoteNumber }).waitFor();
      const adj = (await page.locator('main').textContent()).replace(/\s+/g, ' ');
      check('UI: Credit notes & write-offs lists the notes and the bad debt', adj.includes(cn1.creditNoteNumber) && adj.includes(closed.creditNoteNumber) && adj.includes(inv4.invoiceNumber), adj.slice(0, 200));
      if (shots) await page.screenshot({ path: path.join(shots, 'p6-credit-notes.png'), fullPage: true });

      await page.getByRole('button', { name: 'Issue a credit note' }).click();
      await page.getByRole('dialog').getByLabel('Customer').selectOption(hotel.id);
      await page.getByRole('dialog').getByLabel('Invoice').selectOption(inv1.id);
      const hint = await page.getByRole('dialog').locator('.field-hint').first().textContent();
      check('UI: the issuer of the invoice is told someone else must approve its credit note', /someone else has to approve/.test(hint ?? ''), hint);
      if (shots) await page.screenshot({ path: path.join(shots, 'p6-credit-note-cn4.png') });
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

      await page.goto(`${BASE}/finance#agents`);
      await page.getByRole('button', { name: agent.name }).click();
      await page.locator('table[aria-label="Commission earned"]', { hasText: '480' }).waitFor();
      const ag = (await page.locator('main').textContent()).replace(/\s+/g, ' ');
      check('UI: Agent commission shows earned, paid, owed and each lot × rate', /PAN ABCPR1234K/.test(ag) && /194H/.test(ag), ag.slice(0, 200));
      if (shots) await page.screenshot({ path: path.join(shots, 'p6-agent-commission.png'), fullPage: true });

      await page.goto(`${BASE}/finance#disputes`);
      await page.getByRole('button', { name: 'Resolved' }).click();
      await page.getByText('Accepted').first().waitFor();
      const disp = (await page.locator('main').textContent()).replace(/\s+/g, ' ');
      check('UI: a resolved dispute shows what was accepted (its credit note) and what is still owed', disp.includes(closed.creditNoteNumber) && /owed/.test(disp), disp.slice(0, 200));
      if (shots) await page.screenshot({ path: path.join(shots, 'p6-dispute-settled.png'), fullPage: true });

      await page.goto(`${BASE}/customers?open=${hotel.id}`);
      await page.getByRole('button', { name: 'Credit', exact: true }).click();
      await page.getByRole('heading', { name: 'Terms history' }).waitFor();
      const credit = (await page.locator('.detail').textContent()).replace(/\s+/g, ' ');
      check('UI: the Credit tab lists every version of the terms', /Terms history/.test(credit) && /Customer added/.test(credit) && /18\.25% a year/.test(credit), credit.slice(0, 240));
      if (shots) await page.screenshot({ path: path.join(shots, 'p6-terms-history.png'), fullPage: true });

      await page.goto(`${BASE}/farmers?open=${farmer.id}`);
      await page.locator('.detail', { hasText: 'Payment terms' }).waitFor();
      await page.getByRole('button', { name: 'Payments', exact: true }).click();
      await page.locator('.detail', { hasText: 'Overdue' }).waitFor();
      const farm = (await page.locator('.detail').textContent()).replace(/\s+/g, ' ');
      check('UI: the farmer shows their terms, what’s overdue and the average days to pay', /Overdue/.test(farm) && /Avg\. Payment Days/.test(farm), farm.slice(0, 240));
      if (shots) await page.screenshot({ path: path.join(shots, 'p6-farmer-terms.png'), fullPage: true });
    } finally {
      await browser.close();
    }
  } finally {
    await db.end();
  }
  console.log(results.join('\n'));
  console.log(`\n${results.filter((x) => x.startsWith('PASS')).length}/${results.length} passed`);
  if (results.some((x) => x.startsWith('FAIL'))) process.exit(1);
})().catch((e) => {
  console.log(results.join('\n'));
  console.error('FAILED:', e.message);
  process.exit(1);
});
