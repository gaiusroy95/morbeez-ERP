// One per delivery stop — recipientName is always required; signatureData
// is optional because a 'pod'-type TripStopPhoto can satisfy proof on its
// own (LogisticsService requires at least one of the two).
export interface TripStopPodRecord {
  id: string;
  tripStopId: string;
  recipientName: string;
  signatureData: string | null;
  capturedAt: Date;
  capturedBy: string;
}
