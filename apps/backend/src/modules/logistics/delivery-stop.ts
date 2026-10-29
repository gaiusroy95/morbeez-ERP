import { BadRequestException } from '@nestjs/common';
import { toMilli } from '../../common/quantity';
import { DeliveryLineMeasureDto } from './dto/complete-delivery.dto';
import { ShortfallReason } from './entities/delivery-stop.entity';

/** A line of the order a delivery stop carries. */
export interface DeliveryLine {
  id: string;
  productName: string;
  quantity: string;
}

/** A line delivered short, with why. */
export interface Shortfall {
  orderLineId: string;
  ordered: string;
  delivered: string;
  reason: ShortfallReason;
  note: string | null;
}

const SHORTFALL_TEXT: Record<ShortfallReason, string> = {
  customer_took_less: 'the customer took less',
  damaged: 'damaged',
  not_enough_on_vehicle: 'not enough on the vehicle',
  quality_issue: 'quality issue',
  other: 'other reason',
};

/** "the customer took less" — for the owner's alert. */
export function shortfallTextOf(reason: ShortfallReason): string {
  return SHORTFALL_TEXT[reason];
}

/** The text the printed QR carries: MORBEEZ:C:<token>. */
export const QR_PREFIX = 'MORBEEZ:C:';

/** Whether what was scanned is this customer's QR — the printed text, or the bare token typed in. */
export function qrMatches(scanned: string, token: string): boolean {
  const value = scanned.trim().toUpperCase();
  const bare = value.startsWith(QR_PREFIX) ? value.slice(QR_PREFIX.length) : value;
  return bare.length > 0 && bare === token.trim().toUpperCase();
}

/**
 * The lines delivered short (client spec §13: the delivered quantity may
 * differ from the order, and a shortage needs a reason — never a driver
 * deduction). With [reasonsRequired] (the driver app's delivery checklist),
 * a short line without a reason is refused; otherwise only the ones given a
 * reason are recorded.
 */
export function shortfallsOf(
  lines: DeliveryLine[],
  delivered: Map<string, string>,
  given: DeliveryLineMeasureDto[],
  reasonsRequired: boolean,
): Shortfall[] {
  const why = new Map(given.map((g) => [g.orderLineId, g]));
  const out: Shortfall[] = [];
  for (const line of lines) {
    const left = delivered.get(line.id);
    if (left === undefined || toMilli(left) >= toMilli(line.quantity)) continue;
    const entry = why.get(line.id);
    if (!entry?.shortReason) {
      if (reasonsRequired) throw new BadRequestException(`Say why less ${line.productName} was delivered than ordered`);
      continue;
    }
    out.push({ orderLineId: line.id, ordered: line.quantity, delivered: left, reason: entry.shortReason, note: entry.shortNote?.trim() || null });
  }
  return out;
}
