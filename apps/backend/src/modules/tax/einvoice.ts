// E-invoice readiness: whether an invoice has to be registered on the
// Invoice Registration Portal (IRP), what's missing if it isn't ready, and
// the JSON the IRP takes (the NIC e-invoice schema, version 1.1). Pure
// functions — no database, no network. Registering with the IRP itself
// (through a GSP/ASP or the portal's bulk tool) happens outside; the IRN
// and acknowledgement that come back are recorded against the invoice.

export interface EinvoiceParty {
  gstin: string | null;
  legalName: string | null;
  tradeName?: string | null;
  addressLine1: string | null;
  addressLine2?: string | null;
  city: string | null;
  pincode: string | null;
  stateCode: string | null;
}

export interface EinvoiceLine {
  description: string;
  hsnCode: string | null;
  uqc: string;
  quantity: string;
  unitPrice: string;
  taxableValue: string;
  taxability: string;
  gstRate: string;
  cessRate: string;
  cgst: string;
  sgst: string;
  igst: string;
  cess: string;
}

export interface EinvoiceSource {
  invoiceNumber: string;
  issuedOn: string; // YYYY-MM-DD, tenant-local
  documentType: 'tax_invoice' | 'bill_of_supply' | 'invoice';
  seller: EinvoiceParty;
  buyer: EinvoiceParty;
  placeOfSupply: string | null;
  lines: EinvoiceLine[];
  totals: { taxableValue: string; cgst: string; sgst: string; igst: string; cess: string; total: string };
}

export interface EinvoiceSettings {
  enabled: boolean;
  hsnMinDigits: number;
}

/** Why this invoice doesn't go to the IRP at all — or null when it does. */
export function notApplicableReason(source: EinvoiceSource, settings: EinvoiceSettings): string | null {
  if (!settings.enabled) return 'E-invoicing is switched off in the tax settings (it applies above the turnover limit).';
  if (source.documentType !== 'tax_invoice') {
    return source.documentType === 'bill_of_supply'
      ? 'A bill of supply (exempt goods only) is not e-invoiced.'
      : 'Issued while not registered for GST.';
  }
  if (!source.buyer.gstin) return 'Sale to an unregistered buyer (B2C) — not e-invoiced.';
  return null;
}

/** What has to be filled in before the IRP will accept it. Empty = ready. */
export function missingData(source: EinvoiceSource, settings: EinvoiceSettings): string[] {
  const issues: string[] = [];
  const need = (value: string | null | undefined, what: string) => {
    if (!value || !value.trim()) issues.push(what);
  };
  need(source.seller.gstin, 'Your GSTIN (Tax settings)');
  need(source.seller.legalName, 'Your legal name (Tax settings)');
  need(source.seller.addressLine1, 'Your address (Tax settings)');
  need(source.seller.city, 'Your city (Tax settings)');
  need(source.seller.pincode, 'Your pincode (Tax settings)');
  need(source.buyer.legalName, "The buyer's legal name (customer's tax details)");
  need(source.buyer.addressLine1, "The buyer's address (customer's tax details)");
  need(source.buyer.city, "The buyer's city (customer's tax details)");
  need(source.buyer.pincode, "The buyer's pincode (customer's tax details)");
  need(source.placeOfSupply, 'The place of supply');
  source.lines.forEach((line, i) => {
    if (line.taxability === 'unclassified') {
      issues.push(`Line ${i + 1} (${line.description}) has no HSN code or GST rule`);
    } else if (!line.hsnCode || line.hsnCode.length < settings.hsnMinDigits) {
      issues.push(`Line ${i + 1} (${line.description}) needs an HSN code of at least ${settings.hsnMinDigits} digits`);
    }
  });
  return issues;
}

const num = (value: string) => Number(value);

/** DD/MM/YYYY, as the schema wants dates. */
function schemaDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * The IRP request body. Amounts are JSON numbers (the schema's type),
 * converted from the exact decimal strings only here, at the edge.
 */
export function buildEinvoiceJson(source: EinvoiceSource): Record<string, unknown> {
  const party = (p: EinvoiceParty) => ({
    Gstin: p.gstin,
    LglNm: p.legalName,
    ...(p.tradeName ? { TrdNm: p.tradeName } : {}),
    Addr1: p.addressLine1,
    ...(p.addressLine2 ? { Addr2: p.addressLine2 } : {}),
    Loc: p.city,
    Pin: p.pincode ? Number(p.pincode) : null,
    Stcd: p.stateCode,
  });
  return {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
    DocDtls: { Typ: 'INV', No: source.invoiceNumber, Dt: schemaDate(source.issuedOn) },
    SellerDtls: party(source.seller),
    BuyerDtls: { ...party(source.buyer), Pos: source.placeOfSupply },
    ItemList: source.lines.map((line, i) => ({
      SlNo: String(i + 1),
      PrdDesc: line.description,
      IsServc: line.hsnCode?.startsWith('99') ? 'Y' : 'N', // SAC codes start 99
      HsnCd: line.hsnCode,
      Qty: num(line.quantity),
      Unit: line.uqc,
      UnitPrice: num(line.unitPrice),
      TotAmt: num(line.taxableValue),
      Discount: 0,
      AssAmt: num(line.taxableValue),
      GstRt: num(line.gstRate),
      IgstAmt: num(line.igst),
      CgstAmt: num(line.cgst),
      SgstAmt: num(line.sgst),
      CesRt: num(line.cessRate),
      CesAmt: num(line.cess),
      CesNonAdvlAmt: 0,
      StateCesRt: 0,
      StateCesAmt: 0,
      StateCesNonAdvlAmt: 0,
      OthChrg: 0,
      TotItemVal: Number(
        (num(line.taxableValue) + num(line.cgst) + num(line.sgst) + num(line.igst) + num(line.cess)).toFixed(2),
      ),
    })),
    ValDtls: {
      AssVal: num(source.totals.taxableValue),
      CgstVal: num(source.totals.cgst),
      SgstVal: num(source.totals.sgst),
      IgstVal: num(source.totals.igst),
      CesVal: num(source.totals.cess),
      StCesVal: 0,
      Discount: 0,
      OthChrg: 0,
      RndOffAmt: 0,
      TotInvVal: num(source.totals.total),
    },
  };
}
