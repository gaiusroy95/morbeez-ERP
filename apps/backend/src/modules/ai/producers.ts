import { PoolClient } from 'pg';
import { fromCents, moneyFromNumber, multiplyToMoney, subtractMoney, sumMoney, toCents } from '../../common/money';
import { AiDataRepository } from './repositories/ai-data.repository';
import { AiSettings, Draft, Evidence } from './entities/ai.entity';
import { addDays, buyQuantity, Confidence, DailySeries, forecastDemand } from './math/forecast';
import { suggestPrice, worthSuggesting } from './math/pricing';
import { bestOrder, planLoads, Point, tourKm } from './math/routing';
import { highOutliers, median } from './math/anomaly';
import { adviseTerms, CustomerProfit, profit } from './math/profitability';

// The six producers (AI System, section 03). Each reads through a
// read-only client and returns drafts; none can write (DR.1). Numbers are
// computed here; the explanation is a template over the same evidence
// (REC.1) — a language model may later rephrase it, never change it.

export interface ProducerContext {
  client: PoolClient;
  data: AiDataRepository;
  settings: AiSettings;
  today: string;
  tomorrow: string;
  tz: string;
  now: Date;
  endOf: (date: string) => Date; // end of that tenant-local day
}

export class Suppressed extends Error {}

