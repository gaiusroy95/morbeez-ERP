import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import {
  GST_RULE_COLUMNS,
  TDS_SECTION_COLUMNS,
  toGstRule,
  toTdsSection,
} from '../../tax-rules/repositories/tax-rules.repository';
import { GstRateRule, TaxProfile, TdsSection } from '../../tax-rules/entities/tax-rules.entity';

export interface Books {
  timezone: string;
  currency: string;
  today: string;
}

export interface InvoiceRegisterRow {
  invoice_id: string;
  invoice_number: string;
  issued_on: string;
  customer_id: string;
  customer_name: string;
  buyer_gstin: string | null;
  document_type: 'tax_invoice' | 'bill_of_supply' | 'invoice';
  place_of_supply: string | null;
  intra_state: boolean;
  taxable_value: string;
  cgst: string;
  sgst: string;
  igst: string;
  cess: string;
  total: string;
  unclassified_lines: number;
  irn: string | null;
  ack_no: string | null;
  ack_date: Date | null;
  einvoice_status: 'active' | 'cancelled' | null;
}

export interface GstLineRow {
  invoice_id: string;
  invoice_number: string;
  issued_on: string;
  customer_name: string;
  buyer_gstin: string | null;
  place_of_supply: string | null;
  intra_state: boolean;
  invoice_total: string;
  taxability: string;
  hsn_code: string | null;
  uqc: string;
  gst_rate: string;
  quantity: string;
  taxable_value: string;
  cgst: string;
  sgst: string;
  igst: string;
  cess: string;
}

export interface DeductionRow {
  id: string;
  section_code: string;
  payee_name: string;
  payee_pan: string | null;
  deductee_type: 'individual_huf' | 'other' | 'no_pan';
  deducted_on: string;
  gross_amount: string;
  base_amount: string;
  rate: string;
  tds_amount: string;
  challan_id: string | null;
  bsr_code: string | null;
  challan_serial: string | null;
  paid_on: string | null;
  source_type: string;
}

/**
 * Tax's reads and writes. Its own tables are in the tax schema; the
 * register and returns read invoices, customers, products, and farmers
 * across schemas as a reporting read model (System Architecture DB.4).
 * RLS scopes every statement; the client always comes from withTenant.
 */
@Injectable()
export class TaxRepository {
  async books(client: PoolClient): Promise<Books> {
    const result = await client.query<Books>(
      `SELECT timezone, currency, (now() AT TIME ZONE timezone)::date::text AS today
       FROM tenant.tenant WHERE id = current_tenant_id()`,
    );
    return result.rows[0];
  }

  // ---- Profile ----

  /** False when someone else saved first (version mismatch). */
  async saveProfile(
    client: PoolClient,
    tenantId: string,
    userId: string,
    version: number,
    p: Omit<TaxProfile, 'version'>,
  ): Promise<boolean> {
    const values = [
      tenantId,
      p.registrationType,
      p.gstin,
      p.legalName,
      p.tradeName,
      p.addressLine1,
      p.addressLine2,
      p.city,
      p.pincode,
      p.stateCode,
      p.pan,
      p.tan,
      p.hsnMinDigits,
      p.b2clThreshold,
      p.einvoiceEnabled,
      p.einvoiceReportWithinDays,
      p.farmerTdsSection,
      userId,
    ];
    if (version === 0) {
      const inserted = await client.query(
        `INSERT INTO tax.tax_profile
           (tenant_id, registration_type, gstin, legal_name, trade_name, address_line1, address_line2, city, pincode,
            state_code, pan, tan, hsn_min_digits, b2cl_threshold, einvoice_enabled, einvoice_report_within_days,
            farmer_tds_section, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         ON CONFLICT (tenant_id) DO NOTHING`,
        values,
      );
      return (inserted.rowCount ?? 0) === 1;
    }
    const updated = await client.query(
      `UPDATE tax.tax_profile SET
         registration_type = $2, gstin = $3, legal_name = $4, trade_name = $5, address_line1 = $6, address_line2 = $7,
         city = $8, pincode = $9, state_code = $10, pan = $11, tan = $12, hsn_min_digits = $13, b2cl_threshold = $14,
         einvoice_enabled = $15, einvoice_report_within_days = $16, farmer_tds_section = $17, updated_by = $18,
         version = version + 1, updated_at = now()
       WHERE tenant_id = $1 AND version = $19`,
      [...values, version],
    );
    return (updated.rowCount ?? 0) === 1;
  }

