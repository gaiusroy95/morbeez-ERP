// A delivery stop's checklist (driver app V1, D3; client spec §11–§14):
// the customer's QR, what was delivered short and why, everything unloaded,
// crates left and taken back. Mirrored in packages/shared-types/src/logistics.

export const SHORTFALL_REASONS = ['customer_took_less', 'damaged', 'not_enough_on_vehicle', 'quality_issue', 'other'] as const;
export type ShortfallReason = (typeof SHORTFALL_REASONS)[number];

export interface DeliveryShortfall {
  orderLineId: string;
  productName: string;
  uom: string;
  ordered: string;
  delivered: string;
  reason: ShortfallReason;
  note: string | null;
}

/** What happened at a completed delivery. */
export interface DeliveryOutcome {
  recipientName: string;
  /** null: delivered before the QR existed, or from the owner app. */
  qrStatus: 'scanned' | 'not_scanned' | null;
  /** Why it wasn't scanned (missing, damaged, …). */
  qrNote: string | null;
  allUnloaded: boolean | null;
  shortfalls: DeliveryShortfall[];
  crates: { dropped: number; collected: number };
}
