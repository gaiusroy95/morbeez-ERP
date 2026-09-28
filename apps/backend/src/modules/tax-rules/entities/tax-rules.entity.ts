// The tax rules engine's inputs and results. Money is a decimal string
// (Constitution III.2); rates are percentages as strings ("18.00").

export type RegistrationType = 'regular' | 'composition' | 'unregistered';
export type Taxability = 'taxable' | 'nil_rated' | 'exempt' | 'non_gst';
export type LineTaxability = Taxability | 'unclassified' | 'not_registered';
export type DocumentType = 'tax_invoice' | 'bill_of_supply' | 'invoice';
export type DeducteeType = 'individual_huf' | 'other' | 'no_pan';
export type TdsBasis = 'excess_over_annual' | 'full_once_crossed';

export interface TaxProfile {
  registrationType: RegistrationType;
  gstin: string | null;
  legalName: string | null;
  tradeName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  pincode: string | null;
  stateCode: string | null;
  pan: string | null;
  tan: string | null;
  hsnMinDigits: 4 | 6 | 8;
  b2clThreshold: string;
  einvoiceEnabled: boolean;
  einvoiceReportWithinDays: number | null;
  farmerTdsSection: string | null;
  version: number; // 0 = never saved; defaults in force
}

export interface GstRateRule {
  id: string;
  tenantId: string | null; // null = system default
  hsnCode: string;
  description: string;
  supplyKind: 'goods' | 'services';
  taxability: Taxability;
  rate: string;
  cessRate: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface TdsSection {
  id: string;
  tenantId: string | null;
  code: string;
  description: string;
  rateIndividual: string;
  rateOther: string;
  rateNoPan: string;
  singleThreshold: string | null;
  annualThreshold: string | null;
  basis: TdsBasis;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface InvoiceLineTaxInput {
  productId: string | null;
  taxableValue: string; // the line amount before GST
}

export interface LineTax {
  hsnCode: string | null;
  uqc: string;
  taxability: LineTaxability;
  gstRate: string;
  cessRate: string;
  ruleId: string | null;
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  cess: string;
  total: string;
}

export interface InvoiceTax {
  documentType: DocumentType;
  registrationType: RegistrationType;
  supplierGstin: string | null;
  supplierState: string | null;
  buyerGstin: string | null;
  buyerLegalName: string | null;
  buyerAddressLine1: string | null;
  buyerCity: string | null;
  buyerPincode: string | null;
  placeOfSupply: string | null;
  intraState: boolean;
  lines: LineTax[];
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  cess: string;
  total: string;
}

export interface TdsAssessment {
  section: TdsSection;
  payeeName: string;
  deducteeType: DeducteeType;
  pan: string | null;
  rate: string;
  baseAmount: string;
  tdsAmount: string;
}