  // ---- GST rules ----

  async gstRates(client: PoolClient): Promise<GstRateRule[]> {
    const result = await client.query<Record<string, unknown>>(
      `SELECT ${GST_RULE_COLUMNS} FROM tax.gst_rate r ORDER BY r.hsn_code, r.effective_from DESC, (r.tenant_id IS NOT NULL) DESC`,
    );
    return result.rows.map(toGstRule);
  }

  async findGstRate(client: PoolClient, id: string): Promise<GstRateRule | null> {
    const result = await client.query<Record<string, unknown>>(`SELECT ${GST_RULE_COLUMNS} FROM tax.gst_rate r WHERE r.id = $1`, [id]);
    return result.rows[0] ? toGstRule(result.rows[0]) : null;
  }

  async insertGstRate(
    client: PoolClient,
    tenantId: string,
    userId: string,
    r: { hsnCode: string; description: string; supplyKind: string; taxability: string; rate: string; cessRate: string; effectiveFrom: string },
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO tax.gst_rate (tenant_id, hsn_code, description, supply_kind, taxability, rate, cess_rate, effective_from, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [tenantId, r.hsnCode, r.description, r.supplyKind, r.taxability, r.rate, r.cessRate, r.effectiveFrom, userId],
    );
    return result.rows[0].id;
  }

  /** The tenant's own rule for this code still open on `from` — to end the day before a replacement starts. */
  async endOpenTenantRule(client: PoolClient, table: 'gst_rate' | 'tds_section', keyColumn: 'hsn_code' | 'code', key: string, from: string): Promise<void> {
    await client.query(
      `UPDATE tax.${table} SET effective_to = $2::date - 1
       WHERE tenant_id = current_tenant_id() AND ${keyColumn} = $1 AND effective_from < $2::date
         AND (effective_to IS NULL OR effective_to >= $2::date)`,
      [key, from],
    );
  }

  async endRule(client: PoolClient, table: 'gst_rate' | 'tds_section', id: string, effectiveTo: string): Promise<boolean> {
    const result = await client.query(
      `UPDATE tax.${table} SET effective_to = $2 WHERE id = $1 AND tenant_id = current_tenant_id()`,
      [id, effectiveTo],
    );
    return (result.rowCount ?? 0) === 1;
  }

  // ---- TDS sections ----

  async tdsSections(client: PoolClient): Promise<TdsSection[]> {
    const result = await client.query<Record<string, unknown>>(
      `SELECT ${TDS_SECTION_COLUMNS} FROM tax.tds_section s ORDER BY s.code, s.effective_from DESC, (s.tenant_id IS NOT NULL) DESC`,
    );
    return result.rows.map(toTdsSection);
  }

  async findTdsSection(client: PoolClient, id: string): Promise<TdsSection | null> {
    const result = await client.query<Record<string, unknown>>(`SELECT ${TDS_SECTION_COLUMNS} FROM tax.tds_section s WHERE s.id = $1`, [id]);
    return result.rows[0] ? toTdsSection(result.rows[0]) : null;
  }

  async insertTdsSection(
    client: PoolClient,
    tenantId: string,
    userId: string,
    s: {
      code: string;
      description: string;
      rateIndividual: string;
      rateOther: string;
      rateNoPan: string;
      singleThreshold: string | null;
      annualThreshold: string | null;
      basis: string;
      effectiveFrom: string;
    },
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO tax.tds_section
         (tenant_id, code, description, rate_individual, rate_other, rate_no_pan, single_threshold, annual_threshold, basis,
          effective_from, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [
        tenantId,
        s.code,
        s.description,
        s.rateIndividual,
        s.rateOther,
        s.rateNoPan,
        s.singleThreshold,
        s.annualThreshold,
        s.basis,
        s.effectiveFrom,
        userId,
      ],
    );
    return result.rows[0].id;
  }