const inr = (v: string | number) => `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const qty = (v: number | string, uom: string) => `${Number(Number(v).toFixed(3)).toLocaleString('en-IN')} ${uom}`;
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' });

// ---- Tomorrow's buying and price: shared inputs ----

interface ProductInputs {
  products: Awaited<ReturnType<AiDataRepository['products']>>;
  series: Map<string, DailySeries>;
  firstSales: Map<string, string>;
  free: Awaited<ReturnType<AiDataRepository['freeStock']>>;
  forecasts: Map<string, ReturnType<typeof forecastDemand>>;
}

export async function productInputs(ctx: ProducerContext): Promise<ProductInputs> {
  const products = await ctx.data.products(ctx.client);
  const rows = await ctx.data.dailySales(ctx.client, ctx.tz, addDays(ctx.today, -63), ctx.today);
  const series = new Map<string, DailySeries>();
  for (const r of rows) {
    const s = series.get(r.product_id) ?? new Map();
    s.set(r.day, Number(r.qty));
    series.set(r.product_id, s);
  }
  const firstSales = await ctx.data.firstSales(ctx.client, ctx.tz);
  const forecasts = new Map<string, ReturnType<typeof forecastDemand>>();
  for (const p of products) {
    const s = series.get(p.id);
    if (!s) continue;
    const recent = [...s.entries()].some(([d, q]) => d > addDays(ctx.today, -28) && q > 0);
    if (recent) forecasts.set(p.id, forecastDemand(s, ctx.tomorrow, firstSales.get(p.id) ?? null));
  }
  return { products, series, firstSales, free: await ctx.data.freeStock(ctx.client), forecasts };
}

// ---- 1. Tomorrow's buying ----

export async function procurement(ctx: ProducerContext, inp: ProductInputs): Promise<Draft[]> {
  if (!inp.forecasts.size) throw new Suppressed('No sales in the last 4 weeks to forecast from');
  const inbound = await ctx.data.inbound(ctx.client);
  const shrink = await ctx.data.shrinkRates(ctx.client, new Date(ctx.now.getTime() - 56 * 86_400_000));
  const farmers = await ctx.data.recentFarmers(ctx.client);
  const drafts: Draft[] = [];
  for (const p of inp.products) {
    const f = inp.forecasts.get(p.id);
    if (!f) continue;
    const freeQty = Number(inp.free.get(p.id)?.qty ?? 0);
    const inboundQty = Number(inbound.get(p.id) ?? 0);
    const shrinkRate = shrink.get(p.id) ?? 0;
    const buy = buyQuantity(f.demand, shrinkRate, freeQty, inboundQty);
    if (buy < 1) continue;
    const from = farmers.get(p.id) ?? [];
    const price = from[0]?.lastPrice ?? inp.free.get(p.id)?.unitCost ?? null;
    const buyQty = buy.toFixed(3);
    const spend = price ? multiplyToMoney(buyQty, price) : null;
    const day = weekday(ctx.tomorrow);
    const evidence: Evidence[] = [
      { fact: `${day}s over the last 4 weeks`, value: f.sameWeekday.map((d) => qty(d.qty, p.uom)).join(', '), source: { kind: 'sales', label: 'Invoices and spot sales' } },
      { fact: 'Recent trend', value: f.trend === 1 ? 'steady' : `×${f.trend}`, source: { kind: 'sales', label: 'Last 14 days against the 14 before' } },
      { fact: 'Free stock now', value: qty(freeQty, p.uom), source: { kind: 'stock', ids: [p.id] } },
      { fact: 'Ordered, not yet received', value: qty(inboundQty, p.uom), source: { kind: 'purchase_orders' } },
      { fact: 'Usually lost to spoilage', value: pct(shrinkRate), source: { kind: 'shrinkage', label: 'Last 8 weeks' } },
    ];
    if (from[0]) evidence.push({ fact: 'Last bought from', value: `${from[0].name} at ${inr(from[0].lastPrice)}/${p.uom}`, source: { kind: 'farmer', ids: [from[0].farmerId] } });
    drafts.push({
      type: 'procurement',
      subjectKind: 'product',
      subjectId: p.id,
      targetDate: ctx.tomorrow,
      title: `Buy about ${qty(buyQty, p.uom)} of ${p.name} for ${day}`,
      proposal: {
        action: 'purchase_order',
        productId: p.id,
        uom: p.uom,
        quantity: buyQty,
        demand: f.demand.toFixed(3),
        low: f.low.toFixed(3),
        high: f.high.toFixed(3),
        farmers: from,
        farmerId: from[0]?.farmerId ?? null,
        indicativePrice: price,
        compare: { quantity: buyQty, farmerId: from[0]?.farmerId ?? null },
      },
      evidence,
      explanation:
        `${day}s sold ${qty(f.weekdayMean, p.uom)} of ${p.name} on average over the last 4 weeks` +
        `${f.trend === 1 ? '' : f.trend > 1 ? ', and sales are rising' : ', and sales are easing'}. ` +
        `Expect ${qty(f.low, p.uom)}–${qty(f.high, p.uom)} tomorrow. With ${pct(shrinkRate)} usually lost to spoilage, ` +
        `${qty(freeQty, p.uom)} in stock and ${qty(inboundQty, p.uom)} on order, about ${qty(buyQty, p.uom)} more covers it.`,
      expectedImpact: spend,
      confidence: f.confidence,
      sensitive: false,
      producer: 'baseline:procurement@1',
      expiresAt: ctx.endOf(ctx.today),
    });
  }
  if (!drafts.length) throw new Suppressed('Stock on hand and orders already placed cover tomorrow');
  return drafts;
}

// ---- 2. Price ----

export async function pricing(ctx: ProducerContext, inp: ProductInputs): Promise<Draft[]> {
  const realized = await ctx.data.realizedPrices(ctx.client, ctx.tz, addDays(ctx.today, -13), ctx.today);
  if (![...inp.free.values()].some((f) => f.unitCost)) throw new Suppressed('No costed stock on hand to price');
  const drafts: Draft[] = [];
  for (const p of inp.products) {
    const stock = inp.free.get(p.id);
    if (!stock?.unitCost) continue;
    const r = realized.get(p.id) ?? null;
    const s = suggestPrice({ unitCost: stock.unitCost, basePrice: p.base_price, realized: r, targetMarginPct: ctx.settings.targetMarginPct, maxMovePct: ctx.settings.maxPriceMovePct });
    if (!worthSuggesting(s, p.base_price)) continue;
    const demand = inp.forecasts.get(p.id)?.demand ?? null;
    const impact = demand !== null ? multiplyToMoney(demand.toFixed(3), subtractMoney(s.price, p.base_price)) : null;
    const confidence: Confidence = !r ? 'early_estimate' : r.lines >= 10 ? 'solid' : r.lines >= 3 ? 'rough_guide' : 'early_estimate';
    const evidence: Evidence[] = [
      { fact: 'Cost of the stock on hand', value: `${inr(stock.unitCost)}/${p.uom} over ${qty(stock.qty, p.uom)}`, source: { kind: 'stock', ids: [p.id] } },
      { fact: 'Your target margin', value: `${Number(ctx.settings.targetMarginPct)}%`, source: { kind: 'settings' } },
      { fact: "Today's price", value: `${inr(p.base_price)}/${p.uom}`, source: { kind: 'product', ids: [p.id] } },
    ];
    if (r) evidence.push({ fact: 'Paid over the last 14 days', value: `${inr(r.low)}–${inr(r.high)}, average ${inr(r.average)} (${r.lines} sales)`, source: { kind: 'sales', label: 'Invoices and spot sales' } });
    evidence.push({ fact: 'How it was worked out', value: s.steps.join('; ') });
    const move = toCents(s.price) > toCents(p.base_price) ? 'Raise' : 'Lower';
    drafts.push({
      type: 'pricing',
      subjectKind: 'product',
      subjectId: p.id,
      targetDate: ctx.tomorrow,
      title: `${move} ${p.name} to ${inr(s.price)}/${p.uom}`,
      proposal: {
        action: 'product_price',
        productId: p.id,
        productVersion: p.version,
        uom: p.uom,
        currentPrice: p.base_price,
        price: s.price,
        bandMin: s.bandMin,
        bandMax: s.bandMax,
        bandFrom: ctx.tomorrow,
        compare: { price: s.price },
      },
      evidence,
      explanation:
        (s.reason === 'below_cost' ? `Today's ${inr(p.base_price)}/${p.uom} is below what the stock cost (${inr(stock.unitCost)}). ` : '') +
        `The ${qty(stock.qty, p.uom)} of ${p.name} in stock cost ${inr(stock.unitCost)}/${p.uom}; your ${Number(ctx.settings.targetMarginPct)}% target puts it near ${inr(s.price)}` +
        (r ? `, and buyers paid ${inr(r.low)}–${inr(r.high)} over the last 14 days.` : '.') +
        ` Drivers could accept ${inr(s.bandMin)}–${inr(s.bandMax)} on spot sales.`,
      expectedImpact: impact,
      confidence,
      sensitive: false,
      producer: 'baseline:pricing@1',
      expiresAt: ctx.endOf(ctx.tomorrow),
    });
  }
  return drafts;
}

