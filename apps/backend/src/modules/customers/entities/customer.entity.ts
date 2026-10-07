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
  status: CustomerStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}