  // ---- Products, customers, farmers ----

  async productRows(client: PoolClient, today: string): Promise<Record<string, unknown>[]> {
    const result = await client.query(
      `SELECT p.id AS product_id, p.name, p.base_uom, p.status, pt.hsn_code, COALESCE(pt.version, 0) AS version, rule.*
       FROM trading_partners.product p
       LEFT JOIN tax.product_tax pt ON pt.product_id = p.id
       LEFT JOIN LATERAL (
         SELECT ${GST_RULE_COLUMNS} FROM tax.gst_rate r
         WHERE pt.hsn_code IS NOT NULL AND pt.hsn_code LIKE r.hsn_code || '%'
           AND r.effective_from <= $1::date AND (r.effective_to IS NULL OR r.effective_to >= $1::date)
         ORDER BY length(r.hsn_code) DESC, (r.tenant_id IS NOT NULL) DESC, r.effective_from DESC
         LIMIT 1
       ) rule ON true
       ORDER BY p.status, p.name`,
      [today],
    );
    return result.rows;
  }

  async productExists(client: PoolClient, id: string): Promise<boolean> {
    return ((await client.query('SELECT 1 FROM trading_partners.product WHERE id = $1', [id])).rowCount ?? 0) > 0;
  }

  async upsertProductTax(client: PoolClient, tenantId: string, productId: string, hsnCode: string, userId: string): Promise<void> {
    await client.query(
      `INSERT INTO tax.product_tax (product_id, tenant_id, hsn_code, updated_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (product_id) DO UPDATE SET hsn_code = EXCLUDED.hsn_code, updated_by = EXCLUDED.updated_by,
         version = tax.product_tax.version + 1, updated_at = now()`,
      [productId, tenantId, hsnCode, userId],
    );
  }

  async customerRows(client: PoolClient): Promise<Record<string, unknown>[]> {
    const result = await client.query(
      `SELECT c.id AS customer_id, c.name, c.status, ct.gstin, ct.legal_name, ct.state_code, ct.address_line1, ct.city,
              ct.pincode, COALESCE(ct.version, 0) AS version
       FROM trading_partners.customer c LEFT JOIN tax.customer_tax ct ON ct.customer_id = c.id
       ORDER BY c.status, c.name`,
    );
    return result.rows;
  }

  async customerExists(client: PoolClient, id: string): Promise<boolean> {
    return ((await client.query('SELECT 1 FROM trading_partners.customer WHERE id = $1', [id])).rowCount ?? 0) > 0;
  }

  async upsertCustomerTax(
    client: PoolClient,
    tenantId: string,
    customerId: string,
    userId: string,
    c: { gstin: string | null; legalName: string | null; stateCode: string; addressLine1: string | null; city: string | null; pincode: string | null },
  ): Promise<void> {
    await client.query(
      `INSERT INTO tax.customer_tax (customer_id, tenant_id, gstin, legal_name, state_code, address_line1, city, pincode, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (customer_id) DO UPDATE SET gstin = EXCLUDED.gstin, legal_name = EXCLUDED.legal_name,
         state_code = EXCLUDED.state_code, address_line1 = EXCLUDED.address_line1, city = EXCLUDED.city,
         pincode = EXCLUDED.pincode, updated_by = EXCLUDED.updated_by, version = tax.customer_tax.version + 1, updated_at = now()`,
      [customerId, tenantId, c.gstin, c.legalName, c.stateCode, c.addressLine1, c.city, c.pincode, userId],
    );
  }

