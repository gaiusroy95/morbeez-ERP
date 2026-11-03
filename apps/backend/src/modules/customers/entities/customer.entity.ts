export type CustomerStatus = 'active' | 'archived';

export interface CustomerContact {
  phone?: string;
  email?: string;
  notes?: string;
}

export interface CustomerRecord {
  id: string;
  tenantId: string;
  name: string;
  contact: CustomerContact;
  /** The village or town shown under the name. */
  place: string | null;
  /** Where orders are delivered unless an order says otherwise. */
  address: string | null;
  /** The route the customer is usually delivered on. */
  routeId: string | null;
  /** What statements, reminders and WhatsApp messages go out in; tax invoices stay English. */
  preferredLanguage: string;
  creditLimit: string; // numeric comes back from pg as a string — never coerce to JS number for money (Constitution III.2)
  paymentTermsDays: number;
  // Credit terms beyond limit and days — Customers owns the policy,
  // Finance executes it. Changed only through updateCreditTerms.
  /** Superseded by financeChargeRateAnnual; kept for older clients. */
  financeChargeRateMonthly: string;
  /** Percent a year on overdue invoices, charged per day (÷ 365); '0.00' = none. */
  financeChargeRateAnnual: string;
  financeChargeGraceDays: number;
  creditHold: boolean;
  creditHoldReason: string | null;
  /** The spot sales' walk-in buyer, who pays on the spot and never owes. */
  isWalkIn: boolean;
  /** Asked not to be called by the AI voice agent: AI Calling places no call to them. */
  doNotCall: boolean;
  /** Printed as a QR (MORBEEZ:C:<token>) for the shop; the driver scans it at the door (driver app D3). */
  qrToken: string;
  status: CustomerStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}
