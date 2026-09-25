export type FarmerStatus = 'active' | 'archived';

export interface FarmerContact {
  phone?: string;
  email?: string;
  notes?: string;
}

export interface BankDetails {
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
}

export interface FarmerRecord {
  id: string;
  tenantId: string;
  name: string;
  contact: FarmerContact;
  // Present only when the caller has bankDetails:read-equivalent access
  // and the repository was asked to decrypt it — never included in a list
  // response (FarmersRepository.list omits it entirely; see its comment).
  bankDetails?: BankDetails | null;
  reliabilityRating: string | null; // numeric as string — Constitution III.2
  status: FarmerStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}
