import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { UQC } from '../../../common/india';
import {
  DeducteeType,
  GstRateRule,
  InvoiceTax,
  TaxProfile,
  TdsSection,
} from '../entities/tax-rules.entity';

interface ProfileRow {
  registration_type: TaxProfile['registrationType'];
  gstin: string | null;
  legal_name: string | null;
  trade_name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  pincode: string | null;
  state_code: string | null;
  pan: string | null;
  tan: string | null;
  hsn_min_digits: 4 | 6 | 8;
  b2cl_threshold: string;
  einvoice_enabled: boolean;
  einvoice_report_within_days: number | null;
  farmer_tds_section: string | null;
  version: number;
}

export const DEFAULT_PROFILE: TaxProfile = {
  registrationType: 'unregistered',
  gstin: null,
  legalName: null,
  tradeName: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  pincode: null,
  stateCode: null,
  pan: null,
  tan: null,
  hsnMinDigits: 4,
  b2clThreshold: '100000.00',
  einvoiceEnabled: false,
  einvoiceReportWithinDays: null,
  farmerTdsSection: null,
  version: 0,
};

export function toProfile(row: ProfileRow): TaxProfile {
  return {
    registrationType: row.registration_type,
    gstin: row.gstin,
    legalName: row.legal_name,
    tradeName: row.trade_name,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    pincode: row.pincode,
    stateCode: row.state_code,
    pan: row.pan,
    tan: row.tan,
    hsnMinDigits: row.hsn_min_digits,
    b2clThreshold: row.b2cl_threshold,
    einvoiceEnabled: row.einvoice_enabled,
    einvoiceReportWithinDays: row.einvoice_report_within_days,
    farmerTdsSection: row.farmer_tds_section,
    version: row.version,
  };
}

export const GST_RULE_COLUMNS = `r.id, r.tenant_id, r.hsn_code, r.description, r.supply_kind, r.taxability,
  r.rate::text AS rate, r.cess_rate::text AS cess_rate, r.effective_from::text AS effective_from, r.effective_to::text AS effective_to`;

export function toGstRule(row: Record<string, unknown>): GstRateRule {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string | null,
    hsnCode: row.hsn_code as string,
    description: row.description as string,
    supplyKind: row.supply_kind as GstRateRule['supplyKind'],
    taxability: row.taxability as GstRateRule['taxability'],
    rate: row.rate as string,
    cessRate: row.cess_rate as string,
    effectiveFrom: row.effective_from as string,
    effectiveTo: row.effective_to as string | null,
  };
}

export const TDS_SECTION_COLUMNS = `s.id, s.tenant_id, s.code, s.description, s.rate_individual::text AS rate_individual,
  s.rate_other::text AS rate_other, s.rate_no_pan::text AS rate_no_pan, s.single_threshold::text AS single_threshold,
  s.annual_threshold::text AS annual_threshold, s.basis, s.effective_from::text AS effective_from, s.effective_to::text AS effective_to`;

export function toTdsSection(row: Record<string, unknown>): TdsSection {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string | null,
    code: row.code as string,
    description: row.description as string,
    rateIndividual: row.rate_individual as string,
    rateOther: row.rate_other as string,
    rateNoPan: row.rate_no_pan as string,
    singleThreshold: row.single_threshold as string | null,
    annualThreshold: row.annual_threshold as string | null,
    basis: row.basis as TdsSection['basis'],
    effectiveFrom: row.effective_from as string,
    effectiveTo: row.effective_to as string | null,
  };
}

export interface ResolvedLine {
  hsn_code: string | null;
  base_uom: string | null;
  rule: GstRateRule | null;
}

/**
 * The rules engine's own reads and writes, in the tax schema. It reads
 * one thing outside it — a product's unit, for the quantity code — and
 * everything else it's handed by the caller. RLS scopes every statement;
 * the client always comes from the caller's withTenant transaction.
 */
