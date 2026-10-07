/** weighment: the customer's scale, when their weight settles a live-bird sale. */
export type PhotoType = 'pickup' | 'delivery' | 'pod' | 'issue' | 'weighment';

export interface TripStopPhotoRecord {
  id: string;
  tripStopId: string;
  photoType: PhotoType;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  takenAt: Date;
  createdBy: string;
}
