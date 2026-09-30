// India tax layer through the real HTTP API, after owner-modules-e2e (and
// accounting-e2e) have run. Configures GST and TDS, then buys, grades,
// sells, delivers, files and registers — checking every figure exactly.
const { API, PASSWORD } = require('../lib/env');
const results = [];
const check = (name, ok, detail = '') => {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`;
  results.push(line);
  console.log(line);
};

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function gstin(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return first14 + CHARS[(36 - (sum % 36)) % 36];
}

async function login(email) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return (await r.json()).accessToken;
}
function as(token) {
  const call = async (method, path, body) => {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: r.status, body: json };
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), put: (p, b) => call('PUT', p, b) };
}
const must = (r, what) => {
  if (r.status >= 300) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

(async () => {
  const owner = as(await login('owner@dev.morbeez.local'));
  const accountant = as(await login('accountant@dev.morbeez.local'));
  const today = must(await owner.get('/accounting/periods'), 'periods').today;
  const byName = async (path, name) => must(await owner.get(`${path}?pageSize=100`), path).items.find((x) => (x.name ?? x.registrationNumber) === name);
  const tomato = await byName('/products', 'Tomato');
  const onion = await byName('/products', 'Onion');
  const hotel = await byName('/customers', 'Hotel Sagar');
  const green = await byName('/customers', 'Green Leaf Restaurant');
  const ramesh = await byName('/farmers', 'Ramesh Patil');
  const lakshmi = await byName('/farmers', 'Lakshmi Devi');
  const vehicle = (await owner.get('/vehicles?pageSize=100')).body.items[0];
  const driver = (await owner.get('/workforce?pageSize=100')).body.items.find((e) => e.roleType === 'driver');

  // ---- Configuration ----
  const bad = await owner.put('/tax/profile', { version: 0, registrationType: 'regular', gstin: '27AAPFU0939F1ZX', hsnMinDigits: 6, b2clThreshold: 100000, einvoiceEnabled: true });
  check('profile: a GSTIN typo is caught by its check character', bad.status === 400 && /check character/.test(bad.body.error.message), bad.body.error?.message);

  const rule194q = must(
    await owner.post('/tax/tds-sections', {
      code: '194Q',
      description: 'Purchase of goods (test threshold)',
      rateIndividual: 1,
      rateOther: 1,
      rateNoPan: 5,
      annualThreshold: 3000,
      basis: 'excess_over_annual',
      effectiveFrom: '2026-04-01',
    }),
    'tds rule',
  );
  check('TDS: tenant rule overrides the default 194Q', rule194q.source === 'tenant' && rule194q.inForce, `${rule194q.rateIndividual}% over ${rule194q.annualThreshold}`);

  const profile = must(
    await owner.put('/tax/profile', {
      version: 0,
      registrationType: 'regular',
      gstin: '27aapfu0939f1zv',
      legalName: 'Dev Wholesaler Co.',
      addressLine1: 'Shop 12, APMC Market',
      city: 'Navi Mumbai',
      pincode: '400703',
      hsnMinDigits: 6,
      b2clThreshold: 100000,
      einvoiceEnabled: true,
      einvoiceReportWithinDays: 30,
      farmerTdsSection: '194Q',
    }),
    'profile',
  );
  check('profile: saved; state and PAN taken from the GSTIN', profile.stateCode === '27' && profile.pan === 'AAPFU0939F' && profile.version === 1, `${profile.gstin} ${profile.stateCode} ${profile.pan}`);
  const stale = await owner.put('/tax/profile', { version: 0, registrationType: 'unregistered', hsnMinDigits: 4, b2clThreshold: 1, einvoiceEnabled: false });
  check('profile: a stale save is refused', stale.status === 409);

  const dried = must(
    await owner.post('/tax/gst-rates', { hsnCode: '0712', description: 'Dried vegetables', supplyKind: 'goods', taxability: 'taxable', rate: 5, effectiveFrom: '2017-07-01' }),
    'gst rate',
  );
  check('GST: tenant rule for 0712 at 5%', dried.source === 'tenant' && dried.inForce);
  const zeroTaxable = await owner.post('/tax/gst-rates', { hsnCode: '0713', description: 'x y z', supplyKind: 'goods', taxability: 'taxable', rate: 0, effectiveFrom: '2026-04-01' });
  check('GST: a taxable rule at 0% is refused', zeroTaxable.status === 400, zeroTaxable.body.error?.message);

  must(await owner.put(`/tax/products/${tomato.id}`, { hsnCode: '07020000' }), 'tomato hsn');
  must(await owner.put(`/tax/products/${onion.id}`, { hsnCode: '07122000' }), 'onion hsn');
  const products = must(await owner.get('/tax/products'), 'products');
  const pt = (id) => products.find((p) => p.productId === id);
  check(
    'HSN: tomato resolves to the exempt default, onion to the tenant 5% rule (longest prefix)',
    pt(tomato.id).rule?.taxability === 'exempt' && pt(onion.id).rule?.rate === '5.00' && pt(onion.id).uqc === 'KGS',
    `${pt(tomato.id).rule?.hsnCode}/${pt(tomato.id).rule?.taxability}, ${pt(onion.id).rule?.hsnCode}/${pt(onion.id).rule?.rate}`,
  );

  const hotelGstin = gstin('27AABCH1234A1Z');
  must(await owner.put(`/tax/customers/${hotel.id}`, { gstin: hotelGstin, legalName: 'Hotel Sagar Pvt Ltd', addressLine1: 'Sector 17', city: 'Vashi', pincode: '400703' }), 'hotel tax');
  must(await owner.put(`/tax/customers/${green.id}`, { stateCode: '29', city: 'Bengaluru' }), 'green tax');
  must(await owner.put(`/tax/farmers/${ramesh.id}`, { pan: 'abcpe1234f', tdsExempt: false }), 'ramesh pan');
  const badPan = await owner.put(`/tax/farmers/${lakshmi.id}`, { pan: 'ABC123', tdsExempt: false });
  check('farmer: a malformed PAN is refused', badPan.status === 400);

  // ---- Buy and grade: TDS ----
  const buy = async (farmer, lines) => {
    const po = must(await owner.post('/procurement/purchase-orders', { farmerId: farmer.id, lines }), 'po');
    const confirmed = must(await owner.post(`/procurement/purchase-orders/${po.id}/confirm`, { version: po.version }), 'po confirm');
    must(await owner.post(`/procurement/purchase-orders/${po.id}/receive-goods`, { lines: lines.map((l) => ({ productId: l.productId, receivedQuantity: l.expectedQuantity })) }), 'receive');
    const lots = must(await owner.get(`/procurement/purchase-orders/${po.id}/lots`), 'lots');
    for (const l of lines) {
      const lot = lots.find((x) => x.productId === l.productId);
      must(await owner.post(`/procurement/lots/${lot.id}/grade`, { version: lot.version, acceptedQuantity: l.expectedQuantity, rejectedQuantity: 0, unitCost: l.indicativePrice }), 'grade');
    }
    return confirmed;
  };
  await buy(ramesh, [
    { productId: tomato.id, expectedQuantity: 20, indicativePrice: 20 },
    { productId: onion.id, expectedQuantity: 20, indicativePrice: 50 },
  ]);
  await buy(lakshmi, [{ productId: onion.id, expectedQuantity: 10, indicativePrice: 50 }]);

  const fy = `${today.slice(0, 4) - (today.slice(5, 7) < '04' ? 1 : 0)}-${String((Number(today.slice(0, 4)) - (today.slice(5, 7) < '04' ? 1 : 0) + 1) % 100).padStart(2, '0')}`;
  const quarter = [4, 4, 4, 1, 1, 1, 2, 2, 2, 3, 3, 3][Number(today.slice(5, 7)) - 1];
  let reg = must(await owner.get(`/tax/tds/register?fy=${fy}&quarter=${quarter}`), 'register');
  const amounts = reg.deductions.map((d) => d.tdsAmount).sort();
  // Ramesh had 2,800 before; tomato lot 400 → 200 above 3,000 → 2.00; onion lot 1,000 all above → 10.00. Lakshmi below → none.
  check('TDS: only the excess over the annual limit, at 1%, per lot', JSON.stringify(amounts) === JSON.stringify(['10.00', '2.00']), JSON.stringify(reg.deductions.map((d) => [d.payeeName, d.baseAmount, d.tdsAmount])));
  check('TDS: deducted under the PAN as an individual', reg.deductions.every((d) => d.payeePan === 'ABCPE1234F' && d.deducteeType === 'individual_huf'));

  const lots = must(await owner.get(`/finance/payables/${ramesh.id}/lots`), 'payable lots');
  const owedNet = lots.filter((l) => Number(l.outstanding) > 0).map((l) => l.outstanding).sort();
  check('payables: the farmer is owed net of TDS', JSON.stringify(owedNet) === JSON.stringify(['398.00', '990.00']), JSON.stringify(owedNet));
  const fin = must(await owner.get('/finance/ledger/trial-balance'), 'finance tb');
  check('ledger: AP control account still agrees with its sub-ledger', fin.balanced && fin.checks.every((c) => c.agrees), fin.checks.map((c) => `${c.name} ${c.ledger}/${c.subledger}`).join('; '));

  // ---- Sell and deliver: GST ----
  const order = async (customer, lines) => {
    const o = must(await owner.post('/orders', { customerId: customer.id, lines }), 'order');
    return must(await owner.post(`/orders/${o.id}/confirm`, { version: o.version }), 'order confirm');
  };
  const oHotel = await order(hotel, [
    { productId: tomato.id, quantity: 10, unitPrice: 32 },
    { productId: onion.id, quantity: 10, unitPrice: 28 },
  ]);
  const oGreen = await order(green, [{ productId: onion.id, quantity: 5, unitPrice: 28 }]);
  let trip = must(await owner.post('/logistics/trips', { vehicleId: vehicle.id, driverEmployeeId: driver.id }), 'trip');
  for (const o of [oHotel, oGreen]) must(await owner.post(`/logistics/trips/${trip.id}/stops/delivery`, { orderId: o.id }), 'stop');
  trip = must(await owner.post(`/logistics/trips/${trip.id}/start`, { version: trip.version }), 'start');
  for (const stop of must(await owner.get(`/logistics/trips/${trip.id}/stops`), 'stops')) {
    must(await owner.post(`/logistics/trips/${trip.id}/stops/${stop.id}/complete-delivery`, { recipientName: 'Manager', signatureData: 'data:image/png;base64,iVBORw0KGgo=' }), 'deliver');
  }
  must(await owner.post(`/logistics/trips/${trip.id}/complete`, { version: trip.version }), 'complete');

  const invoices = must(await owner.get(`/tax/invoices?from=${today}&to=${today}`), 'tax invoices');
  const hotelInv = invoices.find((i) => i.customerName === 'Hotel Sagar' && i.documentType === 'tax_invoice');
  const greenInv = invoices.find((i) => i.customerName === 'Green Leaf Restaurant');
  check(
    'GST intra-state B2B: exempt tomato + onion at 5% as CGST 2.5% + SGST 2.5%',
    hotelInv && hotelInv.taxableValue === '600.00' && hotelInv.cgst === '7.00' && hotelInv.sgst === '7.00' && hotelInv.igst === '0.00' && hotelInv.total === '614.00' && hotelInv.buyerGstin === hotelGstin,
    hotelInv && `${hotelInv.invoiceNumber} ${hotelInv.taxableValue} + ${hotelInv.cgst} + ${hotelInv.sgst} = ${hotelInv.total}`,
  );
  check(
    'GST inter-state B2C: IGST 5% to Karnataka',
    greenInv && greenInv.intraState === false && greenInv.placeOfSupply === '29' && greenInv.igst === '7.00' && greenInv.total === '147.00',
    greenInv && `${greenInv.invoiceNumber} pos ${greenInv.placeOfSupply} igst ${greenInv.igst}`,
  );
  const financeInv = must(await owner.get(`/finance/invoices/${hotelInv.invoiceId}`), 'finance invoice');
  check('receivable: the customer owes goods plus GST', financeInv.amount === '614.00' && financeInv.outstanding === '614.00');

  const accounts = must(await owner.get('/accounting/accounts'), 'accounts');
  const bal = (code) => accounts.find((a) => a.code === code)?.balance;
  check('ledger: output GST is a liability, not revenue', bal('output_cgst') === '7.00' && bal('output_sgst') === '7.00' && bal('output_igst') === '7.00', `CGST ${bal('output_cgst')}, SGST ${bal('output_sgst')}, IGST ${bal('output_igst')}`);
  check('ledger: TDS payable holds what was withheld', bal('tds_payable') === '12.00', bal('tds_payable'));
  const tb = must(await owner.get('/accounting/trial-balance'), 'tb');
  const bs = must(await owner.get('/accounting/balance-sheet'), 'bs');
  check('ledger: trial balance and balance sheet still balance', tb.balanced && bs.balanced);

  // ---- Returns ----
  const r1 = must(await owner.get(`/tax/gstr1?from=${today}&to=${today}`), 'gstr1');
  check('GSTR-1 B2B: the Hotel invoice at 5%', r1.b2b.length === 1 && r1.b2b[0].buyerGstin === hotelGstin && r1.b2b[0].rates[0].taxableValue === '280.00', JSON.stringify(r1.b2b[0]?.rates));
  check('GSTR-1 B2CS: inter-state to Karnataka at 5%', r1.b2cs.length === 1 && r1.b2cs[0].placeOfSupply === '29' && r1.b2cs[0].igst === '7.00');
  check('GSTR-1 nil table: exempt tomato to a registered buyer', r1.nil.find((n) => /Intra-state supplies to registered/.test(n.description)).exempt === '320.00');
  check('GSTR-1 HSN summary', r1.hsn.b2b.some((h) => h.hsnCode === '07122000' && h.quantity === '10.000') && r1.hsn.b2c.some((h) => h.hsnCode === '07122000' && h.igst === '7.00'));
  const r3b = must(await owner.get(`/tax/gstr3b?from=${today}&to=${today}`), 'gstr3b');
  check(
    'GSTR-3B: outward taxable and tax payable',
    r3b.outwardTaxable.taxableValue === '420.00' && r3b.taxPayable.cgst === '7.00' && r3b.taxPayable.igst === '7.00' && r3b.outwardNilExempt === '320.00',
    JSON.stringify(r3b.outwardTaxable),
  );

  // ---- E-invoice ----
  check('e-invoice: B2C invoice is not applicable', greenInv.einvoice.status === 'not_applicable', greenInv.einvoice.issues[0]);
  check('e-invoice: B2B invoice is ready', hotelInv.einvoice.status === 'ready' && hotelInv.einvoice.reportBy !== null, `${hotelInv.einvoice.status}, report by ${hotelInv.einvoice.reportBy}`);
  const json = must(await owner.get(`/tax/einvoices/${hotelInv.invoiceId}/json`), 'einvoice json');
  check(
    'e-invoice JSON: schema 1.1 with seller, buyer, items, values',
    json.Version === '1.1' && json.SellerDtls.Gstin === '27AAPFU0939F1ZV' && json.BuyerDtls.Gstin === hotelGstin && json.ItemList.length === 2 && json.ValDtls.TotInvVal === 614,
    `${json.DocDtls.No} ${json.DocDtls.Dt} items ${json.ItemList.map((i) => `${i.HsnCd}@${i.GstRt}`).join(',')}`,
  );
  const irn = 'a'.repeat(32) + 'b'.repeat(32);
  const byAccountant = await accountant.post(`/tax/einvoices/${hotelInv.invoiceId}/irn`, { irn, ackNo: '112010036563310', ackDate: new Date().toISOString() });
  check('e-invoice: accountant records the IRN', byAccountant.status === 204, `${byAccountant.status}`);
  const again = await accountant.post(`/tax/einvoices/${hotelInv.invoiceId}/irn`, { irn, ackNo: '1', ackDate: new Date().toISOString() });
  check('e-invoice: a second IRN is refused', again.status === 409);
  const cancelled = await accountant.post(`/tax/einvoices/${hotelInv.invoiceId}/cancel`, { reasonCode: '2', remark: 'Data entry mistake' });
  const after = must(await owner.get(`/tax/invoices?from=${today}&to=${today}`), 'after').find((i) => i.invoiceId === hotelInv.invoiceId);
  check('e-invoice: cancelled within 24 hours', cancelled.status === 204 && after.einvoice.status === 'cancelled');

  // ---- TDS on an expense, and deposits ----
  const rent = await accountant.post('/tax/tds/deductions', {
    sectionCode: '194I(b)',
    payeeName: 'Vashi Market Landlord',
    pan: 'AAACL1234M',
    grossAmount: 60000,
    date: today,
    expenseAccountCode: 'rent',
    paidFrom: 'bank',
  });
  check('TDS on rent: 10% withheld, landlord paid net', rent.status === 201 && rent.body.tdsAmount === '6000.00' && rent.body.netPaid === '54000.00', JSON.stringify(rent.body));
  reg = must(await owner.get(`/tax/tds/register?fy=${fy}&quarter=${quarter}`), 'register 2');
  const q194 = reg.deductions.filter((d) => d.sectionCode === '194Q').map((d) => d.id);
  const mixed = await accountant.post('/tax/tds/challans', {
    sectionCode: '194Q',
    deductionIds: reg.deductions.map((d) => d.id),
    paidOn: today,
    bsrCode: '0510308',
    challanSerial: '00123',
    paidFrom: 'bank',
  });
  check('challan: one challan covers one section', mixed.status === 400, mixed.body.error?.message);
  const challan = await accountant.post('/tax/tds/challans', { sectionCode: '194Q', deductionIds: q194, paidOn: today, bsrCode: '0510308', challanSerial: '00123', paidFrom: 'bank' });
  check('challan: 194Q deposited', challan.status === 201 && challan.body.taxAmount === '12.00', JSON.stringify(challan.body));
  const dup = await accountant.post('/tax/tds/challans', { sectionCode: '194Q', deductionIds: q194, paidOn: today, bsrCode: '0510308', challanSerial: '00124', paidFrom: 'bank' });
  check('challan: already-deposited deductions refused', dup.status === 409);
  reg = must(await owner.get(`/tax/tds/register?fy=${fy}&quarter=${quarter}`), 'register 3');
  check(
    'register: 194Q deposited, rent pending',
    reg.bySection.find((s) => s.sectionCode === '194Q').pending === '0.00' && reg.pendingDeposit === '6000.00' && reg.challans.length === 1,
    JSON.stringify(reg.bySection),
  );
  const accounts2 = must(await owner.get('/accounting/accounts'), 'accounts 2');
  check('ledger: TDS payable = the rent TDS still to deposit', accounts2.find((a) => a.code === 'tds_payable').balance === '6000.00');

  // ---- Permissions ----
  const accConfigure = await accountant.post('/tax/gst-rates', { hsnCode: '0714', description: 'Roots', supplyKind: 'goods', taxability: 'exempt', rate: 0, effectiveFrom: today });
  const ops = as(await login('ops-manager@dev.morbeez.local'));
  const opsRead = await ops.get('/tax/profile');
  check('permissions: accountant files but cannot change rates; ops manager has no access', accConfigure.status === 403 && opsRead.status === 403);

  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
})().catch((e) => {
  console.error('FAILED:', e.stack);
  process.exit(1);
});
