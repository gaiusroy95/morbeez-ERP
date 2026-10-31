export type DriverRequestKind = 'advance' | 'new_customer' | 'credit_limit';
export type DriverRequestStatus = 'pending' | 'approved' | 'rejected';

/** A customer the driver met on the road, as they described it. */
export interface NewCustomerDetails {
  name: string;
  phone: string | null;
  place: string | null;
  address: string | null;
  language: string | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * What a driver asked the office for from the road (driver app D10): a cash
 * advance, a new customer, a higher credit limit for a customer.
 */
export interface DriverRequest {
  id: string;
  kind: DriverRequestKind;
  status: DriverRequestStatus;
  driverEmployeeId: string;
  driverName: string;
  tripId: string | null;
  tripNumber: string | null;
  /** An advance: how much. A credit limit: the limit asked for. */
  amount: string | null;
  /** A credit limit: whose, and what it is now (read now, not when asked). */
  customerId: string | null;
  customerName: string | null;
  currentCreditLimit: string | null;
  /** A new customer: as the driver described them. */
  newCustomer: NewCustomerDetails | null;
  reason: string;
  requestedAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
  decisionNote: string | null;
  /** What approving it made: the advance, or the new customer. */
  resultRef: string | null;
}
