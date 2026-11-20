// Master Spec v3 P5 — cost allocation and true cost, through the real API and
// owner app (docs/redesign/master-spec-v3-plan.md, rules C1–C8; MS §34–36;
// the 12 fixes 7–8; D1). A trip with a farm pickup and three deliveries —
// eggs given a weight per unit — is costed as it closes: its fuel, tolls,
// other expenses, loading labour, stock written off and the vehicle's share
// by km (a rejected expense left out), shared out by the two pools with two
// customers' verified service time, to the paisa against an independent
// working of the documented formula. Then the standard and variance, the
// contribution levels tying out, finance cost, the dated split, backfill and
// AI Pricing. Makes its own data, on the seed.
const path = require('path');
const { API, BASE, DB_URL, PASSWORD, launchBrowser } = require('../lib/env');
const { Client } = require('pg');

const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`);

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
const paise = (v) => {
  const neg = String(v).startsWith('-');
  const [w, f = ''] = String(v).replace('-', '').split('.');
  const n = BigInt(w) * 100n + BigInt((f + '00').slice(0, 2));
  return neg ? -n : n;
};
const rupees = (p) => `${p < 0n ? '-' : ''}${(p < 0n ? -p : p) / 100n}.${((p < 0n ? -p : p) % 100n).toString().padStart(2, '0')}`;

// The documented split (rule C3), worked independently: largest remainder, ties to the earlier.
function largestRemainder(amount, weights) {
  const total = weights.reduce((s, w) => s + w, 0n);
  const ws = total === 0n ? weights.map(() => 1n) : weights;
  const t = total === 0n ? BigInt(weights.length) : total;
  const parts = ws.map((w) => (amount * w) / t);
  let left = amount - parts.reduce((s, p) => s + p, 0n);
  const order = ws.map((w, i) => ({ i, rem: (amount * w) % t })).sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.i - b.i));
  for (const { i } of order) {
    if (left <= 0n) break;
    parts[i] += 1n;
    left -= 1n;
  }
  return parts;
}
// ₹ per KG to 4 dp, half-up (rule C5).
const perKg = (p, kgMilli) => {
  const q = (p * 100n * 1000n * 2n + kgMilli) / (kgMilli * 2n);
  return `${q / 10_000n}.${(q % 10_000n).toString().padStart(4, '0')}`;
};

(async () => {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const owner = client(await login('owner@dev.morbeez.local'));
  const ops = client(await login('ops-manager@dev.morbeez.local'));
  const s = Date.now().toString(36);
  const today = (await owner.get('/accounting/periods')).today;
  const shots = process.env.E2E_SCREENSHOTS;

  try {
    // ---- Set-up ----
    const onion = await owner.post('/products', { name: `P5 Onion ${s}`, baseUom: 'kg' });
    const eggs = await owner.post('/products', { name: `P5 Eggs ${s}`, baseUom: 'unit', kind: 'egg', packSize: 30 });
    const kgWeight = await owner.raw('PATCH', `/products/${onion.id}`, { version: onion.version, unitWeightKg: 1 });
    check('C4: a product sold by weight takes no weight per unit', kgWeight.status === 400, String(kgWeight.status));
    const eggsWeighed = await owner.patch(`/products/${eggs.id}`, { version: eggs.version, unitWeightKg: 0.06 });
    check('C4: eggs weigh 0.06 kg each', eggsWeighed.unitWeightKg === '0.0600', eggsWeighed.unitWeightKg);
    const farmer = await owner.post('/farmers', { name: `P5 Farm ${s}` });
    const agent = await owner.post('/procurement/agents', { name: `P5 Agent ${s}`, defaultCommissionPerKg: 1 });
    const vehicle = await owner.post('/vehicles', { registrationNumber: `KA05P5${s}`.slice(0, 12).toUpperCase(), capacityKg: 3000, fuelType: 'diesel' });
    const driver = await owner.post('/workforce', { name: `P5 Driver ${s}`, roleType: 'driver' });
    const route = await owner.post('/routes', { name: `P5 Route ${s}` });
    const mk = (name) => owner.post('/customers', { name: `${name} ${s}`, creditLimit: 900000, paymentTermsDays: 7 });
    const A = await mk('P5 Hotel A');
    const B = await mk('P5 Shop B');
    const C = await mk('P5 Cafe C');

    // Stock: onion through an agent (₹1/kg commission) at ₹20; eggs at ₹5.
    const buy = async (product, qty, price, extra = {}) => {
      let po = await owner.post('/procurement/purchase-orders', { farmerId: farmer.id, lines: [{ productId: product.id, expectedQuantity: qty, indicativePrice: price }], ...extra });
      po = await owner.post(`/procurement/purchase-orders/${po.id}/confirm`, { version: po.version });
      await owner.post(`/procurement/purchase-orders/${po.id}/receive-goods`, { lines: [{ productId: product.id, receivedQuantity: qty }] });
      const [lot] = await owner.get(`/procurement/purchase-orders/${po.id}/lots`);
      return owner.post(`/procurement/lots/${lot.id}/grade`, { version: lot.version, acceptedQuantity: qty, rejectedQuantity: 0, unitCost: price });
    };
    await buy(onion, 2000, 20, { agentId: agent.id, commissionPerKg: 1 });
    await buy(eggs, 1200, 5);

    // The vehicle's fixed costs: a ₹1,500 service five days ago, spread over the 30 days from it.
    await owner.post('/fleet/maintenance', { vehicleId: vehicle.id, serviceDate: addDays(today, -5), kind: 'service', description: 'Service', amount: 1500, paidFrom: 'bank' });

    const order = async (customer, lines) => {
      const o = await owner.post('/orders', { customerId: customer.id, lines });
      await owner.post(`/orders/${o.id}/confirm`, { version: o.version });
      return owner.get(`/orders/${o.id}`);
    };
    const trip = async (opts) => {
      let t = await owner.post('/logistics/trips', { vehicleId: vehicle.id, driverEmployeeId: driver.id, advanceAmount: 3000, ...(opts.routeId ? { routeId: opts.routeId } : {}) });
      await owner.post(`/logistics/trips/${t.id}/publish`, { version: t.version });
      const stops = [];
      for (const p of opts.pickups ?? []) stops.push({ kind: 'pickup', stop: await owner.post(`/logistics/trips/${t.id}/stops/pickup`, { pickupId: p.pickup.id }), ...p });
      for (const d of opts.deliveries) stops.push({ kind: 'delivery', stop: await owner.post(`/logistics/trips/${t.id}/stops/delivery`, { orderId: d.order.id }), ...d });
      t = await owner.post(`/logistics/trips/${t.id}/start`, { version: (await owner.get(`/logistics/trips/${t.id}`)).version, ...(opts.openingKm !== undefined ? { openingKm: opts.openingKm } : {}) });
      for (const x of stops.filter((y) => y.kind === 'pickup')) {
        await owner.post(`/logistics/trips/${t.id}/stops/${x.stop.id}/complete-pickup`, { weights: [{ productId: x.productId, netQuantity: x.kg }] });
      }
      for (const x of stops.filter((y) => y.kind === 'delivery')) {
        await owner.post(`/logistics/trips/${t.id}/stops/${x.stop.id}/complete-delivery`, { recipientName: 'Manager', signatureData: 'data:image/png;base64,iVBORw0KGgo=' });
      }
      for (const e of opts.expenses ?? []) await owner.post(`/logistics/trips/${t.id}/expenses`, e);
      return { trip: t, stops };
    };
    const close = async (tripId, closingKm, closingStock) => {
      if (closingKm !== undefined) await owner.post(`/logistics/trips/${tripId}/closing-km`, { closingKm });
      let t = await owner.get(`/logistics/trips/${tripId}`);
      t = await owner.post(`/logistics/trips/${tripId}/complete`, { version: t.version, cashDeclared: 0 });
      const handover = await owner.get(`/logistics/trips/${tripId}/handover`);
      return owner.post(`/logistics/trips/${tripId}/reconcile`, {
        version: t.version,
        cashReturned: Math.max(0, Number(handover.expected)),
        exceptionNote: 'P5 suite — closed to be costed',
        ...(closingStock ? { closingStock } : {}),
      });
    };

    // ---- The vehicle's km history: yesterday, 100 km ----
    const z = await trip({ deliveries: [{ order: await order(A, [{ productId: onion.id, quantity: 5, unitPrice: 40 }]) }], openingKm: 1900 });
    await close(z.trip.id, 2000);
    await db.query(`UPDATE fulfilment.trip_reconciliation SET reconciled_at = reconciled_at - interval '1 day' WHERE trip_id = $1`, [z.trip.id]);

    // ---- A and C have 30 days of verified service time; B has none ----
    const h = await trip({
      deliveries: [
        { order: await order(A, [{ productId: onion.id, quantity: 5, unitPrice: 40 }]) },
        { order: await order(C, [{ productId: onion.id, quantity: 5, unitPrice: 40 }]) },
      ],
    });
    await close(h.trip.id);
    await db.query(
      `UPDATE fulfilment.trip_stop SET completed_at = now() - interval '40 days', arrived_at = now() - interval '40 days' - interval '20 minutes' WHERE trip_id = $1`,
      [h.trip.id],
    );

    // ---- The split (D1): 60% by KG from now on ----
    const before = await owner.get('/costing/settings');
    check('D1: running costs are shared 50% by KG until the owner says otherwise', before.kgSharePct === '50.00' && before.history.length === 0, JSON.stringify(before));
    const opsSet = await ops.raw('PUT', '/costing/settings', { kgSharePct: 70 });
    check('…and only finance can change it', opsSet.status === 403, String(opsSet.status));
    const set = await owner.put('/costing/settings', { kgSharePct: 60, note: 'More weight on KG for now' });
    check('D1: a dated change of the split', set.kgSharePct === '60.00' && set.history.length === 1 && set.history[0].setBy === 'owner@dev.morbeez.local', JSON.stringify(set));

    // ---- Trip 1: a farm pickup and three deliveries ----
    let farmPo = await owner.post('/procurement/purchase-orders', { farmerId: farmer.id, lines: [{ productId: onion.id, expectedQuantity: 200, indicativePrice: 18 }] });
    farmPo = await owner.post(`/procurement/purchase-orders/${farmPo.id}/confirm`, { version: farmPo.version });
    const pickup = await owner.post(`/procurement/purchase-orders/${farmPo.id}/pickups`, {});
    const oA = await order(A, [{ productId: onion.id, quantity: 300, unitPrice: 40 }]);
    const oC = await order(C, [{ productId: onion.id, quantity: 100, unitPrice: 40 }]);
    const oB = await order(B, [
      { productId: onion.id, quantity: 100, unitPrice: 40 },
      { productId: eggs.id, quantity: 600, unitPrice: 6 },
    ]);
    const t1 = await trip({
      routeId: route.id,
      openingKm: 2000,
      pickups: [{ pickup, productId: onion.id, kg: 200 }],
      deliveries: [{ order: oA }, { order: oC }, { order: oB }],
      expenses: [
        { category: 'fuel', amount: 1000.01 },
        { category: 'toll', amount: 240 },
        { category: 'labour', amount: 150 },
        { category: 'other', amount: 60, notes: 'Water' },
      ],
    });
    // The driver's phone stamped arrival and completion: A 10 minutes, C 30, B 15.
    const stamp = (stopId, minutes) =>
      db.query(`UPDATE fulfilment.trip_stop SET arrived_at = completed_at - make_interval(mins => $2) WHERE id = $1`, [stopId, minutes]);
    const stopOf = (o) => t1.stops.find((x) => x.order?.id === o.id).stop.id;
    await stamp(stopOf(oA), 10);
    await stamp(stopOf(oC), 30);
    await stamp(stopOf(oB), 15);
    // An expense the owner rejected is the driver's to settle — never a cost of the trip.
    await db.query(
      `INSERT INTO fulfilment.trip_expense (tenant_id, trip_id, category, amount, recorded_by, needs_approval, decision, decision_note, decided_by, decided_at)
       SELECT t.tenant_id, t.id, 'other', 500, t.created_by, true, 'rejected', 'Personal', t.created_by, now() FROM fulfilment.trip t WHERE t.id = $1`,
      [t1.trip.id],
    );
    // Back with 195 of the 200 kg picked up: 5 kg at ₹18 written off on the trip.
    await close(t1.trip.id, 2048.5, [{ productId: onion.id, quantity: 195 }]);
    const c1 = await owner.get(`/costing/trips/${t1.trip.id}`);

    // ---- C1: the pools ----
    check(
      'C1: the trip’s own costs — fuel, tolls, other, loading labour, 5 kg written off — the rejected ₹500 left out',
      c1.components.fuel === '1000.01' && c1.components.tolls === '240.00' && c1.components.otherExpenses === '60.00' && c1.components.labour === '150.00' && c1.components.writtenOff === '90.00',
      JSON.stringify(c1.components),
    );
    // ₹1,500 spread over the 30 days from five days ago: 5 of them in the 30 days before today = ₹250, over yesterday's 100 km = ₹2.50/km.
    check('C1: the vehicle’s share — 48.5 km × ₹2.50/km (₹250 of the service over 100 km)', c1.components.vehicle === '121.25' && c1.tripKm === '48.5' && c1.vehicleRatePerKm === '2.5000', `${c1.components.vehicle} ${c1.tripKm} ${c1.vehicleRatePerKm}`);
    check('C1: driver base pay is never in it; no incentives earned', c1.components.driverIncentives === '0.00' && c1.components.helperIncentives === '0.00');
    check('C1: running ₹1,421.26 + load ₹240.00 = ₹1,661.26', c1.runningTotal === '1421.26' && c1.loadTotal === '240.00' && c1.total === '1661.26', `${c1.runningTotal} ${c1.loadTotal} ${c1.total}`);
    check('D1: costed with the split in force at the close (60%)', c1.kgSharePct === '60.00' && c1.source === 'close');

    // ---- C2–C4: every rupee once, to the paisa ----
    const rows = (await db.query(`SELECT * FROM money.trip_cost_allocation WHERE trip_id = $1`, [t1.trip.id])).rows;
    const COLS = ['fuel', 'tolls', 'repairs', 'driver_incentives', 'other_expenses', 'vehicle', 'labour', 'helper_incentives', 'written_off'];
    const KEYS = ['fuel', 'tolls', 'repairs', 'driverIncentives', 'otherExpenses', 'vehicle', 'labour', 'helperIncentives', 'writtenOff'];
    const sumCol = (col) => rows.reduce((t, r) => t + paise(r[col]), 0n);
    check(
      'C3: each component shared out exactly — allocated = the trip’s cost, nothing left over',
      COLS.every((col, i) => sumCol(col) === paise(c1.components[KEYS[i]])) && rows.reduce((t, r) => t + paise(r.amount), 0n) === paise(c1.total) && c1.unallocated === '0.00',
      COLS.map((col) => `${col} ${rupees(sumCol(col))}`).join(' '),
    );
    check('C2/C4: 536 kg delivered (eggs at 0.06 kg each: 36 kg), 200 kg picked up, every line weighed', c1.deliveredKg === '536.000' && c1.pickupKg === '200.000' && c1.unweightedLines === 0, `${c1.deliveredKg} ${c1.pickupKg} ${c1.unweightedLines}`);

    // The running key (D1), worked independently: W = α·kg·M + (100−α)·(in Q ? m·K : kg·M); Q = A and C (history and minutes).
    const lineKg = (r) => BigInt(String(r.kg).replace('.', ''));
    const lotRow = rows.find((r) => r.lot_id);
    const rowA = rows.find((r) => r.customer_id === A.id);
    const rowC = rows.find((r) => r.customer_id === C.id);
    const rowsB = rows.filter((r) => r.customer_id === B.id);
    const kgA = lineKg(rowA), kgC = lineKg(rowC), kgB = rowsB.reduce((t, r) => t + lineKg(r), 0n), kgLot = lineKg(lotRow);
    const M = 40n, K = kgA + kgC, alpha = 6000n, rest = 4000n;
    const W = [alpha * kgA * M + rest * 10n * K, alpha * kgC * M + rest * 30n * K, 10000n * kgB * M, 10000n * kgLot * M];
    const running = ['fuel', 'tolls', 'other_expenses', 'vehicle'];
    let exact = true;
    const detail = [];
    for (const col of running) {
      const pool = paise(c1.components[KEYS[COLS.indexOf(col)]]);
      const [a, c, b, lot] = largestRemainder(pool, W);
      const gotB = rowsB.reduce((t, r) => t + paise(r[col]), 0n);
      if (paise(rowA[col]) !== a || paise(rowC[col]) !== c || gotB !== b || paise(lotRow[col]) !== lot) exact = false;
      detail.push(`${col}: A ${rowA[col]}/${rupees(a)} C ${rowC[col]}/${rupees(c)} B ${rupees(gotB)}/${rupees(b)} lot ${lotRow[col]}/${rupees(lot)}`);
    }
    check('C2: the running pool by the D1 key — A and C share theirs by minutes, B and the pickup keep their KG share — to the paisa', exact, detail.join(' | '));
    // B's share split between its lines by KG: onion 100 kg, eggs 36 kg.
    const bOnion = rowsB.find((r) => r.product_id === onion.id);
    const bEggs = rowsB.find((r) => r.product_id === eggs.id);
    const bFuel = paise(bOnion.fuel) + paise(bEggs.fuel);
    const [bo, be] = largestRemainder(bFuel, [100_000n, 36_000n]);
    check('C4: a stop’s share split to its lines by KG — eggs carry theirs', paise(bOnion.fuel) === bo && paise(bEggs.fuel) === be && be > 0n, `${bOnion.fuel} ${bEggs.fuel}`);
    // The load pool by KG delivered only — never to the lot picked up.
    const [la, lc, lbo, lbe] = largestRemainder(paise('150.00'), [kgA, kgC, 100_000n, 36_000n]);
    check(
      'C2: the load pool by KG delivered; the inbound lot carries none of it',
      paise(rowA.labour) === la && paise(rowC.labour) === lc && paise(bOnion.labour) === lbo && paise(bEggs.labour) === lbe && lotRow.labour === '0.00' && lotRow.written_off === '0.00',
      `${rowA.labour} ${rowC.labour} ${bOnion.labour} ${bEggs.labour} ${lotRow.labour}`,
    );
    check('C3: the inbound leg goes to the lot picked up', paise(c1.inboundCost) === paise(lotRow.amount) && paise(c1.deliveryCost) + paise(c1.inboundCost) === paise(c1.total), `${c1.deliveryCost} + ${c1.inboundCost}`);

    // ---- C5: the standard, and the variance on the closed trip ----
    const simple = async (fuel, km0) => {
      const x = await trip({ routeId: route.id, openingKm: km0, deliveries: [{ order: await order(A, [{ productId: onion.id, quantity: 50, unitPrice: 40 }]) }], expenses: [{ category: 'fuel', amount: fuel }] });
      await close(x.trip.id, km0 + 10);
      return owner.get(`/costing/trips/${x.trip.id}`);
    };
    const c2 = await simple(100, 2100);
    // The route has one closed trip before this one: too few, so the business's last 30 days stand in.
    const biz = (
      await db.query(
        `SELECT COALESCE(SUM(c.delivery_cost), 0)::numeric(14,2)::text AS cost, COALESCE(SUM(c.delivered_kg), 0)::numeric(14,3)::text AS kg, count(*)::int AS trips
           FROM money.trip_cost c JOIN fulfilment.trip_reconciliation r ON r.trip_id = c.trip_id
          WHERE c.trip_id <> $1 AND c.delivered_kg > 0 AND c.tenant_id = (SELECT tenant_id FROM fulfilment.trip WHERE id = $1)
            AND r.reconciled_at < (SELECT reconciled_at FROM fulfilment.trip_reconciliation WHERE trip_id = $1)
            AND r.reconciled_at >= (SELECT reconciled_at FROM fulfilment.trip_reconciliation WHERE trip_id = $1) - interval '30 days'`,
        [c2.tripId],
      )
    ).rows[0];
    const bizStandard = perKg(paise(biz.cost), BigInt(biz.kg.replace('.', '')));
    check(
      'C5: fewer than 3 closed trips on the route — the business’s standard instead',
      c2.actualPerKg === '2.5000' && c2.standardBasis === 'business' && c2.standardTrips === biz.trips && biz.trips >= 3 && c2.standardPerKg === bizStandard,
      `${c2.standardPerKg} vs ${bizStandard} (${c2.standardBasis}, ${c2.standardTrips} of ${biz.trips})`,
    );
    const c3 = await simple(100, 2200);
    const c4 = await simple(100, 2300);
    const c5 = await simple(150, 2400);
    const priorCost = [c1, c2, c3, c4].reduce((t, c) => t + paise(c.deliveryCost), 0n);
    const priorKg = [c1, c2, c3, c4].reduce((t, c) => t + BigInt(c.deliveredKg.replace('.', '')), 0n);
    const standard = perKg(priorCost, priorKg);
    check('C5: actual ₹175 over 50 kg = ₹3.5000/kg', c5.actualPerKg === '3.5000' && c5.deliveryCost === '175.00', `${c5.actualPerKg} ${c5.deliveryCost}`);
    check('C5: the standard is the route’s last 30 days — its 4 closed trips', c5.standardBasis === 'route' && c5.standardTrips === 4 && c5.standardPerKg === standard, `${c5.standardPerKg} vs ${standard} (${c5.standardBasis}, ${c5.standardTrips})`);
    const variance = (Number(c5.actualPerKg) - Number(standard)).toFixed(4);
    check('C5: the variance is actual − standard', c5.variancePerKg === variance, `${c5.variancePerKg} vs ${variance}`);

    // ---- C6: contribution, every level adding up ----
    const invA = (await owner.get(`/finance/invoices?customerId=${A.id}&kind=sale`)).items.find((i) => i.orderId === oA.id);
    await db.query(`UPDATE money.invoice SET issued_at = issued_at - interval '10 days' WHERE id = $1`, [invA.id]);
    const from = addDays(today, -40);
    const levels = ['business', 'route', 'trip', 'vehicle', 'product', 'customer', 'order'];
    const reports = {};
    for (const level of levels) reports[level] = await owner.get(`/costing/contribution?level=${level}&from=${from}&to=${today}`);
    const sumRows = (rows, k) => rows.reduce((t, r) => t + paise(r[k]), 0n);
    const tied = levels.every(
      (l) =>
        ['revenue', 'trueCost', 'financeCost', 'netContribution'].every((k) => sumRows(reports[l].rows, k) === paise(reports[l].totals[k])) &&
        reports[l].totals.netContribution === reports.business.totals.netContribution,
    );
    check('C6: Business → Route → Trip → Vehicle → Product → Customer → Order: every level adds up to the same business total', tied, levels.map((l) => `${l} ${reports[l].rows.length}`).join(' '));
    const rowOrder = reports.order.rows.find((r) => r.key === oA.id);
    const allocA = paise(rowA.amount);
    check(
      'C6: an order’s true cost — its lots (300 kg × ₹20), the agent (₹1/kg), its share of the trip',
      rowOrder?.revenue === '12000.00' && rowOrder.purchase === '6000.00' && rowOrder.agent === '300.00' && paise(rowOrder.trueCost) === 600000n + 30000n + allocA,
      JSON.stringify(rowOrder && { revenue: rowOrder.revenue, purchase: rowOrder.purchase, agent: rowOrder.agent, trueCost: rowOrder.trueCost, alloc: rowA.amount }),
    );
    // ₹12,000 owed for 10 days at 18% a year: 12,000 × 10 × 18% ÷ 365 = ₹59.18.
    check('C6/MS §31: its finance cost — what was owed × days × the cost of capital ÷ 365', rowOrder?.financeCost === '59.18' && reports.order.costOfCapitalPct === '18.00', `${rowOrder?.financeCost} at ${reports.order.costOfCapitalPct}%`);
    check(
      'C6: net contribution after finance = revenue − true cost − finance',
      paise(rowOrder.netContribution) === paise(rowOrder.revenue) - paise(rowOrder.trueCost) - paise(rowOrder.financeCost),
      rowOrder.netContribution,
    );
    const inbound = reports.customer.rows.find((r) => r.key === null);
    check('C6: the inbound leg sits where it belongs — the product, not any customer', !!inbound && paise(inbound.other) >= paise(c1.inboundCost) && !!reports.product.rows.find((r) => r.key === onion.id), JSON.stringify(inbound && { label: inbound.label, other: inbound.other }));

    // ---- C7: fed to AI Pricing ----
    const pricing = await owner.get('/ai/pricing');
    const window = (await db.query(
      `SELECT SUM(c.delivery_cost)::numeric(14,2)::text AS cost, SUM(c.delivered_kg)::numeric(14,3)::text AS kg
         FROM money.trip_cost c JOIN fulfilment.trip_reconciliation r ON r.trip_id = c.trip_id
        WHERE c.delivered_kg > 0 AND (r.reconciled_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date`,
      [addDays(today, -29), today],
    )).rows[0];
    check('C7: AI Pricing’s delivery cost per KG comes from the closed trips’ allocation', pricing.deliveryWindow.source === 'allocated' && pricing.deliveryWindow.cost === window.cost && pricing.deliveryWindow.kg === window.kg, `${JSON.stringify(pricing.deliveryWindow)} vs ${JSON.stringify(window)}`);

    // ---- C8: a trip closed before costing, costed on request ----
    await db.query('DELETE FROM money.trip_cost_allocation WHERE trip_id = $1', [c3.tripId]);
    await db.query('DELETE FROM money.trip_cost WHERE trip_id = $1', [c3.tripId]);
    const missing = await owner.raw('GET', `/costing/trips/${c3.tripId}`);
    check('C8: a trip closed before costing has no cost yet', missing.status === 404, String(missing.status));
    const backfilled = await owner.post('/costing/backfill');
    check('C8: costed on request, once', backfilled.costed === 1 && backfilled.tripIds[0] === c3.tripId, JSON.stringify(backfilled));
    const c3b = await owner.get(`/costing/trips/${c3.tripId}`);
    check('C8: …from what was recorded — the same cost', c3b.source === 'backfill' && c3b.total === c3.total && c3b.deliveryCost === c3.deliveryCost, `${c3b.source} ${c3b.total} vs ${c3.total}`);
    check('C8: and never twice', (await owner.post('/costing/backfill')).costed === 0);

    // ---- Who sees it ----
    const opsRead = await ops.raw('GET', `/costing/trips/${t1.trip.id}`);
    check('costs are finance’s to read', opsRead.status === 403, String(opsRead.status));
    const unbalanced = await db.query(`SELECT e.id FROM money.ledger_entry e JOIN money.ledger_line l ON l.entry_id = e.id GROUP BY e.id HAVING SUM(l.debit) <> SUM(l.credit)`);
    check('the ledger is untouched by costing: every entry still balances', unbalanced.rowCount === 0);
    const posted = await db.query(`SELECT count(*)::int AS n FROM money.ledger_entry WHERE source_type = 'trip_cost'`);
    check('allocation is not posting — no ledger entry for it', posted.rows[0].n === 0);

    // ---- The owner app ----
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({ viewport: { width: 1280, height: 1100 } })).newPage();
      await page.goto(`${BASE}/login`);
      await page.fill('#login', 'owner@dev.morbeez.local');
      await page.fill('#password', PASSWORD);
      await page.click('button[type=submit]');
      await page.waitForURL((u) => !/\/login/.test(u.toString()));

      await page.goto(`${BASE}/logistics?open=${c5.tripId}`);
      await page.locator('.trip-cost').waitFor();
      const panel = (await page.locator('.trip-cost').textContent()).replace(/\s+/g, ' ');
      check('UI: a closed trip shows its cost, per KG against the standard, and the variance', /Cost of this trip/.test(panel) && /Standard per KG/.test(panel) && /over the standard|under the standard/.test(panel), panel.slice(0, 260));
      const panelFits = await page.locator('.trip-cost').evaluate((el) => [...el.querySelectorAll('*')].every((x) => x.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1));
      check('UI: nothing in the panel runs past its edge', panelFits);
      if (shots) await page.locator('.trip-cost').screenshot({ path: path.join(shots, 'p5-trip-cost.png') });

      await page.goto(`${BASE}/logistics?open=${t1.trip.id}`);
      await page.locator('.trip-cost').waitFor();
      const panel1 = (await page.locator('.trip-cost').textContent()).replace(/\s+/g, ' ');
      check('UI: …with the vehicle’s km × rate and where the cost went', /48\.5 km × ₹2\.50/.test(panel1) && /order line/.test(panel1) && /lot\(s\) picked up/.test(panel1), panel1.slice(0, 260));
      if (shots) await page.locator('.trip-cost').screenshot({ path: path.join(shots, 'p5-trip-cost-pickup.png') });

      await page.goto(`${BASE}/profit`);
      await page.getByRole('button', { name: 'Month', exact: true }).click().catch(() => undefined);
      await page.getByRole('heading', { name: 'True cost & contribution' }).waitFor();
      await page.locator('table.contribution-table tbody tr').first().waitFor();
      await page.locator('table.contribution-table').getByRole('button', { name: new RegExp(`P5 Hotel A ${s}`) }).click();
      await page.locator('.contribution-parts').first().waitFor();
      const table = (await page.locator('section.contribution').textContent()).replace(/\s+/g, ' ');
      check(
        'UI: Profit & Insights shows true cost and contribution, a customer broken down',
        /Finance cost/.test(table) && /Product purchase/.test(table) && /Contribution before finance/.test(table) && /60% by KG/.test(table),
        table.slice(0, 260),
      );
      const fits = await page.locator('section.contribution .table-wrap').evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
      check('UI: the table fits the page on a desktop — nothing cut off', fits);
      if (shots) await page.locator('section.contribution').screenshot({ path: path.join(shots, 'p5-contribution.png') });

      // On a phone the table scrolls in its own box; the page stays the phone's width
      // (a wider page makes a phone zoom out, which widens the window too).
      const phone = await (await browser.newContext({ viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true })).newPage();
      await phone.goto(`${BASE}/login`);
      await phone.fill('#login', 'owner@dev.morbeez.local');
      await phone.fill('#password', PASSWORD);
      await phone.click('button[type=submit]');
      await phone.waitForURL((u) => !/\/login/.test(u.toString()));
      await phone.goto(`${BASE}/profit`);
      await phone.locator('table.contribution-table tbody tr').first().waitFor();
      const width = await phone.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
      check('UI: on a phone the contribution table scrolls in its box — the page stays 400 px wide', width.inner === 400 && width.scroll <= 401, JSON.stringify(width));
      if (shots) await phone.screenshot({ path: path.join(shots, 'p5-contribution-phone.png'), fullPage: true });
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
