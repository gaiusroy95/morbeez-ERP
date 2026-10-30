// A backhaul (driver app D5; client spec §16–§17): a fixed-rent transport
// job on the way back, after the last delivery — no product, no kilos, no
// stock. Offered by the owner (the driver accepts or skips it) or added by
// the driver (accepted as it's added); then pickup reached → loaded → drop
// reached → completed, and paid.
export type BackhaulStatus = 'offered' | 'accepted' | 'skipped' | 'cancelled' | 'completed';
export type BackhaulStep = 'pickup_reached' | 'loaded' | 'drop_reached' | 'completed';
export type BackhaulPaymentMethod = 'cash' | 'upi' | 'bank_transfer';
export type BackhaulPhotoType = 'load' | 'drop' | 'payment';

export interface BackhaulPayment {
  method: BackhaulPaymentMethod;
  amount: string;
  reference: string | null;
  note: string | null;
  paidAt: Date;
}

export interface BackhaulRecord {
  id: string;
  tripId: string;
  pickupPlace: string;
  dropPlace: string;
  rent: string;
  /** Who hired the vehicle, when known. */
  hirerName: string | null;
  notes: string | null;
  offeredBy: 'owner' | 'driver';
  status: BackhaulStatus;
  skipReason: string | null;
  acceptedAt: Date | null;
  pickupReachedAt: Date | null;
  loadedAt: Date | null;
  dropReachedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  payment: BackhaulPayment | null;
  /** How many photos of each kind have reached the server. */
  photos: Record<BackhaulPhotoType, number>;
  createdAt: Date;
  version: number;
}

export interface BackhaulPhotoRecord {
  id: string;
  backhaulId: string;
  photoType: BackhaulPhotoType;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  takenAt: Date;
  createdBy: string;
}
