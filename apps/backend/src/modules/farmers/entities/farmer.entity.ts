export type FarmerStatus = 'active' | 'archived';

/** Master Spec §12: when a graded lot's payable falls due. */
export type FarmerPaymentTerms = 'immediate' | 'bill_to_bill' | 'net' | 'custom';

/** The Net terms the spec offers (MS §12); Custom takes any 1–180 days. */
export const FARMER_NET_DAYS = [3, 7, 10, 15, 20, 30, 45, 60] as const;

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
  /** Village or town, shown under the name. */
  place: string | null;
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
  /** Immediate: due the day the lot is graded; Net/Custom: that many days later; Bill-to-Bill: when the next lot is, or after paymentTermsDays if sooner. */
  paymentTerms: FarmerPaymentTerms;
  /** Net, Custom and Bill-to-Bill (its backstop); null for Immediate. */
  paymentTermsDays: number | null;
}
