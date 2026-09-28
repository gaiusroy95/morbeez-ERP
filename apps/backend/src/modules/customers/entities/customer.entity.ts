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
  creditLimit: string; // numeric comes back from pg as a string — never coerce to JS number for money (Constitution III.2)
  paymentTermsDays: number;
  // Credit terms beyond limit and days — Customers owns the policy,
  // Finance executes it. Changed only through updateCreditTerms.
  financeChargeRateMonthly: string; // percent per 30 days on overdue invoices; '0.00' = none
  financeChargeGraceDays: number;
  creditHold: boolean;
  creditHoldReason: string | null;
  status: CustomerStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}