// ---- 3. Logistics ----

interface Pins {
  depot: Point | null;
  place: Map<string, Point>; // `${kind}:${id}`
}

async function pins(ctx: ProducerContext): Promise<Pins> {
  const rows = await ctx.data.pins(ctx.client);
  const place = new Map<string, Point>();
  let depot: Point | null = null;
  for (const r of rows) {
    const p = { lat: Number(r.latitude), lng: Number(r.longitude) };
    if (r.kind === 'depot') depot = p;
    else place.set(`${r.kind}:${r.ref_id}`, p);
  }
  return { depot, place };
}

export async function logisticsRoute(ctx: ProducerContext): Promise<Draft[]> {
  const pin = await pins(ctx);
  if (!pin.depot) throw new Suppressed("Set the depot's map pin under Logistics to plan routes");
  const rows = await ctx.data.plannedTrips(ctx.client);
  const trips = new Map<string, typeof rows>();
  for (const r of rows) trips.set(r.trip_id as string, [...(trips.get(r.trip_id as string) ?? []), r]);
  const costs = await ctx.data.vehicleCostPerKm(ctx.client, [...new Set(rows.map((r) => r.vehicle_id as string))], ctx.today);
  const drafts: Draft[] = [];
  for (const [tripId, stops] of trips) {
    const pinned = stops.filter((s) => pin.place.has(`${s.place_kind}:${s.place_id}`));
    if (pinned.length < 3) continue;
    const points = pinned.map((s) => pin.place.get(`${s.place_kind}:${s.place_id}`)!);
    const currentKm = tourKm(pin.depot, points);
    const order = bestOrder(pin.depot, points);
    const newKm = tourKm(pin.depot, order.map((i) => points[i]));
    const saved = currentKm - newKm;
    if (saved < 2 || saved / currentKm < 0.05) continue;
    const unpinned = stops.filter((s) => !pin.place.has(`${s.place_kind}:${s.place_id}`));
    const newStops = [...order.map((i) => pinned[i]), ...unpinned];
    const vehicle = stops[0].registration_number as string;
    const costPerKm = costs.get(stops[0].vehicle_id as string) ?? ctx.settings.defaultCostPerKm;
    const savedCost = multiplyToMoney(saved.toFixed(3), costPerKm);
    const names = (list: typeof stops) => list.map((s) => s.place_name as string).join(' → ');
    const evidence: Evidence[] = [
      { fact: 'Current order', value: `${names(stops)} — about ${currentKm.toFixed(1)} km`, source: { kind: 'trip', ids: [tripId] } },
      { fact: 'Suggested order', value: `${names(newStops)} — about ${newKm.toFixed(1)} km` },
      { fact: 'Running cost', value: `${inr(costPerKm)}/km`, source: costs.has(stops[0].vehicle_id as string) ? { kind: 'fuel', label: `${vehicle}, last 90 days` } : { kind: 'settings', label: 'Default cost per km' } },
      { fact: 'Distances', value: 'Straight line between map pins × 1.3 for roads' },
    ];
    if (unpinned.length) evidence.push({ fact: 'Left at the end (no map pin)', value: unpinned.map((s) => s.place_name as string).join(', ') });
    drafts.push({
      type: 'logistics_route',
      subjectKind: 'trip',
      subjectId: tripId,
      targetDate: ctx.today,
      title: `Reorder ${vehicle}'s stops to save about ${saved.toFixed(1)} km`,
      proposal: {
        action: 'resequence_stops',
        tripId,
        tripVersion: stops[0].version,
        stopIds: newStops.map((s) => s.stop_id),
        currentStopIds: stops.map((s) => s.stop_id),
        stopNames: Object.fromEntries(stops.map((s) => [s.stop_id, s.place_name])),
        currentKm: currentKm.toFixed(1),
        newKm: newKm.toFixed(1),
        compare: { stopIds: newStops.map((s) => s.stop_id) },
      },
      evidence,
      explanation: `Visiting ${names(newStops)} instead of the planned order cuts ${vehicle}'s run from about ${currentKm.toFixed(1)} to ${newKm.toFixed(1)} km, roughly ${inr(savedCost)} in running cost.`,
      expectedImpact: savedCost,
      confidence: unpinned.length ? 'rough_guide' : 'solid',
      sensitive: false,
      producer: 'baseline:route-2opt@1',
      expiresAt: ctx.endOf(ctx.today),
    });
  }
  return drafts;
}