  /** Farmers with their PAN, and what they've been paid and had withheld this financial year. */
  async farmerRows(client: PoolClient, timezone: string, fyStart: string): Promise<Record<string, unknown>[]> {
    const result = await client.query(
      `SELECT f.id AS farmer_id, f.name, f.status, ft.pan, ft.deductee_type, COALESCE(ft.tds_exempt, false) AS tds_exempt,
              ft.exempt_reason, COALESCE(ft.version, 0) AS version,
              COALESCE((SELECT SUM(p.amount) FROM money.farmer_payable p
                        WHERE p.farmer_id = f.id AND p.accrued_at >= ($2::date::timestamp AT TIME ZONE $1)), 0)::text AS purchases,
              COALESCE((SELECT SUM(d.tds_amount) FROM tax.tds_deduction d
                        WHERE d.farmer_id = f.id AND d.deducted_on >= $2::date), 0)::text AS tds
       FROM trading_partners.farmer f LEFT JOIN tax.farmer_tax ft ON ft.farmer_id = f.id
       ORDER BY f.status, f.name`,
      [timezone, fyStart],
    );
    return result.rows;
  }

  async farmerExists(client: PoolClient, id: string): Promise<boolean> {
    return ((await client.query('SELECT 1 FROM trading_partners.farmer WHERE id = $1', [id])).rowCount ?? 0) > 0;
  }

  async upsertFarmerTax(
    client: PoolClient,
    tenantId: string,
    farmerId: string,
    userId: string,
    f: { pan: string | null; deducteeType: string | null; tdsExempt: boolean; exemptReason: string | null },
  ): Promise<void> {
    await client.query(
      `INSERT INTO tax.farmer_tax (farmer_id, tenant_id, pan, deductee_type, tds_exempt, exempt_reason, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (farmer_id) DO UPDATE SET pan = EXCLUDED.pan, deductee_type = EXCLUDED.deductee_type,
         tds_exempt = EXCLUDED.tds_exempt, exempt_reason = EXCLUDED.exempt_reason, updated_by = EXCLUDED.updated_by,
         version = tax.farmer_tax.version + 1, updated_at = now()`,
      [farmerId, tenantId, f.pan, f.deducteeType, f.tdsExempt, f.exemptReason, userId],
    );
  }

  // ---- Invoices ----

  async invoiceRegister(client: PoolClient, timezone: string, from: string, to: string): Promise<InvoiceRegisterRow[]> {
    const result = await client.query<InvoiceRegisterRow>(
      `SELECT i.id AS invoice_id, i.invoice_number, (i.issued_at AT TIME ZONE $1)::date::text AS issued_on,
              i.customer_id, c.name AS customer_name, it.buyer_gstin, it.document_type, it.place_of_supply, it.intra_state,
              it.taxable_value::text, it.cgst::text, it.sgst::text, it.igst::text, it.cess::text, it.total::text,
              (SELECT count(*)::int FROM tax.invoice_line_tax lt WHERE lt.invoice_id = i.id AND lt.taxability = 'unclassified') AS unclassified_lines,
              e.irn, e.ack_no, e.ack_date, e.status AS einvoice_status
       FROM money.invoice i
       JOIN tax.invoice_tax it ON it.invoice_id = i.id
       JOIN trading_partners.customer c ON c.id = i.customer_id
       LEFT JOIN tax.einvoice e ON e.invoice_id = i.id
       WHERE i.kind = 'sale' AND (i.issued_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
       ORDER BY i.issued_at DESC, i.invoice_number DESC`,
      [timezone, from, to],
    );
    return result.rows;
  }