@Injectable()
export class TaxRulesRepository {
  async profile(client: PoolClient): Promise<TaxProfile | null> {
    const result = await client.query<ProfileRow>(
      `SELECT registration_type, gstin, legal_name, trade_name, address_line1, address_line2, city, pincode, state_code,
              pan, tan, hsn_min_digits, b2cl_threshold::text AS b2cl_threshold, einvoice_enabled,
              einvoice_report_within_days, farmer_tds_section, version
       FROM tax.tax_profile WHERE tenant_id = current_tenant_id()`,
    );
    return result.rows[0] ? toProfile(result.rows[0]) : null;
  }

  /**
   * For each product: its HSN, its unit, and the GST rule in force on
   * `date` — the longest HSN prefix that matches wins, and at the same
   * length the tenant's own rule wins over the system default.
   */
  async resolveProducts(
    client: PoolClient,
    productIds: (string | null)[],
    date: string,
    hsnOverrides: (string | null)[] = [],
  ): Promise<ResolvedLine[]> {
    const overrides = productIds.map((_, i) => hsnOverrides[i] ?? null);
    const result = await client.query<Record<string, unknown>>(
      `SELECT COALESCE(l.hsn, pt.hsn_code) AS product_hsn, CASE WHEN l.hsn IS NOT NULL THEN 'unit' ELSE p.base_uom END AS base_uom, rule.*
       FROM unnest($1::uuid[], $3::text[]) WITH ORDINALITY AS l(product_id, hsn, n)
       LEFT JOIN trading_partners.product p ON p.id = l.product_id
       LEFT JOIN tax.product_tax pt ON pt.product_id = l.product_id
       LEFT JOIN LATERAL (
         SELECT ${GST_RULE_COLUMNS}
         FROM tax.gst_rate r
         WHERE COALESCE(l.hsn, pt.hsn_code) IS NOT NULL
           AND COALESCE(l.hsn, pt.hsn_code) LIKE r.hsn_code || '%'
           AND r.effective_from <= $2::date
           AND (r.effective_to IS NULL OR r.effective_to >= $2::date)
         ORDER BY length(r.hsn_code) DESC, (r.tenant_id IS NOT NULL) DESC, r.effective_from DESC
         LIMIT 1
       ) rule ON true
       ORDER BY l.n`,
      [productIds, date, overrides],
    );
    return result.rows.map((row) => ({
      // Aliased: the rule's own hsn_code (a shorter prefix) would shadow it.
      hsn_code: row.product_hsn as string | null,
      base_uom: row.base_uom as string | null,
      rule: row.id ? toGstRule(row) : null,
    }));
  }

  async customerTax(
    client: PoolClient,
    customerId: string,
  ): Promise<{ gstin: string | null; legal_name: string | null; state_code: string; address_line1: string | null; city: string | null; pincode: string | null } | null> {
    const result = await client.query(
      'SELECT gstin, legal_name, state_code, address_line1, city, pincode FROM tax.customer_tax WHERE customer_id = $1',
      [customerId],
    );
    return result.rows[0] ?? null;
  }

  async farmerTax(
    client: PoolClient,
    farmerId: string,
  ): Promise<{ name: string; pan: string | null; deductee_type: Exclude<DeducteeType, 'no_pan'> | null; tds_exempt: boolean } | null> {
    const result = await client.query(
      `SELECT f.name, ft.pan, ft.deductee_type, COALESCE(ft.tds_exempt, false) AS tds_exempt
       FROM trading_partners.farmer f LEFT JOIN tax.farmer_tax ft ON ft.farmer_id = f.id
       WHERE f.id = $1`,
      [farmerId],
    );
    return result.rows[0] ?? null;
  }

  /** The section in force on `date`; the tenant's own version wins over the default. */
  async tdsSection(client: PoolClient, code: string, date: string): Promise<TdsSection | null> {
    const result = await client.query<Record<string, unknown>>(
      `SELECT ${TDS_SECTION_COLUMNS} FROM tax.tds_section s
       WHERE s.code = $1 AND s.effective_from <= $2::date AND (s.effective_to IS NULL OR s.effective_to >= $2::date)
       ORDER BY (s.tenant_id IS NOT NULL) DESC, s.effective_from DESC
       LIMIT 1`,
      [code, date],
    );
    return result.rows[0] ? toTdsSection(result.rows[0]) : null;
  }

