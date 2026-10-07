/**
 * What a delivery line settles at, and what was lost on the way (client Q&A,
 * live chicken and eggs):
 *
 * - live birds: the farm weight left on the vehicle; when the customer's
 *   scale is used, its weight is what they're invoiced for, and the
 *   difference is transit shrinkage:
 *     shrinkage % = (farm net − customer net) ÷ farm net × 100
 * - eggs: what left, less the eggs broken on the way, is what's invoiced;
 *   the broken ones are breakage.
 *
 * Above the owner's tolerance it's an exception for them to look at; either
 * way both figures are kept. Quantities are 3-dp decimal strings, worked in
 * integer thousandths so no step goes through a float.
 */
export type MeasureKind = 'weighment' | 'breakage';

export interface LineMeasure {
  kind: MeasureKind;
  dispatched: string;
  settled: string;
  loss: string;
  /** Of what was dispatched, 2 dp; negative when the customer's scale read heavier. */
  lossPct: string;
  tolerancePct: string;
  withinTolerance: boolean;
}

const toMilli = (q: string | number): bigint => {
  const [whole, frac = ''] = String(q).replace('-', '').split('.');
  const v = BigInt(whole || '0') * 1000n + BigInt((frac + '000').slice(0, 3));
  return String(q).startsWith('-') ? -v : v;
};
const fromMilli = (m: bigint): string => {
  const neg = m < 0n;
  const a = neg ? -m : m;
  return `${neg ? '-' : ''}${a / 1000n}.${(a % 1000n).toString().padStart(3, '0')}`;
};

/** Hundredths of a percent of [part] in [whole], rounded half away from zero. */
function pct(part: bigint, whole: bigint): string {
  const scaled = part * 10_000n; // percent × 100
  const q = scaled / whole;
  const r = scaled % whole;
  const rounded = (r < 0n ? -r : r) * 2n >= whole ? q + (scaled < 0n ? -1n : 1n) : q;
  const neg = rounded < 0n;
  const a = neg ? -rounded : rounded;
  return `${neg ? '-' : ''}${a / 100n}.${(a % 100n).toString().padStart(2, '0')}`;
}

export function measureLine(input: {
  kind: MeasureKind;
  dispatched: string;
  /** weighment: the customer's net weight; breakage: how many broke. */
  entered: number;
  tolerancePct: string;
}): LineMeasure {
  const dispatched = toMilli(input.dispatched);
  if (dispatched <= 0n) throw new Error('Nothing was dispatched on this line');
  const entered = toMilli(input.entered);
  if (entered < 0n) throw new Error('A weight or count is never negative');
  const settled = input.kind === 'weighment' ? entered : dispatched - entered;
  if (settled < 0n) throw new Error('More broke than was dispatched');
  const loss = dispatched - settled;
  const lossPct = pct(loss, dispatched);
  return {
    kind: input.kind,
    dispatched: fromMilli(dispatched),
    settled: fromMilli(settled),
    loss: fromMilli(loss),
    lossPct,
    tolerancePct: input.tolerancePct,
    // Hundredths of a percent compared exactly.
    withinTolerance: toMilli(lossPct) <= toMilli(input.tolerancePct),
  };
}
