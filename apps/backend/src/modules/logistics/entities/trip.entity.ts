// planned -> in_progress -> completed -> reconciled, or cancelled from
// planned/in_progress. 'completed' is the driver submitting the trip
// ("completed, awaiting owner reconciliation") and requires every stop to
// be completed/skipped first. From there only the owner moves it on: closes
// it ('reconciled', which requires a TripReconciliationRecord), puts it on
// hold ('on_hold'), or returns it to the driver ('in_progress' again, with
// a review note saying what to fix).
export type TripStatus = 'planned' | 'in_progress' | 'completed' | 'on_hold' | 'cancelled' | 'reconciled';

export interface TripRecord {
  id: string;
  tenantId: string;
  /** "T-20261028-001": the day's running number, per business. */
  number: string;
  /** The route it runs, when planned by route. */
  routeId: string | null;
  vehicleId: string;
  driverEmployeeId: string;
  /** The crew beside the driver. */
  packerEmployeeId: string | null;
  loaderEmployeeId: string | null;
  status: TripStatus;
  plannedDate: string | null; // date as ISO string
  advanceAmount: string; // numeric as string — Constitution III.2
  startedAt: Date | null;
  /** The odometer when the day started (driver app Start Day), and where the phone was. */
  openingKm: string | null;
  startLatitude: string | null;
  startLongitude: string | null;
  /** Start Trip in the driver app (D3): when the delivery run set off. */
  deliveryStartedAt: Date | null;
  /** Return (D4): the odometer when the vehicle was back, and when; trip KM = closing − opening. */
  closingKm: string | null;
  returnedAt: Date | null;
  completedAt: Date | null;
  /** Who submitted the trip for reconciliation, and the cash they said they were handing over. */
  submittedBy: string | null;
  cashDeclared: string | null;
  submitNote: string | null;
  /** The owner's note: why it's on hold, or what the driver must correct. */
  reviewNote: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}