export async function logisticsLoad(ctx: ProducerContext): Promise<Draft[]> {
  const orders = await ctx.data.unassignedOrders(ctx.client);
  if (!orders.length) return [];
  const vehicles = await ctx.data.freeVehicles(ctx.client, ctx.today);
  if (!vehicles.length) throw new Suppressed('Confirmed orders wait for a trip, but no vehicle is free and fit for trips');
  const pin = await pins(ctx);
  const plan = planLoads(
    pin.depot,
    orders.map((o) => ({ orderId: o.order_id, kg: Number(o.kg), point: pin.place.get(`customer:${o.customer_id}`) ?? null })),
    vehicles.map((v) => ({ vehicleId: v.vehicle_id, capacityKg: Number(v.capacity_kg), costPerKm: Number(v.cost_per_km ?? ctx.settings.defaultCostPerKm) })),
  );
  const byOrder = new Map(orders.map((o) => [o.order_id, o]));
  const drafts: Draft[] = [];
  for (const load of plan.loads) {
    const v = vehicles.find((x) => x.vehicle_id === load.vehicleId)!;
    const costPerKm = v.cost_per_km ?? ctx.settings.defaultCostPerKm;
    const stops = load.orderIds.map((id) => byOrder.get(id)!);
    const fill = Math.round((load.kg / Number(v.capacity_kg)) * 100);
    const cost = load.km !== null ? multiplyToMoney(load.km.toFixed(3), costPerKm) : null;
    const unweighed = stops.filter((s) => s.unweighed_lines > 0);
    const evidence: Evidence[] = [
      { fact: 'Orders waiting for a trip', value: stops.map((s) => `${s.customer_name} (${qty(s.kg, 'kg')})`).join(', '), source: { kind: 'orders', ids: load.orderIds } },
      { fact: 'Load', value: `${qty(load.kg, 'kg')} of ${qty(v.capacity_kg, 'kg')} — ${fill}% full`, source: { kind: 'vehicle', ids: [v.vehicle_id] } },
      { fact: 'Why this vehicle', value: `Lowest running cost that fits: ${inr(costPerKm)}/km${v.cost_per_km ? '' : ' (default — no fuel records)'}` },
    ];
    if (load.km !== null) evidence.push({ fact: 'Route', value: `about ${load.km} km, ${inr(cost!)}` });
    if (load.unpinned.length) evidence.push({ fact: 'No map pin (route not costed)', value: load.unpinned.map((id) => byOrder.get(id)!.customer_name).join(', ') });
    if (unweighed.length) evidence.push({ fact: 'Lines not in kg (not counted in the load)', value: unweighed.map((s) => s.customer_name).join(', ') });
    drafts.push({
      type: 'logistics_load',
      subjectKind: 'vehicle',
      subjectId: v.vehicle_id,
      targetDate: ctx.today,
      title: `Send ${v.registration_number} with ${stops.length} order${stops.length === 1 ? '' : 's'} (${fill}% full)`,
      proposal: {
        action: 'create_trip',
        vehicleId: v.vehicle_id,
        orderIds: load.orderIds,
        orderNames: Object.fromEntries(stops.map((s) => [s.order_id, s.customer_name])),
        kg: load.kg.toFixed(3),
        capacityKg: v.capacity_kg,
        km: load.km,
        compare: { vehicleId: v.vehicle_id, orderIds: load.orderIds },
      },
      evidence,
      explanation:
        `${stops.length} confirmed order${stops.length === 1 ? ' is' : 's are'} waiting for a trip. ${v.registration_number} is free, fit for the road and the cheapest to run that can carry ` +
        `${qty(load.kg, 'kg')} (${fill}% of its capacity)` +
        (load.km !== null ? `; delivering in the order shown is about ${load.km} km.` : '.'),
      expectedImpact: null,
      confidence: load.unpinned.length || unweighed.length ? 'rough_guide' : 'solid',
      sensitive: false,
      producer: 'baseline:load-sweep@1',
      expiresAt: ctx.endOf(ctx.today),
    });
  }
  return drafts;
}