  async invoiceHeader(client: PoolClient, timezone: string, invoiceId: string): Promise<Record<string, unknown> | null> {
    const result = await client.query(
      `SELECT i.id AS invoice_id, i.invoice_number, (i.issued_at AT TIME ZONE $1)::date::text AS issued_on, c.name AS customer_name,
              it.document_type, it.supplier_gstin, it.supplier_state, it.buyer_gstin, it.place_of_supply, it.intra_state,
              COALESCE(it.buyer_legal_name, ct.legal_name, c.name) AS buyer_legal_name,
              COALESCE(it.buyer_address_line1, ct.address_line1) AS buyer_address_line1,
              COALESCE(it.buyer_city, ct.city) AS buyer_city,
              COALESCE(it.buyer_pincode, ct.pincode) AS buyer_pincode,
              it.taxable_value::text, it.cgst::text, it.sgst::text, it.igst::text, it.cess::text, it.total::text,
              e.irn, e.ack_no, e.ack_date, e.status AS einvoice_status
       FROM money.invoice i
       JOIN tax.invoice_tax it ON it.invoice_id = i.id
       JOIN trading_partners.customer c ON c.id = i.customer_id
       LEFT JOIN tax.customer_tax ct ON ct.customer_id = i.customer_id
       LEFT JOIN tax.einvoice e ON e.invoice_id = i.id
       WHERE i.id = $2`,
      [timezone, invoiceId],
    );
    return result.rows[0] ?? null;
  }

  async invoiceLines(client: PoolClient, invoiceId: string): Promise<Record<string, unknown>[]> {
    const result = await client.query(
      `SELECT l.description, l.quantity::text, l.unit_price::text, lt.hsn_code, lt.uqc, lt.taxability, lt.gst_rate::text,
              lt.cess_rate::text, lt.taxable_value::text, lt.cgst::text, lt.sgst::text, lt.igst::text, lt.cess::text
       FROM money.invoice_line l JOIN tax.invoice_line_tax lt ON lt.invoice_line_id = l.id
       WHERE l.invoice_id = $1
       ORDER BY l.description, l.id`,
      [invoiceId],
    );
    return result.rows;
  }

  /** Every taxed sale line in the period — the raw material for GSTR-1 and 3B. */
  async gstLines(client: PoolClient, timezone: string, from: string, to: string): Promise<GstLineRow[]> {
    const result = await client.query<GstLineRow>(
      `SELECT i.id AS invoice_id, i.invoice_number, (i.issued_at AT TIME ZONE $1)::date::text AS issued_on,
              c.name AS customer_name, it.buyer_gstin, it.place_of_supply, it.intra_state, it.total::text AS invoice_total,
              lt.taxability, lt.hsn_code, lt.uqc, lt.gst_rate::text, l.quantity::text, lt.taxable_value::text,
              lt.cgst::text, lt.sgst::text, lt.igst::text, lt.cess::text
       FROM money.invoice i
       JOIN tax.invoice_tax it ON it.invoice_id = i.id
       JOIN trading_partners.customer c ON c.id = i.customer_id
       JOIN money.invoice_line l ON l.invoice_id = i.id
       JOIN tax.invoice_line_tax lt ON lt.invoice_line_id = l.id
       WHERE i.kind = 'sale' AND (i.issued_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
       ORDER BY i.invoice_number, l.id`,
      [timezone, from, to],
    );
    return result.rows;
  }