  /** What's already been taxed for this farmer under this section in the financial year. */
  async taxedBaseThisYear(client: PoolClient, farmerId: string, sectionCode: string, fyStart: string, before: string): Promise<string> {
    const result = await client.query<{ base: string }>(
      `SELECT COALESCE(SUM(base_amount), 0)::text AS base FROM tax.tds_deduction
       WHERE farmer_id = $1 AND section_code = $2 AND deducted_on >= $3::date AND deducted_on <= $4::date`,
      [farmerId, sectionCode, fyStart, before],
    );
    return result.rows[0].base;
  }

  async insertInvoiceTax(client: PoolClient, tenantId: string, invoiceId: string, lineIds: string[], tax: InvoiceTax): Promise<void> {
    await client.query(
      `INSERT INTO tax.invoice_tax
         (invoice_id, tenant_id, document_type, registration_type, supplier_gstin, supplier_state, buyer_gstin, buyer_legal_name,
          buyer_address_line1, buyer_city, buyer_pincode, place_of_supply, intra_state, taxable_value, cgst, sgst, igst, cess, total)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [
        invoiceId,
        tenantId,
        tax.documentType,
        tax.registrationType,
        tax.supplierGstin,
        tax.supplierState,
        tax.buyerGstin,
        tax.buyerLegalName,
        tax.buyerAddressLine1,
        tax.buyerCity,
        tax.buyerPincode,
        tax.placeOfSupply,
        tax.intraState,
        tax.taxableValue,
        tax.cgst,
        tax.sgst,
        tax.igst,
        tax.cess,
        tax.total,
      ],
    );
    for (const [i, line] of tax.lines.entries()) {
      await client.query(
        `INSERT INTO tax.invoice_line_tax
           (invoice_line_id, tenant_id, invoice_id, hsn_code, uqc, taxability, gst_rate, cess_rate, rule_id,
            taxable_value, cgst, sgst, igst, cess)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          lineIds[i],
          tenantId,
          invoiceId,
          line.hsnCode,
          line.uqc,
          line.taxability,
          line.gstRate,
          line.cessRate,
          line.ruleId,
          line.taxableValue,
          line.cgst,
          line.sgst,
          line.igst,
          line.cess,
        ],
      );
    }
  }

  async insertDeduction(
    client: PoolClient,
    fields: {
      tenantId: string;
      sectionId: string;
      sectionCode: string;
      farmerId: string | null;
      payeeName: string;
      payeePan: string | null;
      deducteeType: DeducteeType;
      baseAmount: string;
      grossAmount: string;
      rate: string;
      tdsAmount: string;
      deductedOn: string;
      payableId: string | null;
      sourceType: string;
      sourceId: string;
      ledgerEntryId: string | null;
      createdBy: string;
    },
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO tax.tds_deduction
         (tenant_id, section_id, section_code, farmer_id, payee_name, payee_pan, deductee_type, base_amount, gross_amount,
          rate, tds_amount, deducted_on, payable_id, source_type, source_id, ledger_entry_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING id`,
      [
        fields.tenantId,
        fields.sectionId,
        fields.sectionCode,
        fields.farmerId,
        fields.payeeName,
        fields.payeePan,
        fields.deducteeType,
        fields.baseAmount,
        fields.grossAmount,
        fields.rate,
        fields.tdsAmount,
        fields.deductedOn,
        fields.payableId,
        fields.sourceType,
        fields.sourceId,
        fields.ledgerEntryId,
        fields.createdBy,
      ],
    );
    return result.rows[0].id;
  }

  /** The unit code for a product's base unit; OTH for anything unmapped. */
  static uqcFor(baseUom: string | null): string {
    return (baseUom && UQC[baseUom]) || 'OTH';
  }
}
