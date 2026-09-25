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
  status: CustomerStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}
