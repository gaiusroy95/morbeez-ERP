// The Tax context's views: settings, the parties' and products' tax
// details, the GST invoice register and returns data, the TDS register,
// and e-invoice status. Money is a decimal string (Constitution III.2).
// Mirrored in packages/shared-types/src/tax.
import type {
  DeducteeType,
  DocumentType,
  GstRateRule,
  LineTaxability,
  TaxProfile,
  TdsSection,
} from '../../tax-rules/entities/tax-rules.entity';

export type { DeducteeType, DocumentType, GstRateRule, LineTaxability, TaxProfile, TdsSection };

export interface TaxReference {
  states: { code: string; name: string }[];
  uqc: Record<string, string>; // our unit → GST unit quantity code
}

export type RuleSource = 'default' | 'tenant';

export interface GstRateView extends GstRateRule {
  source: RuleSource;
  inForce: boolean; // effective today
}

export interface TdsSectionView extends TdsSection {
  source: RuleSource;
  inForce: boolean;
}

export interface ProductTaxRow {
  productId: string;
  name: string;
  baseUom: string;
  uqc: string;
  status: 'active' | 'archived';
  hsnCode: string | null;
  rule: GstRateRule | null; // the rule that would apply today
  version: number; // 0 = no tax details yet
}

export interface CustomerTaxRow {
  customerId: string;
  name: string;
  status: 'active' | 'archived';
  gstin: string | null;
  legalName: string | null;
  stateCode: string | null;
  addressLine1: string | null;
  city: string | null;
  pincode: string | null;
  version: number;
}

export interface FarmerTaxRow {
  farmerId: string;
  name: string;
  status: 'active' | 'archived';
  pan: string | null;
  deducteeType: DeducteeType; // what applies now, derived from the PAN unless set
  deducteeTypeSet: boolean;
  tdsExempt: boolean;
  exemptReason: string | null;
  purchasesThisYear: string;
  tdsThisYear: string;
  version: number;
}

export type EinvoiceStatus = 'not_applicable' | 'missing_data' | 'ready' | 'registered' | 'cancelled';

export interface EinvoiceState {
  status: EinvoiceStatus;
  issues: string[]; // why it's not applicable, or what's missing
  irn: string | null;
  ackNo: string | null;
  ackDate: Date | null;
  reportBy: string | null; // last date to register, when the tenant has a reporting window
  cancellableUntil: Date | null;
}

export interface TaxInvoiceRow {
  invoiceId: string;
  invoiceNumber: string;
  issuedOn: string;
  customerId: string;
  customerName: string;
  buyerGstin: string | null;
  documentType: DocumentType;
  placeOfSupply: string | null;
  intraState: boolean;
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  cess: string;
  total: string;
  unclassifiedLines: number;
  einvoice: EinvoiceState;
}

export interface RateBucket {
  rate: string;
  taxableValue: string;
  igst: string;
  cgst: string;
  sgst: string;
  cess: string;
}

export interface Gstr1 {
  currency: string;
  from: string;
  to: string;
  supplierGstin: string | null;
  registrationType: TaxProfile['registrationType'];
  b2b: {
    buyerGstin: string;
    buyerName: string;
    invoiceNumber: string;
    issuedOn: string;
    invoiceValue: string;
    placeOfSupply: string;
    rates: RateBucket[];
  }[];
  b2cl: { invoiceNumber: string; issuedOn: string; invoiceValue: string; placeOfSupply: string; rates: RateBucket[] }[];
  b2cs: { placeOfSupply: string; intraState: boolean; rate: string; taxableValue: string; igst: string; cgst: string; sgst: string; cess: string }[];
  nil: {
    description: string; // e.g. "Intra-state supplies to registered persons"
    nilRated: string;
    exempt: string;
    nonGst: string;
  }[];
  hsn: {
    b2b: HsnSummaryRow[];
    b2c: HsnSummaryRow[];
  };
  documents: { series: string; from: string | null; to: string | null; issued: number; cancelled: number };
  issues: string[];
}

export interface HsnSummaryRow {
  hsnCode: string | null;
  uqc: string;
  rate: string;
  quantity: string;
  totalValue: string;
  taxableValue: string;
  igst: string;
  cgst: string;
  sgst: string;
  cess: string;
}

export interface Gstr3b {
  currency: string;
  from: string;
  to: string;
  outwardTaxable: { taxableValue: string; igst: string; cgst: string; sgst: string; cess: string };
  outwardNilExempt: string;
  outwardNonGst: string;
  interStateToUnregistered: { placeOfSupply: string; taxableValue: string; igst: string }[];
  taxPayable: { igst: string; cgst: string; sgst: string; cess: string };
  notes: string[];
}

export interface TdsDeductionRow {
  id: string;
  sectionCode: string;
  payeeName: string;
  payeePan: string | null;
  deducteeType: DeducteeType;
  deductedOn: string;
  grossAmount: string;
  baseAmount: string;
  rate: string;
  tdsAmount: string;
  depositDueBy: string;
  challanId: string | null;
  challan: { bsrCode: string; challanSerial: string; paidOn: string } | null;
  sourceType: string;
}

export interface TdsChallanRow {
  id: string;
  sectionCode: string;
  taxAmount: string;
  interest: string;
  paidOn: string;
  bsrCode: string;
  challanSerial: string;
  paidFrom: 'bank' | 'cash_on_hand';
  deductions: number;
}

export interface TdsRegister {
  currency: string;
  financialYear: string;
  quarter: 1 | 2 | 3 | 4;
  from: string;
  to: string;
  tan: string | null;
  deductions: TdsDeductionRow[];
  bySection: { sectionCode: string; deductions: number; baseAmount: string; tdsAmount: string; deposited: string; pending: string }[];
  challans: TdsChallanRow[];
  pendingDeposit: string;
  overdue: { sectionCode: string; amount: string; dueBy: string }[];
}
