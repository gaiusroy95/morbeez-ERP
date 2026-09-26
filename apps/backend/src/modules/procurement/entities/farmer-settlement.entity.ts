export type SettlementMethod = 'cash' | 'bank_transfer' | 'upi' | 'cheque';

export interface FarmerSettlementRecord {
  id: string;
  tenantId: string;
  lotId: string;
  farmerId: string;
  amount: string; // numeric as string — Constitution III.2
  method: SettlementMethod;
  notes: string | null;
  settledBy: string;
  settledAt: Date;
}
