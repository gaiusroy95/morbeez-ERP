import { BadRequestException } from '@nestjs/common';
import { fromMilli, toMilli } from '../../common/quantity';
import { FarmLineDto } from './dto/complete-pickup-stop.dto';
import { FarmMeasure, FarmRejectReason } from './entities/farm-stop.entity';

/** A product on the purchase order a farm stop picks up. */
export interface FarmProduct {
  productId: string;
  name: string;
  uom: string;
}

/** A farm stop's line, checked and in the product's unit (3 decimals). */
export interface FarmLine {
  productId: string;
  outcome: 'accepted' | 'rejected';
  acceptedQuantity: string;
  rejectedQuantity: string;
  measuredBy: FarmMeasure;
  sacks: number | null;
  kgPerBag: string | null;
  reason: FarmRejectReason | null;
  note: string | null;
}

/**
 * Checks what the driver sends at hold-to-complete (client spec §8: a farmer
 * can't be completed until every product is accepted — weighed and loaded —
 * or rejected): exactly one line per product of the purchase order; an
 * accepted line has a quantity (or sacks × kg a bag, worked out here, so the
 * phone's arithmetic is never trusted), a rejected one a reason.
 */
export function farmLinesOf(lines: FarmLineDto[], products: FarmProduct[]): FarmLine[] {
  const byId = new Map(products.map((p) => [p.productId, p]));
  const seen = new Set<string>();
  const out: FarmLine[] = [];
  for (const line of lines) {
    const product = byId.get(line.productId);
    if (!product) throw new BadRequestException(`Product ${line.productId} is not on this pickup's purchase order`);
    if (seen.has(line.productId)) throw new BadRequestException(`${product.name} is listed twice`);
    seen.add(line.productId);
    const note = line.note?.trim() || null;
    const rejected = line.rejectedQuantity ? fromMilli(toMilli(String(line.rejectedQuantity))) : '0.000';

    if (line.outcome === 'rejected') {
      if (!line.reason) throw new BadRequestException(`Say why ${product.name} was rejected`);
      if (line.netQuantity) throw new BadRequestException(`${product.name} is rejected: nothing of it is loaded`);
      out.push({ productId: line.productId, outcome: 'rejected', acceptedQuantity: '0.000', rejectedQuantity: rejected, measuredBy: 'weight', sacks: null, kgPerBag: null, reason: line.reason, note });
      continue;
    }

    if (line.reason) throw new BadRequestException(`${product.name} is accepted: a rejection reason doesn't apply`);
    const measuredBy: FarmMeasure = line.measuredBy ?? 'weight';
    let accepted: bigint;
    let kgPerBag: string | null = null;
    if (measuredBy === 'bags') {
      if (product.uom !== 'kg') throw new BadRequestException(`${product.name} is counted in ${product.uom}, not weighed in bags`);
      if (!line.sacks || !line.kgPerBag) throw new BadRequestException(`Counting ${product.name} in bags needs the number of bags and the kg in each`);
      kgPerBag = fromMilli(toMilli(String(line.kgPerBag)));
      accepted = toMilli(kgPerBag) * BigInt(line.sacks);
    } else {
      accepted = line.netQuantity ? toMilli(String(line.netQuantity)) : 0n;
    }
    if (accepted <= 0n) throw new BadRequestException(`How much ${product.name} was loaded? Enter its weight, or reject it`);
    out.push({
      productId: line.productId,
      outcome: 'accepted',
      acceptedQuantity: fromMilli(accepted),
      rejectedQuantity: rejected,
      measuredBy,
      sacks: line.sacks ?? null,
      kgPerBag,
      reason: null,
      note,
    });
  }
  const missing = products.filter((p) => !seen.has(p.productId)).map((p) => p.name);
  if (missing.length > 0) {
    throw new BadRequestException(`Accept or reject every product before completing the farm: ${missing.join(', ')} still open`);
  }
  return out;
}

const REASON_TEXT: Record<FarmRejectReason, string> = {
  quality_issue: 'Quality issue',
  quantity_short: 'Quantity short',
  damaged: 'Damaged',
  farmer_not_ready: 'Farmer not ready',
  other: 'Other',
};

/** "Quality issue: soft, black spots" — for the lot and the owner's alert. */
export function rejectionTextOf(reason: FarmRejectReason, note: string | null): string {
  return note ? `${REASON_TEXT[reason]}: ${note}` : REASON_TEXT[reason];
}

/** The kilos loaded at the stop (grams counted too): what the crew is credited with. */
export function loadedKgOf(lines: FarmLine[], products: FarmProduct[]): string {
  const uom = new Map(products.map((p) => [p.productId, p.uom]));
  let milli = 0n;
  for (const line of lines) {
    if (line.outcome !== 'accepted') continue;
    const unit = uom.get(line.productId);
    if (unit === 'kg') milli += toMilli(line.acceptedQuantity);
    else if (unit === 'g') milli += toMilli(line.acceptedQuantity) / 1000n;
  }
  return fromMilli(milli);
}
