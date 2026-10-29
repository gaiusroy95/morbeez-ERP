/**
 * weighment: the customer's scale, when their weight settles a live-bird sale;
 * load: the goods loaded at a farm; rejection: why a product was refused there.
 */
export type PhotoType = 'pickup' | 'delivery' | 'pod' | 'issue' | 'weighment' | 'load' | 'rejection';

export interface TripStopPhotoRecord {
  id: string;
  tripStopId: string;
  photoType: PhotoType;
  /** The product it shows (a farm stop's rejection photo). */
  productId: string | null;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  takenAt: Date;
  createdBy: string;
}