// ---- 4. Customer profitability ----

export async function customerProfits(ctx: ProducerContext, from: string, to: string): Promise<(CustomerProfit & { name: string })[]> {
  const rows = await ctx.data.customerFigures(ctx.client, ctx.tz, from, to);
  return rows.map((r) => ({
    ...profit(
      {
        customerId: r.customer_id as string,
        invoices: r.invoices as number,
        revenue: r.revenue as string,
        cogs: r.cogs as string,
        deliveryCost: moneyFromNumber(Number(r.delivery_cost)),
        financeChargeIncome: r.finance_charges as string,
        crateRecoveries: r.crate_recoveries as string,
        crateLossesAbsorbed: moneyFromNumber(Number(r.crate_losses)),
        receivableRupeeDays: moneyFromNumber(Number(r.rupee_days)),
        averageDaysToPay: r.days_to_pay as number | null,
        paymentTermsDays: r.payment_terms_days as number,
      },
      ctx.settings.costOfCapitalPct,
    ),
    name: r.name as string,
  }));
}

export async function customerTerms(ctx: ProducerContext): Promise<Draft[]> {
  const from = addDays(ctx.today, -89);
  const profits = await customerProfits(ctx, from, ctx.today);
  if (!profits.length) throw new Suppressed('No customer invoices in the last 90 days');
  const terms = await ctx.data.customerTerms(ctx.client);
  const min = Number(ctx.settings.minCustomerMarginPct);
  const drafts: Draft[] = [];
  for (const p of profits) {
    if (p.invoices < 3 || p.contributionPct === null || p.contributionPct >= min) continue;
    const advice = adviseTerms(p);
    if (!advice) continue;
    const t = terms.get(p.customerId)!;
    const evidence: Evidence[] = [
      { fact: 'Revenue, last 90 days', value: `${inr(p.revenue)} over ${p.invoices} invoices`, source: { kind: 'invoices', label: p.name } },
      { fact: 'Gross margin', value: `${inr(p.grossMargin)} (${p.grossMarginPct}%)`, source: { kind: 'ledger', label: 'Cost of goods sold' } },
      { fact: 'Delivery cost (their share of trips)', value: inr(p.deliveryCost), source: { kind: 'trips', label: 'Trip expenses and fuel, by kg delivered' } },
      { fact: 'Cost of waiting for payment', value: `${inr(p.creditCost)} at ${Number(ctx.settings.costOfCapitalPct)}% a year`, source: { kind: 'receivables' } },
      { fact: 'Pays in', value: p.averageDaysToPay === null ? 'nothing paid yet' : `${p.averageDaysToPay} days on average (terms: ${p.paymentTermsDays})` },
      { fact: 'Contribution after all of it', value: `${inr(p.contribution)} (${p.contributionPct}%)` },
    ];
    if (Number(p.crateLossesAbsorbed)) evidence.push({ fact: 'Crates lost and written off', value: inr(p.crateLossesAbsorbed) });
    const creditForm = advice.lever === 'payment_terms';
    const proposed = creditForm ? { financeChargeRateMonthly: advice.proposal.financeChargeRateMonthly, financeChargeGraceDays: Math.max(t.grace, 3) } : {};
    drafts.push({
      type: 'customer_terms',
      subjectKind: 'customer',
      subjectId: p.customerId,
      targetDate: null,
      title:
        advice.lever === 'payment_terms'
          ? `Charge ${p.name} for late payment`
          : advice.lever === 'price'
            ? `Review ${p.name}'s prices`
            : `Set a minimum order for ${p.name}`,
      proposal: {
        action: creditForm ? 'credit_terms' : 'review_customer',
        customerId: p.customerId,
        customerVersion: t.version,
        lever: advice.lever,
        current: { creditLimit: t.creditLimit, paymentTermsDays: t.paymentTermsDays, financeChargeRateMonthly: t.rate, financeChargeGraceDays: t.grace },
        proposed,
        compare: proposed,
      },
      evidence,
      explanation:
        `Over the last 90 days ${p.name} left ${inr(p.contribution)} (${p.contributionPct}% of ${inr(p.revenue)}) after goods, delivery, waiting for payment and lost crates — ` +
        `below your ${min}% floor. The biggest cause: ${advice.why}.` +
        (creditForm ? ` A ${advice.proposal.financeChargeRateMonthly}% monthly charge on overdue invoices would cover the cost of waiting.` : ''),
      expectedImpact: subtractMoney(fromCents((toCents(p.revenue) * BigInt(Math.round(min * 100))) / 10_000n), p.contribution),
      confidence: p.invoices >= 8 ? 'solid' : 'rough_guide',
      sensitive: false,
      producer: 'baseline:customer-terms@1',
      expiresAt: ctx.endOf(addDays(ctx.today, 6)),
    });
  }
  return drafts;
}

