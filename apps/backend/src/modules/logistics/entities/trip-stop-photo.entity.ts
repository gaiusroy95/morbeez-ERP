export type PhotoType = 'pickup' | 'delivery' | 'pod' | 'issue';

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