  async financeChargeInvoiceCount(client: PoolClient, timezone: string, from: string, to: string): Promise<number> {
    const result = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM money.invoice
       WHERE kind = 'finance_charge' AND (issued_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date`,
      [timezone, from, to],
    );
    return result.rows[0].n;
  }

  // ---- E-invoice ----

  async insertEinvoice(
    client: PoolClient,
    tenantId: string,
    invoiceId: string,
    userId: string,
    e: { irn: string; ackNo: string; ackDate: Date; signedQr: string | null },
  ): Promise<void> {
    await client.query(
      `INSERT INTO tax.einvoice (invoice_id, tenant_id, irn, ack_no, ack_date, signed_qr, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [invoiceId, tenantId, e.irn, e.ackNo, e.ackDate, e.signedQr, userId],
    );
  }

  async cancelEinvoice(client: PoolClient, invoiceId: string, reasonCode: string, remark: string): Promise<void> {
    await client.query(
      `UPDATE tax.einvoice SET status = 'cancelled', cancelled_at = now(), cancel_reason_code = $2, cancel_remark = $3
       WHERE invoice_id = $1 AND status = 'active'`,
      [invoiceId, reasonCode, remark],
    );
  }

  // ---- TDS ----

  async deductions(client: PoolClient, from: string, to: string): Promise<DeductionRow[]> {
    const result = await client.query<DeductionRow>(
      `SELECT d.id, d.section_code, d.payee_name, d.payee_pan, d.deductee_type, d.deducted_on::text,
              d.gross_amount::text, d.base_amount::text, d.rate::text, d.tds_amount::text, d.challan_id,
              ch.bsr_code, ch.challan_serial, ch.paid_on::text AS paid_on, d.source_type
       FROM tax.tds_deduction d LEFT JOIN tax.tds_challan ch ON ch.id = d.challan_id
       WHERE d.deducted_on BETWEEN $1::date AND $2::date
       ORDER BY d.deducted_on, d.created_at`,
      [from, to],
    );
    return result.rows;
  }

  /** Every deduction not yet paid over, whenever it was made — for overdue warnings. */
  async undeposited(client: PoolClient): Promise<{ id: string; section_code: string; deducted_on: string; tds_amount: string }[]> {
    const result = await client.query<{ id: string; section_code: string; deducted_on: string; tds_amount: string }>(
      `SELECT id, section_code, deducted_on::text, tds_amount::text FROM tax.tds_deduction WHERE challan_id IS NULL ORDER BY deducted_on`,
    );
    return result.rows;
  }

  async challans(client: PoolClient, from: string, to: string): Promise<Record<string, unknown>[]> {
    const result = await client.query(
      `SELECT ch.id, ch.section_code, ch.tax_amount::text, ch.interest::text, ch.paid_on::text, ch.bsr_code, ch.challan_serial,
              ch.paid_from, (SELECT count(*)::int FROM tax.tds_deduction d WHERE d.challan_id = ch.id) AS deductions
       FROM tax.tds_challan ch
       WHERE ch.paid_on BETWEEN $1::date AND $2::date
          OR EXISTS (SELECT 1 FROM tax.tds_deduction d WHERE d.challan_id = ch.id AND d.deducted_on BETWEEN $1::date AND $2::date)
       ORDER BY ch.paid_on`,
      [from, to],
    );
    return result.rows;
  }

  async deductionsByIds(client: PoolClient, ids: string[]): Promise<{ id: string; section_code: string; tds_amount: string; challan_id: string | null }[]> {
    const result = await client.query<{ id: string; section_code: string; tds_amount: string; challan_id: string | null }>(
      'SELECT id, section_code, tds_amount::text, challan_id FROM tax.tds_deduction WHERE id = ANY($1) FOR UPDATE',
      [ids],
    );
    return result.rows;
  }

  async insertChallan(
    client: PoolClient,
    fields: {
      id: string;
      tenantId: string;
      sectionCode: string;
      taxAmount: string;
      interest: string;
      paidOn: string;
      bsrCode: string;
      challanSerial: string;
      paidFrom: string;
      ledgerEntryId: string;
      createdBy: string;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO tax.tds_challan
         (id, tenant_id, section_code, tax_amount, interest, paid_on, bsr_code, challan_serial, paid_from, ledger_entry_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        fields.id,
        fields.tenantId,
        fields.sectionCode,
        fields.taxAmount,
        fields.interest,
        fields.paidOn,
        fields.bsrCode,
        fields.challanSerial,
        fields.paidFrom,
        fields.ledgerEntryId,
        fields.createdBy,
      ],
    );
  }

  async linkDeductions(client: PoolClient, challanId: string, ids: string[]): Promise<void> {
    await client.query('UPDATE tax.tds_deduction SET challan_id = $1 WHERE id = ANY($2) AND challan_id IS NULL', [challanId, ids]);
  }

  async expenseAccount(
    client: PoolClient,
    code: string,
  ): Promise<{ name: string; root_type: string; is_active: boolean; is_control: boolean } | null> {
    const result = await client.query('SELECT name, root_type, is_active, is_control FROM money.account WHERE code = $1', [code]);
    return result.rows[0] ?? null;
  }
}