// ---- 5. Exceptions ("worth a look") ----

export async function exceptions(ctx: ProducerContext): Promise<Draft[]> {
  const drafts: Draft[] = [];
  const expires = ctx.endOf(addDays(ctx.today, 13));
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const base = { type: 'exception' as const, targetDate: null, expiresAt: expires, expectedImpact: null as string | null };

  // Cash short on trip reconciliations: one trip far off, or a driver short again and again.
  const recs = await ctx.data.reconciliations(ctx.client, new Date(ctx.now.getTime() - 90 * 86_400_000));
  for (const { item, z } of highOutliers(recs, (r) => Number(r.variance), 3.5, 8)) {
    if (Number(item.variance) < 200) continue;
    drafts.push({
      ...base,
      subjectKind: 'trip',
      subjectId: item.trip_id,
      title: `A trip came back ${inr(item.variance)} short`,
      proposal: { action: 'review', link: { kind: 'trip', id: item.trip_id } },
      evidence: [
        { fact: 'Short on reconciliation', value: `${inr(item.variance)} on ${day(item.reconciled_at)}`, source: { kind: 'trip', ids: [item.trip_id] } },
        { fact: 'Typical difference, last 90 days', value: inr(median(recs.map((r) => Number(r.variance)))) },
        { fact: 'How unusual', value: `${z.toFixed(1)} on a robust scale where 3.5 is the line` },
      ],
      explanation: `This trip's cash came back ${inr(item.variance)} short, far more than usual for your trips. It is worth checking the trip's expenses and collections; there may be a simple explanation.`,
      expectedImpact: item.variance,
      confidence: recs.length >= 20 ? 'solid' : 'rough_guide',
      sensitive: true,
      producer: 'baseline:cash-variance@1',
    });
  }
  const byDriver = new Map<string, typeof recs>();
  for (const r of recs) byDriver.set(r.driver_id, [...(byDriver.get(r.driver_id) ?? []), r]);
  for (const [driverId, list] of byDriver) {
    const short = list.filter((r) => Number(r.variance) > 0);
    const total = sumMoney(short.map((r) => r.variance));
    if (list.length < 5 || short.length / list.length < 0.6 || Number(total) < 500) continue;
    drafts.push({
      ...base,
      subjectKind: 'employee',
      subjectId: driverId,
      title: `${list[0].driver_name}'s trips often come back short`,
      proposal: { action: 'review', link: { kind: 'employee', id: driverId } },
      evidence: [
        { fact: 'Trips reconciled, last 90 days', value: String(list.length), source: { kind: 'trips', ids: list.map((r) => r.trip_id) } },
        { fact: 'Came back short', value: `${short.length} (${Math.round((short.length / list.length) * 100)}%), ${inr(total)} in all` },
      ],
      explanation: `${short.length} of ${list.length} trips reconciled in the last 90 days came back short, ${inr(total)} in all. A pattern like this is worth a conversation about how trip cash is counted; it is not a finding of wrongdoing.`,
      expectedImpact: total,
      confidence: 'rough_guide',
      sensitive: true,
      producer: 'baseline:cash-pattern@1',
    });
  }

  // Invoiced below the cost of the lots that filled the line.
  for (const s of await ctx.data.salesBelowCost(ctx.client, new Date(ctx.now.getTime() - 30 * 86_400_000))) {
    const loss = multiplyToMoney(s.quantity as string, subtractMoney(s.unit_cost as string, s.unit_price as string));
    drafts.push({
      ...base,
      subjectKind: 'invoice',
      subjectId: s.invoice_id as string,
      title: `${s.invoice_number} sold ${s.description} below cost`,
      proposal: { action: 'review', link: { kind: 'invoice', id: s.invoice_id } },
      evidence: [
        { fact: 'Price charged', value: `${inr(s.unit_price as string)} × ${s.quantity}`, source: { kind: 'invoice', ids: [s.invoice_id as string] } },
        { fact: 'Cost of the lots delivered', value: inr(s.unit_cost as string), source: { kind: 'lots' } },
        { fact: 'Lost on the line', value: inr(loss) },
      ],
      explanation: `${s.customer_name} was invoiced ${inr(s.unit_price as string)} for ${s.description}, below the ${inr(s.unit_cost as string)} the lots cost — ${inr(loss)} lost on the line. Check the price agreed on the order.`,
      expectedImpact: loss,
      confidence: 'solid',
      sensitive: false,
      producer: 'baseline:below-cost@1',
    });
  }

  // Trip expenses far above others in their category.
  const expenses = await ctx.data.tripExpenses(ctx.client, new Date(ctx.now.getTime() - 60 * 86_400_000));
  const byCategory = new Map<string, typeof expenses>();
  for (const x of expenses) byCategory.set(x.category, [...(byCategory.get(x.category) ?? []), x]);
  for (const [category, list] of byCategory) {
    for (const { item, z } of highOutliers(list, (x) => Number(x.amount), 4, 8)) {
      if (Number(item.amount) < 300) continue;
      drafts.push({
        ...base,
        subjectKind: 'trip',
        subjectId: item.trip_id,
        title: `An unusually large ${category} expense on ${item.registration_number}`,
        proposal: { action: 'review', link: { kind: 'trip', id: item.trip_id } },
        evidence: [
          { fact: 'Recorded', value: `${inr(item.amount)} on ${day(item.recorded_at)}`, source: { kind: 'trip', ids: [item.trip_id] } },
          { fact: `Typical ${category} expense, last 60 days`, value: `${inr(median(list.map((x) => Number(x.amount))))} over ${list.length}` },
          { fact: 'How unusual', value: `${z.toFixed(1)} on a robust scale where 4 is the line` },
        ],
        explanation: `A ${category} expense of ${inr(item.amount)} on ${item.registration_number} is far above the usual ${inr(median(list.map((x) => Number(x.amount))))}. Worth checking the receipt.`,
        expectedImpact: item.amount,
        confidence: 'rough_guide',
        sensitive: false,
        producer: 'baseline:expense-outlier@1',
      });
    }
  }

  // Fuel economy well below the vehicle's own normal.
  const fills = await ctx.data.fuelFills(ctx.client, ctx.today);
  const byVehicle = new Map<string, typeof fills>();
  for (const f of fills) byVehicle.set(f.vehicle_id, [...(byVehicle.get(f.vehicle_id) ?? []), f]);
  for (const [vehicleId, list] of byVehicle) {
    const kmpl = list.slice(1).map((f, i) => ({ fill: f, value: (f.odometer_km - list[i].odometer_km) / Number(f.litres) })).filter((x) => x.value > 0);
    if (kmpl.length < 5) continue;
    const latest = kmpl[kmpl.length - 1];
    const normal = median(kmpl.slice(0, -1).map((x) => x.value));
    if (latest.value >= normal * 0.7) continue;
    drafts.push({
      ...base,
      subjectKind: 'vehicle',
      subjectId: vehicleId,
      title: `${list[0].registration_number} did ${latest.value.toFixed(1)} km/L on its last fill`,
      proposal: { action: 'review', link: { kind: 'vehicle', id: vehicleId } },
      evidence: [
        { fact: 'Last fill', value: `${latest.value.toFixed(1)} km/L on ${latest.fill.filled_on}`, source: { kind: 'fuel', ids: [latest.fill.id] } },
        { fact: 'Its usual', value: `${normal.toFixed(1)} km/L over ${kmpl.length - 1} fills` },
      ],
      explanation: `${list[0].registration_number} managed ${latest.value.toFixed(1)} km/L on its last fill against its usual ${normal.toFixed(1)}. A wrong odometer entry, a fuel leak or a vehicle that needs a service all look like this.`,
      expectedImpact: null,
      confidence: 'rough_guide',
      sensitive: false,
      producer: 'baseline:fuel-economy@1',
    });
  }

  // Spoilage spike: the last week well above the 8 weeks before.
  const products = new Map((await ctx.data.products(ctx.client)).map((p) => [p.id, p]));
  for (const w of await ctx.data.shrinkWindows(ctx.client, ctx.now)) {
    const p = products.get(w.product_id);
    if (!p || w.recent_accepted <= 0 || w.recent_lost < 10) continue;
    const recent = w.recent_lost / w.recent_accepted;
    const before = w.base_accepted > 0 ? w.base_lost / w.base_accepted : 0;
    if (recent < before * 2 || recent - before < 0.05) continue;
    drafts.push({
      ...base,
      subjectKind: 'product',
      subjectId: w.product_id,
      title: `${p.name} spoilage jumped to ${pct(recent)} this week`,
      proposal: { action: 'review', link: { kind: 'product', id: w.product_id } },
      evidence: [
        { fact: 'Lost in the last 7 days', value: `${qty(w.recent_lost, p.uom)} of ${qty(w.recent_accepted, p.uom)} accepted (${pct(recent)})`, source: { kind: 'shrinkage', ids: [w.product_id] } },
        { fact: 'The 8 weeks before', value: pct(before) },
      ],
      explanation: `${pct(recent)} of the ${p.name} accepted this week has been written off or rejected, against ${pct(before)} before. Worth checking storage, a supplier's quality, or how much is being bought.`,
      expectedImpact: null,
      confidence: 'rough_guide',
      sensitive: false,
      producer: 'baseline:shrink-spike@1',
    });
  }

  // Payments that keep bouncing.
  for (const r of await ctx.data.paymentReversals(ctx.client, new Date(ctx.now.getTime() - 90 * 86_400_000))) {
    if (r.n < 2) continue;
    drafts.push({
      ...base,
      subjectKind: 'customer',
      subjectId: r.customer_id,
      title: `${r.n} payments from ${r.customer_name} reversed in 90 days`,
      proposal: { action: 'review', link: { kind: 'customer', id: r.customer_id } },
      evidence: [{ fact: 'Reversed payments', value: `${r.n}, ${inr(r.amount)} in all, the last on ${day(r.last_at)}`, source: { kind: 'payments', label: r.customer_name } }],
      explanation: `${r.n} payments from ${r.customer_name}, ${inr(r.amount)} in all, were reversed in the last 90 days. Consider asking for cash or UPI until cheques clear.`,
      expectedImpact: r.amount,
      confidence: 'solid',
      sensitive: false,
      producer: 'baseline:bounced-payments@1',
    });
  }
  return drafts;
}
