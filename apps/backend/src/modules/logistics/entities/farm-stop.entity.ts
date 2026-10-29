// The farmer stop (driver app V1, D2; client spec §5–§8): each product of
// the purchase order accepted — weighed or counted in bags, packed in
// sacks, loaded — or rejected with a reason; the packing crew. Mirrored in
// packages/shared-types/src/logistics.

export const FARM_REJECT_REASONS = ['quality_issue', 'quantity_short', 'damaged', 'farmer_not_ready', 'other'] as const;
export type FarmRejectReason = (typeof FARM_REJECT_REASONS)[number];

export type FarmLineOutcome = 'accepted' | 'rejected';
export type FarmMeasure = 'weight' | 'bags';

export interface FarmStopLine {
  productId: string;
  productName: string;
  uom: string;
  outcome: FarmLineOutcome;
  /** Loaded onto the vehicle, in the product's unit. */
  acceptedQuantity: string;
  /** Weighed and refused (it stayed at the farm); 0 when nothing was weighed. */
  rejectedQuantity: string;
  measuredBy: FarmMeasure;
  sacks: number | null;
  kgPerBag: string | null;
  reason: FarmRejectReason | null;
  note: string | null;
}

export interface CrewMember {
  employeeId: string;
  name: string;
}

/** A worker the driver can pick as packer or loader. */
export interface CrewOption extends CrewMember {
  roleType: string;
}

/** What happened at a completed farm stop. */
export interface FarmStopOutcome {
  packer: CrewMember | null;
  loader: CrewMember | null;
  lines: FarmStopLine[];
  /** The kilos loaded there: what the packer and loader are credited with. */
  loadedKg: string;
}
