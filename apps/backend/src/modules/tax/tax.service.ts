import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { LedgerService } from '../finance/ledger.service';
import { TaxRulesService } from '../tax-rules/tax-rules.service';
import { TaxRulesRepository } from '../tax-rules/repositories/tax-rules.repository';
import { assertRealDate } from '../../common/period';
import {
  compareMoney,
  isPositiveMoney,
  moneyFromNumber,
  percentOfMoney,
  subtractMoney,
  sumMoney,
} from '../../common/money';
import {
  deducteeTypeFromPan,
  financialYearStart,
  GST_STATES,
  gstinProblem,
  isValidPan,
  isValidTan,
  quarterRange,
  tdsDepositDueDate,
  UQC,
} from '../../common/india';
import { Books, GstLineRow, InvoiceRegisterRow, TaxRepository } from './repositories/tax.repository';
import { buildEinvoiceJson, EinvoiceSource, missingData, notApplicableReason } from './einvoice';
import {
  CustomerTaxRow,
  DeducteeType,
  EinvoiceState,
  FarmerTaxRow,
  Gstr1,
  Gstr3b,
  GstRateView,
  HsnSummaryRow,
  ProductTaxRow,
  RateBucket,
  TaxInvoiceRow,
  TaxProfile,
  TaxReference,
  TdsRegister,
  TdsSectionView,
} from './entities/tax.entity';
import {
  CancelIrnDto,
  CreateGstRateDto,
  CreateTdsSectionDto,
  RecordIrnDto,
  RecordTdsChallanDto,
  RecordTdsDeductionDto,
  SetCustomerTaxDto,
  SetFarmerTaxDto,
  SetProductTaxDto,
  UpdateTaxProfileDto,
} from './dto/tax.dto';
import { toGstRule } from '../tax-rules/repositories/tax-rules.repository';

const IRN_CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000; // an IRN can be cancelled within 24 hours of acknowledgement
const MAX_REPORT_DAYS = 366;

const clean = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};
const upper = (value: string | null | undefined) => clean(value)?.toUpperCase() ?? null;

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function inForce(rule: { effectiveFrom: string; effectiveTo: string | null }, today: string): boolean {
  return rule.effectiveFrom <= today && (rule.effectiveTo === null || rule.effectiveTo >= today);
}

/**
 * The Tax context: GST registration and rules, HSN and party tax details,
 * the invoice register and GSTR-1 / GSTR-3B data, TDS (withheld on farmer
 * purchases automatically, on expenses when recorded) and its deposits,
 * and e-invoice readiness and IRN records. Every rate and threshold comes
 * from configured, effective-dated rules (TaxRulesService); postings go
 * through Finance's LedgerService in the same transaction.
 */
@Injectable()
export class TaxService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TaxRepository,
    private readonly rules: TaxRulesService,
    private readonly rulesRepo: TaxRulesRepository,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  reference(): TaxReference {
    return {
      states: Object.entries(GST_STATES).map(([code, name]) => ({ code, name })),
      uqc: UQC,
    };
  }

  private range(from: string, to: string): void {
    assertRealDate(from, 'from');
    assertRealDate(to, 'to');
    if (from > to) throw new BadRequestException('from must be on or before to');
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
    if (days > MAX_REPORT_DAYS) throw new BadRequestException(`A tax report covers at most ${MAX_REPORT_DAYS} days`);
  }

  // ---- Profile ----

  getProfile(tenantId: string): Promise<TaxProfile> {
    return this.db.withTenant(tenantId, (client) => this.rules.profileWithClient(client));
  }

  async updateProfile(tenantId: string, actorUserId: string, dto: UpdateTaxProfileDto): Promise<TaxProfile> {
    const gstin = upper(dto.gstin);
    const pan = upper(dto.pan);
    const tan = upper(dto.tan);
    if (gstin) {
      const problem = gstinProblem(gstin);
      if (problem) throw new BadRequestException(problem);
    }
    if (dto.registrationType !== 'unregistered' && !gstin) {
      throw new BadRequestException('A GST-registered business needs its GSTIN');
    }
    if (pan && !isValidPan(pan)) throw new BadRequestException('A PAN is 5 letters, 4 digits, 1 letter');
    if (gstin && pan && gstin.slice(2, 12) !== pan) throw new BadRequestException('The PAN must match characters 3–12 of the GSTIN');
    if (tan && !isValidTan(tan)) throw new BadRequestException('A TAN is 4 letters, 5 digits, 1 letter');
    const stateCode = gstin ? gstin.slice(0, 2) : clean(dto.stateCode);
    if (stateCode && !GST_STATES[stateCode]) throw new BadRequestException(`${stateCode} is not a GST state code`);
    if (dto.einvoiceEnabled && dto.registrationType !== 'regular') {
      throw new BadRequestException('Only a regular GST registration issues e-invoices');
    }
    const farmerTdsSection = clean(dto.farmerTdsSection);

    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.repo.books(client);
      if (farmerTdsSection && !(await this.rulesRepo.tdsSection(client, farmerTdsSection, books.today))) {
        throw new BadRequestException(`There is no TDS section ${farmerTdsSection} in force today`);
      }
      const before = await this.rules.profileWithClient(client);
      const saved = await this.repo.saveProfile(client, tenantId, actorUserId, dto.version, {
        registrationType: dto.registrationType,
        gstin,
        legalName: clean(dto.legalName),
        tradeName: clean(dto.tradeName),
        addressLine1: clean(dto.addressLine1),
        addressLine2: clean(dto.addressLine2),
        city: clean(dto.city),
        pincode: clean(dto.pincode),
        stateCode,
        pan: pan ?? (gstin ? gstin.slice(2, 12) : null),
        tan,
        hsnMinDigits: dto.hsnMinDigits,
        b2clThreshold: moneyFromNumber(dto.b2clThreshold),
        einvoiceEnabled: dto.einvoiceEnabled,
        einvoiceReportWithinDays: dto.einvoiceReportWithinDays ?? null,
        farmerTdsSection,
      });
      if (!saved) throw new ConflictException('The tax settings were changed by someone else — reload and try again');
      const after = await this.rules.profileWithClient(client);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: before.version === 0 ? 'create' : 'update',
        entityType: 'tax_profile',
        entityId: tenantId,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }

  // ---- GST rates ----

  listGstRates(tenantId: string): Promise<GstRateView[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const { today } = await this.repo.books(client);
      return (await this.repo.gstRates(client)).map((r) => ({
        ...r,
        source: r.tenantId ? 'tenant' : 'default',
        inForce: inForce(r, today),
      }));
    });
  }

  /**
   * A new rule for an HSN/SAC code from a date. The tenant's own earlier
   * rule for the same code, if still open, ends the day before — a rate
   * change is one action. A system default isn't ended; the tenant's rule
   * simply wins over it.
   */
  async createGstRate(tenantId: string, actorUserId: string, dto: CreateGstRateDto): Promise<GstRateView> {
    assertRealDate(dto.effectiveFrom, 'effectiveFrom');
    const rate = moneyFromNumber(dto.rate);
    const cessRate = moneyFromNumber(dto.cessRate ?? 0);
    if (dto.taxability === 'taxable' && !isPositiveMoney(rate) && !isPositiveMoney(cessRate)) {
      throw new BadRequestException('A taxable rule needs a rate — use nil-rated or exempt for 0%');
    }
    if (dto.taxability !== 'taxable' && (isPositiveMoney(rate) || isPositiveMoney(cessRate))) {
      throw new BadRequestException(`A ${dto.taxability.replace('_', '-')} rule charges no tax — set the rate to 0`);
    }
    return this.db.withTenant(tenantId, async (client) => {
      await this.repo.endOpenTenantRule(client, 'gst_rate', 'hsn_code', dto.hsnCode, dto.effectiveFrom);
      let id: string;
      try {
        id = await this.repo.insertGstRate(client, tenantId, actorUserId, {
          hsnCode: dto.hsnCode,
          description: dto.description.trim(),
          supplyKind: dto.supplyKind,
          taxability: dto.taxability,
          rate,
          cessRate,
          effectiveFrom: dto.effectiveFrom,
        });
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictException(`There is already a rule for ${dto.hsnCode} starting ${dto.effectiveFrom}`);
        }
        throw err;
      }
      const created = await this.repo.findGstRate(client, id);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: 'gst_rate',
        entityId: id,
        after: created as unknown as Record<string, unknown>,
      });
      const { today } = await this.repo.books(client);
      return { ...(created as NonNullable<typeof created>), source: 'tenant', inForce: inForce(created!, today) };
    });
  }

  endGstRate(tenantId: string, actorUserId: string, id: string, effectiveTo: string): Promise<void> {
    return this.endRule(tenantId, actorUserId, 'gst_rate', id, effectiveTo);
  }

  private async endRule(tenantId: string, actorUserId: string, table: 'gst_rate' | 'tds_section', id: string, effectiveTo: string): Promise<void> {
    assertRealDate(effectiveTo, 'effectiveTo');
    await this.db.withTenant(tenantId, async (client) => {
      const rule = table === 'gst_rate' ? await this.repo.findGstRate(client, id) : await this.repo.findTdsSection(client, id);
      if (!rule) throw new NotFoundException('Rule not found');
      if (!rule.tenantId) {
        throw new ConflictException('A system default can’t be ended — add your own rule for the code; it takes precedence');
      }
      if (effectiveTo < rule.effectiveFrom) throw new BadRequestException('A rule can’t end before it starts');
      await this.repo.endRule(client, table, id, effectiveTo);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: table,
        entityId: id,
        before: { effectiveTo: rule.effectiveTo },
        after: { effectiveTo },
      });
    });
  }

  // ---- TDS sections ----

  listTdsSections(tenantId: string): Promise<TdsSectionView[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const { today } = await this.repo.books(client);
      return (await this.repo.tdsSections(client)).map((s) => ({
        ...s,
        source: s.tenantId ? 'tenant' : 'default',
        inForce: inForce(s, today),
      }));
    });
  }

  async createTdsSection(tenantId: string, actorUserId: string, dto: CreateTdsSectionDto): Promise<TdsSectionView> {
    assertRealDate(dto.effectiveFrom, 'effectiveFrom');
    if (dto.basis === 'excess_over_annual' && (dto.annualThreshold === undefined || dto.annualThreshold === null)) {
      throw new BadRequestException('"Only the excess" needs an annual threshold');
    }
    const rate = (n: number) => String(n);
    return this.db.withTenant(tenantId, async (client) => {
      await this.repo.endOpenTenantRule(client, 'tds_section', 'code', dto.code, dto.effectiveFrom);
      let id: string;
      try {
        id = await this.repo.insertTdsSection(client, tenantId, actorUserId, {
          code: dto.code,
          description: dto.description.trim(),
          rateIndividual: rate(dto.rateIndividual),
          rateOther: rate(dto.rateOther),
          rateNoPan: rate(dto.rateNoPan),
          singleThreshold: dto.singleThreshold === undefined || dto.singleThreshold === null ? null : moneyFromNumber(dto.singleThreshold),
          annualThreshold: dto.annualThreshold === undefined || dto.annualThreshold === null ? null : moneyFromNumber(dto.annualThreshold),
          basis: dto.basis,
          effectiveFrom: dto.effectiveFrom,
        });
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictException(`There is already a ${dto.code} rule starting ${dto.effectiveFrom}`);
        }
        throw err;
      }
      const created = (await this.repo.findTdsSection(client, id))!;
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: 'tds_section',
        entityId: id,
        after: created as unknown as Record<string, unknown>,
      });
      const { today } = await this.repo.books(client);
      return { ...created, source: 'tenant', inForce: inForce(created, today) };
    });
  }

  endTdsSection(tenantId: string, actorUserId: string, id: string, effectiveTo: string): Promise<void> {
    return this.endRule(tenantId, actorUserId, 'tds_section', id, effectiveTo);
  }

  // ---- Products, customers, farmers ----

  listProducts(tenantId: string): Promise<ProductTaxRow[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const { today } = await this.repo.books(client);
      return (await this.repo.productRows(client, today)).map((row) => ({
        productId: row.product_id as string,
        name: row.name as string,
        baseUom: row.base_uom as string,
        uqc: TaxRulesRepository.uqcFor(row.base_uom as string),
        status: row.product_status as ProductTaxRow['status'],
        hsnCode: row.product_hsn as string | null,
        rule: row.id ? toGstRule(row) : null,
        version: Number(row.product_version),
      }));
    });
  }

  async setProductTax(tenantId: string, actorUserId: string, productId: string, dto: SetProductTaxDto): Promise<void> {
    await this.db.withTenant(tenantId, async (client) => {
      if (!(await this.repo.productExists(client, productId))) throw new NotFoundException('Product not found');
      await this.repo.upsertProductTax(client, tenantId, productId, dto.hsnCode, actorUserId);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: 'product_tax',
        entityId: productId,
        after: { hsnCode: dto.hsnCode },
      });
    });
  }

  listCustomers(tenantId: string): Promise<CustomerTaxRow[]> {
    return this.db.withTenant(tenantId, async (client) =>
      (await this.repo.customerRows(client)).map((row) => ({
        customerId: row.customer_id as string,
        name: row.name as string,
        status: row.status as CustomerTaxRow['status'],
        gstin: row.gstin as string | null,
        legalName: row.legal_name as string | null,
        stateCode: row.state_code as string | null,
        addressLine1: row.address_line1 as string | null,
        city: row.city as string | null,
        pincode: row.pincode as string | null,
        version: Number(row.version),
      })),
    );
  }

  async setCustomerTax(tenantId: string, actorUserId: string, customerId: string, dto: SetCustomerTaxDto): Promise<void> {
    const gstin = upper(dto.gstin);
    if (gstin) {
      const problem = gstinProblem(gstin);
      if (problem) throw new BadRequestException(problem);
    }
    const stateCode = gstin ? gstin.slice(0, 2) : clean(dto.stateCode);
    if (!stateCode) throw new BadRequestException("Choose the customer's state — it's the place of supply");
    if (!GST_STATES[stateCode]) throw new BadRequestException(`${stateCode} is not a GST state code`);
    await this.db.withTenant(tenantId, async (client) => {
      if (!(await this.repo.customerExists(client, customerId))) throw new NotFoundException('Customer not found');
      const fields = {
        gstin,
        legalName: clean(dto.legalName),
        stateCode,
        addressLine1: clean(dto.addressLine1),
        city: clean(dto.city),
        pincode: clean(dto.pincode),
      };
      await this.repo.upsertCustomerTax(client, tenantId, customerId, actorUserId, fields);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: 'customer_tax',
        entityId: customerId,
        after: fields,
      });
    });
  }

  listFarmers(tenantId: string): Promise<FarmerTaxRow[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.repo.books(client);
      return (await this.repo.farmerRows(client, books.timezone, financialYearStart(books.today))).map((row) => {
        const pan = row.pan as string | null;
        const set = row.deductee_type as 'individual_huf' | 'other' | null;
        return {
          farmerId: row.farmer_id as string,
          name: row.name as string,
          status: row.status as FarmerTaxRow['status'],
          pan,
          deducteeType: (!pan ? 'no_pan' : set ?? deducteeTypeFromPan(pan)) as DeducteeType,
          deducteeTypeSet: set !== null,
          tdsExempt: row.tds_exempt as boolean,
          exemptReason: row.exempt_reason as string | null,
          purchasesThisYear: row.purchases as string,
          tdsThisYear: row.tds as string,
          version: Number(row.version),
        };
      });
    });
  }

  async setFarmerTax(tenantId: string, actorUserId: string, farmerId: string, dto: SetFarmerTaxDto): Promise<void> {
    const pan = upper(dto.pan);
    if (pan && !isValidPan(pan)) throw new BadRequestException('A PAN is 5 letters, 4 digits, 1 letter');
    const exemptReason = clean(dto.exemptReason);
    if (dto.tdsExempt && (!exemptReason || exemptReason.length < 3)) {
      throw new BadRequestException('Say why no TDS applies to this farmer');
    }
    await this.db.withTenant(tenantId, async (client) => {
      if (!(await this.repo.farmerExists(client, farmerId))) throw new NotFoundException('Farmer not found');
      const fields = { pan, deducteeType: dto.deducteeType ?? null, tdsExempt: dto.tdsExempt, exemptReason: dto.tdsExempt ? exemptReason : null };
      await this.repo.upsertFarmerTax(client, tenantId, farmerId, actorUserId, fields);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: 'farmer_tax',
        entityId: farmerId,
        after: fields,
      });
    });
  }

  // ---- Invoices and e-invoicing ----

  private async einvoiceSource(client: PoolClient, books: Books, profile: TaxProfile, invoiceId: string): Promise<{ source: EinvoiceSource; header: Record<string, unknown> }> {
    const header = await this.repo.invoiceHeader(client, books.timezone, invoiceId);
    if (!header) throw new NotFoundException('Invoice not found, or issued before the tax layer');
    const lines = await this.repo.invoiceLines(client, invoiceId);
    const buyerGstin = header.buyer_gstin as string | null;
    return {
      header,
      source: {
        invoiceNumber: header.invoice_number as string,
        issuedOn: header.issued_on as string,
        documentType: header.document_type as EinvoiceSource['documentType'],
        seller: {
          gstin: (header.supplier_gstin as string | null) ?? profile.gstin,
          legalName: profile.legalName,
          tradeName: profile.tradeName,
          addressLine1: profile.addressLine1,
          addressLine2: profile.addressLine2,
          city: profile.city,
          pincode: profile.pincode,
          stateCode: (header.supplier_state as string | null) ?? profile.stateCode,
        },
        buyer: {
          gstin: buyerGstin,
          legalName: header.buyer_legal_name as string | null,
          addressLine1: header.buyer_address_line1 as string | null,
          city: header.buyer_city as string | null,
          pincode: header.buyer_pincode as string | null,
          stateCode: buyerGstin ? buyerGstin.slice(0, 2) : (header.place_of_supply as string | null),
        },
        placeOfSupply: header.place_of_supply as string | null,
        lines: lines.map((l) => ({
          description: l.description as string,
          hsnCode: l.hsn_code as string | null,
          uqc: l.uqc as string,
          quantity: l.quantity as string,
          unitPrice: l.unit_price as string,
          taxableValue: l.taxable_value as string,
          taxability: l.taxability as string,
          gstRate: l.gst_rate as string,
          cessRate: l.cess_rate as string,
          cgst: l.cgst as string,
          sgst: l.sgst as string,
          igst: l.igst as string,
          cess: l.cess as string,
        })),
        totals: {
          taxableValue: header.taxable_value as string,
          cgst: header.cgst as string,
          sgst: header.sgst as string,
          igst: header.igst as string,
          cess: header.cess as string,
          total: header.total as string,
        },
      },
    };
  }

  private einvoiceState(
    row: { issued_on: string; irn: string | null; ack_no: string | null; ack_date: Date | null; einvoice_status: 'active' | 'cancelled' | null },
    profile: TaxProfile,
    source: EinvoiceSource | null,
  ): EinvoiceState {
    const reportBy = profile.einvoiceReportWithinDays ? addDays(row.issued_on, profile.einvoiceReportWithinDays) : null;
    if (row.irn) {
      const active = row.einvoice_status === 'active';
      return {
        status: active ? 'registered' : 'cancelled',
        issues: [],
        irn: row.irn,
        ackNo: row.ack_no,
        ackDate: row.ack_date,
        reportBy: null,
        cancellableUntil: active && row.ack_date ? new Date(new Date(row.ack_date).getTime() + IRN_CANCEL_WINDOW_MS) : null,
      };
    }
    const settings = { enabled: profile.einvoiceEnabled, hsnMinDigits: profile.hsnMinDigits };
    const reason = source ? notApplicableReason(source, settings) : 'Not applicable';
    if (reason || !source) {
      return { status: 'not_applicable', issues: [reason ?? ''], irn: null, ackNo: null, ackDate: null, reportBy: null, cancellableUntil: null };
    }
    const issues = missingData(source, settings);
    return {
      status: issues.length ? 'missing_data' : 'ready',
      issues,
      irn: null,
      ackNo: null,
      ackDate: null,
      reportBy,
      cancellableUntil: null,
    };
  }

  listInvoices(tenantId: string, from: string, to: string): Promise<TaxInvoiceRow[]> {
    this.range(from, to);
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.repo.books(client);
      const profile = await this.rules.profileWithClient(client);
      const rows = await this.repo.invoiceRegister(client, books.timezone, from, to);
      const result: TaxInvoiceRow[] = [];
      for (const row of rows) {
        // Only an invoice that could need an IRN is worth building in full.
        const candidate = !row.irn && profile.einvoiceEnabled && row.document_type === 'tax_invoice' && !!row.buyer_gstin;
        const source = candidate ? (await this.einvoiceSource(client, books, profile, row.invoice_id)).source : null;
        result.push(this.toInvoiceRow(row, this.einvoiceState(row, profile, source ?? this.lightSource(row))));
      }
      return result;
    });
  }

  /** Enough of an invoice to say why it isn't e-invoiced, without loading its lines. */
  private lightSource(row: InvoiceRegisterRow): EinvoiceSource {
    return {
      invoiceNumber: row.invoice_number,
      issuedOn: row.issued_on,
      documentType: row.document_type,
      seller: { gstin: null, legalName: null, addressLine1: null, city: null, pincode: null, stateCode: null },
      buyer: { gstin: row.buyer_gstin, legalName: null, addressLine1: null, city: null, pincode: null, stateCode: null },
      placeOfSupply: row.place_of_supply,
      lines: [],
      totals: { taxableValue: row.taxable_value, cgst: row.cgst, sgst: row.sgst, igst: row.igst, cess: row.cess, total: row.total },
    };
  }

  private toInvoiceRow(row: InvoiceRegisterRow, einvoice: EinvoiceState): TaxInvoiceRow {
    return {
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number,
      issuedOn: row.issued_on,
      customerId: row.customer_id,
      customerName: row.customer_name,
      buyerGstin: row.buyer_gstin,
      documentType: row.document_type,
      placeOfSupply: row.place_of_supply,
      intraState: row.intra_state,
      taxableValue: row.taxable_value,
      cgst: row.cgst,
      sgst: row.sgst,
      igst: row.igst,
      cess: row.cess,
      total: row.total,
      unclassifiedLines: row.unclassified_lines,
      einvoice,
    };
  }

  getEinvoiceJson(tenantId: string, invoiceId: string): Promise<Record<string, unknown>> {
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.repo.books(client);
      const profile = await this.rules.profileWithClient(client);
      const { source } = await this.einvoiceSource(client, books, profile, invoiceId);
      const settings = { enabled: profile.einvoiceEnabled, hsnMinDigits: profile.hsnMinDigits };
      const reason = notApplicableReason(source, settings);
      if (reason) throw new ConflictException(reason);
      const issues = missingData(source, settings);
      if (issues.length) throw new ConflictException(`Not ready for the IRP: ${issues.join('; ')}`);
      return buildEinvoiceJson(source);
    });
  }

  async recordIrn(tenantId: string, actorUserId: string, invoiceId: string, dto: RecordIrnDto): Promise<void> {
    const ackDate = new Date(dto.ackDate);
    if (Number.isNaN(ackDate.getTime())) throw new BadRequestException('ackDate is not a valid date and time');
    if (ackDate.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException('The acknowledgement date is in the future');
    await this.db.withTenant(tenantId, async (client) => {
      const books = await this.repo.books(client);
      const profile = await this.rules.profileWithClient(client);
      const { source, header } = await this.einvoiceSource(client, books, profile, invoiceId);
      if (header.irn) throw new ConflictException('This invoice already has an IRN recorded');
      const reason = notApplicableReason(source, { enabled: profile.einvoiceEnabled, hsnMinDigits: profile.hsnMinDigits });
      if (reason) throw new ConflictException(reason);
      try {
        await this.repo.insertEinvoice(client, tenantId, invoiceId, actorUserId, {
          irn: dto.irn.toLowerCase(),
          ackNo: dto.ackNo,
          ackDate,
          signedQr: clean(dto.signedQr),
        });
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw new ConflictException('That IRN is already recorded on another invoice');
        throw err;
      }
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: 'einvoice',
        entityId: invoiceId,
        after: { irn: dto.irn.toLowerCase(), ackNo: dto.ackNo, ackDate },
      });
    });
  }

  async cancelIrn(tenantId: string, actorUserId: string, invoiceId: string, dto: CancelIrnDto): Promise<void> {
    await this.db.withTenant(tenantId, async (client) => {
      const books = await this.repo.books(client);
      const header = await this.repo.invoiceHeader(client, books.timezone, invoiceId);
      if (!header?.irn) throw new NotFoundException('No IRN is recorded for this invoice');
      if (header.einvoice_status !== 'active') throw new ConflictException('This IRN is already cancelled');
      if (Date.now() - new Date(header.ack_date as Date).getTime() > IRN_CANCEL_WINDOW_MS) {
        throw new ConflictException('An IRN can only be cancelled within 24 hours of acknowledgement — issue a credit note instead');
      }
      await this.repo.cancelEinvoice(client, invoiceId, dto.reasonCode, dto.remark.trim());
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: 'einvoice',
        entityId: invoiceId,
        before: { status: 'active' },
        after: { status: 'cancelled', reasonCode: dto.reasonCode, remark: dto.remark.trim() },
      });
    });
  }

  // ---- Returns data ----

  getGstr1(tenantId: string, from: string, to: string): Promise<Gstr1> {
    this.range(from, to);
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.repo.books(client);
      const profile = await this.rules.profileWithClient(client);
      const lines = await this.repo.gstLines(client, books.timezone, from, to);
      const financeCharges = await this.repo.financeChargeInvoiceCount(client, books.timezone, from, to);
      return buildGstr1(books.currency, from, to, profile, lines, financeCharges);
    });
  }

  getGstr3b(tenantId: string, from: string, to: string): Promise<Gstr3b> {
    this.range(from, to);
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.repo.books(client);
      const profile = await this.rules.profileWithClient(client);
      const lines = await this.repo.gstLines(client, books.timezone, from, to);
      return buildGstr3b(books.currency, from, to, profile, lines);
    });
  }

  // ---- TDS ----

  getTdsRegister(tenantId: string, fy: string, quarter: 1 | 2 | 3 | 4): Promise<TdsRegister> {
    const start = Number(fy.slice(0, 4));
    if (`${start}-${String((start + 1) % 100).padStart(2, '0')}` !== fy) throw new BadRequestException('fy must look like 2026-27');
    const { from, to } = quarterRange(fy, quarter);
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.repo.books(client);
      const profile = await this.rules.profileWithClient(client);
      const rows = await this.repo.deductions(client, from, to);
      const challans = await this.repo.challans(client, from, to);
      const undeposited = await this.repo.undeposited(client);

      const sections = new Map<string, { deductions: number; base: string[]; tds: string[]; deposited: string[] }>();
      for (const d of rows) {
        const s = sections.get(d.section_code) ?? { deductions: 0, base: [], tds: [], deposited: [] };
        s.deductions += 1;
        s.base.push(d.base_amount);
        s.tds.push(d.tds_amount);
        if (d.challan_id) s.deposited.push(d.tds_amount);
        sections.set(d.section_code, s);
      }
      const overdueBySection = new Map<string, { amount: string[]; dueBy: string }>();
      for (const d of undeposited) {
        const due = tdsDepositDueDate(d.deducted_on);
        if (due >= books.today) continue;
        const o = overdueBySection.get(d.section_code) ?? { amount: [], dueBy: due };
        o.amount.push(d.tds_amount);
        if (due < o.dueBy) o.dueBy = due;
        overdueBySection.set(d.section_code, o);
      }
      return {
        currency: books.currency,
        financialYear: fy,
        quarter,
        from,
        to,
        tan: profile.tan,
        deductions: rows.map((d) => ({
          id: d.id,
          sectionCode: d.section_code,
          payeeName: d.payee_name,
          payeePan: d.payee_pan,
          deducteeType: d.deductee_type,
          deductedOn: d.deducted_on,
          grossAmount: d.gross_amount,
          baseAmount: d.base_amount,
          rate: d.rate,
          tdsAmount: d.tds_amount,
          depositDueBy: tdsDepositDueDate(d.deducted_on),
          challanId: d.challan_id,
          challan: d.challan_id ? { bsrCode: d.bsr_code as string, challanSerial: d.challan_serial as string, paidOn: d.paid_on as string } : null,
          sourceType: d.source_type,
        })),
        bySection: [...sections.entries()].map(([code, s]) => {
          const tds = sumMoney(s.tds);
          const deposited = sumMoney(s.deposited);
          return { sectionCode: code, deductions: s.deductions, baseAmount: sumMoney(s.base), tdsAmount: tds, deposited, pending: subtractMoney(tds, deposited) };
        }),
        challans: challans.map((c) => ({
          id: c.id as string,
          sectionCode: c.section_code as string,
          taxAmount: c.tax_amount as string,
          interest: c.interest as string,
          paidOn: c.paid_on as string,
          bsrCode: c.bsr_code as string,
          challanSerial: c.challan_serial as string,
          paidFrom: c.paid_from as 'bank' | 'cash_on_hand',
          deductions: c.deductions as number,
        })),
        pendingDeposit: sumMoney(undeposited.map((d) => d.tds_amount)),
        overdue: [...overdueBySection.entries()].map(([code, o]) => ({ sectionCode: code, amount: sumMoney(o.amount), dueBy: o.dueBy })),
      };
    });
  }

  /**
   * TDS on an expense payment: the expense is booked gross, the payee paid
   * net, and the tax withheld owed to the government —
   *   Dr expense (gross) / Cr bank or cash (net) / Cr TDS payable.
   * Whether the payment crosses the section's threshold is the
   * accountant's call here (these payees aren't tracked across the year);
   * the section's thresholds are shown to guide it.
   */
  async recordTdsDeduction(tenantId: string, actorUserId: string, dto: RecordTdsDeductionDto): Promise<{ id: string; tdsAmount: string; netPaid: string }> {
    assertRealDate(dto.date, 'date');
    const pan = upper(dto.pan);
    if (pan && !isValidPan(pan)) throw new BadRequestException('A PAN is 5 letters, 4 digits, 1 letter');
    const gross = moneyFromNumber(dto.grossAmount);
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.repo.books(client);
      if (dto.date > books.today) throw new BadRequestException("A deduction can't be dated in the future");
      const section = await this.rulesRepo.tdsSection(client, dto.sectionCode, dto.date);
      if (!section) throw new BadRequestException(`There is no TDS section ${dto.sectionCode} in force on ${dto.date}`);
      const account = await this.repo.expenseAccount(client, dto.expenseAccountCode);
      if (!account || account.root_type !== 'expense') throw new BadRequestException('Choose an expense account for the payment');
      if (!account.is_active) throw new BadRequestException(`${account.name} is retired`);
      if (account.is_control) throw new BadRequestException(`${account.name} can't take a manual entry`);

      const deducteeType: DeducteeType = !pan ? 'no_pan' : dto.deducteeType ?? deducteeTypeFromPan(pan);
      const rate = deducteeType === 'no_pan' ? section.rateNoPan : deducteeType === 'individual_huf' ? section.rateIndividual : section.rateOther;
      const tds = percentOfMoney(gross, rate);
      if (!isPositiveMoney(tds)) throw new BadRequestException(`At ${rate}% there is no tax to withhold on this amount`);
      const net = subtractMoney(gross, tds);

      const sourceId = randomUUID();
      const occurredAt = await this.instantFor(client, books, dto.date);
      const entryId = await this.ledger.postManualWithClient(client, {
        tenantId,
        entryType: 'tds_deducted',
        sourceType: 'tds_expense_payment',
        sourceId,
        occurredAt,
        memo: `${dto.payeeName.trim()} — TDS ${tds} under ${section.code}${dto.reference ? ` (${dto.reference.trim()})` : ''}`,
        createdBy: actorUserId,
        lines: [
          { account: dto.expenseAccountCode, debit: gross },
          { account: dto.paidFrom, credit: net },
          { account: 'tds_payable', credit: tds },
        ],
      });
      const id = await this.rules.recordDeductionWithClient(client, {
        tenantId,
        sectionId: section.id,
        sectionCode: section.code,
        farmerId: null,
        payeeName: dto.payeeName.trim(),
        payeePan: pan,
        deducteeType,
        baseAmount: gross,
        grossAmount: gross,
        rate,
        tdsAmount: tds,
        deductedOn: dto.date,
        payableId: null,
        sourceType: 'tds_expense_payment',
        sourceId,
        ledgerEntryId: entryId,
        createdBy: actorUserId,
      });
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: 'tds_deduction',
        entityId: id,
        after: { section: section.code, payee: dto.payeeName.trim(), gross, rate, tds, entryId },
      });
      return { id, tdsAmount: tds, netPaid: net };
    });
  }

  /**
   * Paying withheld TDS over to the government (challan ITNS 281): the
   * liability clears, interest for late deposit is a finance cost, and each
   * deduction it covers is linked to it — what Form 26Q reports.
   */
  async recordChallan(tenantId: string, actorUserId: string, dto: RecordTdsChallanDto): Promise<{ id: string; taxAmount: string }> {
    assertRealDate(dto.paidOn, 'paidOn');
    const ids = [...new Set(dto.deductionIds)];
    const interest = moneyFromNumber(dto.interest ?? 0);
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.repo.books(client);
      if (dto.paidOn > books.today) throw new BadRequestException("A deposit can't be dated in the future");
      const deductions = await this.repo.deductionsByIds(client, ids);
      if (deductions.length !== ids.length) throw new NotFoundException('One or more deductions were not found');
      const other = deductions.find((d) => d.section_code !== dto.sectionCode);
      if (other) throw new BadRequestException(`A challan covers one section; one deduction is under ${other.section_code}`);
      if (deductions.some((d) => d.challan_id)) throw new ConflictException('One or more of these deductions is already deposited');
      const tax = sumMoney(deductions.map((d) => d.tds_amount));

      const challanId = randomUUID();
      const entryId = await this.ledger.postManualWithClient(client, {
        tenantId,
        entryType: 'tds_deposited',
        sourceType: 'tds_challan',
        sourceId: challanId,
        occurredAt: await this.instantFor(client, books, dto.paidOn),
        memo: `TDS ${dto.sectionCode} deposited — BSR ${dto.bsrCode}, challan ${dto.challanSerial}`,
        createdBy: actorUserId,
        lines: [
          { account: 'tds_payable', debit: tax },
          { account: 'finance_costs', debit: interest },
          { account: dto.paidFrom, credit: sumMoney([tax, interest]) },
        ],
      });
      try {
        await this.repo.insertChallan(client, {
          id: challanId,
          tenantId,
          sectionCode: dto.sectionCode,
          taxAmount: tax,
          interest,
          paidOn: dto.paidOn,
          bsrCode: dto.bsrCode,
          challanSerial: dto.challanSerial,
          paidFrom: dto.paidFrom,
          ledgerEntryId: entryId,
          createdBy: actorUserId,
        });
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw new ConflictException('That challan (BSR code, date, serial) is already recorded');
        throw err;
      }
      await this.repo.linkDeductions(client, challanId, ids);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: 'tds_challan',
        entityId: challanId,
        after: { section: dto.sectionCode, tax, interest, deductions: ids.length, bsr: dto.bsrCode, serial: dto.challanSerial },
      });
      return { id: challanId, taxAmount: tax };
    });
  }

  /** Now, for today's date; otherwise noon that day, tenant-local. */
  private async instantFor(client: PoolClient, books: Books, date: string): Promise<Date> {
    const result = await client.query<{ at: Date }>(
      `SELECT CASE WHEN $2::date = (now() AT TIME ZONE $1)::date THEN now()
                   ELSE ($2::date + time '12:00')::timestamp AT TIME ZONE $1 END AS at`,
      [books.timezone, date],
    );
    return result.rows[0].at;
  }
}

// ---- Returns builders (pure) ----

function bucket(rate: string): RateBucket {
  return { rate, taxableValue: '0.00', igst: '0.00', cgst: '0.00', sgst: '0.00', cess: '0.00' };
}

function addTo(b: RateBucket, line: GstLineRow): void {
  b.taxableValue = sumMoney([b.taxableValue, line.taxable_value]);
  b.igst = sumMoney([b.igst, line.igst]);
  b.cgst = sumMoney([b.cgst, line.cgst]);
  b.sgst = sumMoney([b.sgst, line.sgst]);
  b.cess = sumMoney([b.cess, line.cess]);
}

/**
 * GSTR-1 tables from the period's invoice lines. Taxable lines go to B2B
 * (registered buyer), B2CL (unregistered, inter-state, invoice above the
 * configured limit), or B2CS (the rest, by place of supply and rate).
 * Nil-rated, exempt, and non-GST lines go to the nil table; every
 * classified line goes to the HSN summary, split B2B / B2C.
 */
export function buildGstr1(currency: string, from: string, to: string, profile: TaxProfile, lines: GstLineRow[], financeCharges: number): Gstr1 {
  const issues: string[] = [];
  if (profile.registrationType !== 'regular') {
    issues.push(
      profile.registrationType === 'composition'
        ? 'A composition dealer files CMP-08 and GSTR-4, not GSTR-1 — shown for reference.'
        : 'Not registered for GST — nothing here is reportable.',
    );
  }
  const b2b = new Map<string, Gstr1['b2b'][number] & { buckets: Map<string, RateBucket> }>();
  const b2cl = new Map<string, Gstr1['b2cl'][number] & { buckets: Map<string, RateBucket> }>();
  const b2cs = new Map<string, Gstr1['b2cs'][number]>();
  const nilKeys = [
    ['intra', true, 'Intra-state supplies to registered persons'],
    ['intra', false, 'Intra-state supplies to unregistered persons'],
    ['inter', true, 'Inter-state supplies to registered persons'],
    ['inter', false, 'Inter-state supplies to unregistered persons'],
  ] as const;
  const nil = new Map(nilKeys.map(([s, reg, text]) => [`${s}:${reg}`, { description: text, nilRated: '0.00', exempt: '0.00', nonGst: '0.00' }]));
  const hsn = { b2b: new Map<string, HsnSummaryRow>(), b2c: new Map<string, HsnSummaryRow>() };
  const unclassified = new Set<string>();
  const invoiceNumbers = new Set<string>();

  for (const line of lines) {
    invoiceNumbers.add(line.invoice_number);
    const registered = !!line.buyer_gstin;
    if (line.taxability === 'unclassified') {
      unclassified.add(line.invoice_number);
      continue;
    }
    if (line.taxability === 'not_registered') continue;

    if (line.taxability === 'taxable') {
      if (registered) {
        const inv = b2b.get(line.invoice_id) ?? {
          buyerGstin: line.buyer_gstin as string,
          buyerName: line.customer_name,
          invoiceNumber: line.invoice_number,
          issuedOn: line.issued_on,
          invoiceValue: line.invoice_total,
          placeOfSupply: line.place_of_supply ?? '',
          rates: [],
          buckets: new Map(),
        };
        const b = inv.buckets.get(line.gst_rate) ?? bucket(line.gst_rate);
        addTo(b, line);
        inv.buckets.set(line.gst_rate, b);
        b2b.set(line.invoice_id, inv);
      } else if (!line.intra_state && compareMoney(line.invoice_total, profile.b2clThreshold) > 0) {
        const inv = b2cl.get(line.invoice_id) ?? {
          invoiceNumber: line.invoice_number,
          issuedOn: line.issued_on,
          invoiceValue: line.invoice_total,
          placeOfSupply: line.place_of_supply ?? '',
          rates: [],
          buckets: new Map(),
        };
        const b = inv.buckets.get(line.gst_rate) ?? bucket(line.gst_rate);
        addTo(b, line);
        inv.buckets.set(line.gst_rate, b);
        b2cl.set(line.invoice_id, inv);
      } else {
        const key = `${line.place_of_supply}:${line.intra_state}:${line.gst_rate}`;
        const row = b2cs.get(key) ?? {
          placeOfSupply: line.place_of_supply ?? '',
          intraState: line.intra_state,
          rate: line.gst_rate,
          taxableValue: '0.00',
          igst: '0.00',
          cgst: '0.00',
          sgst: '0.00',
          cess: '0.00',
        };
        addTo(row as unknown as RateBucket, line);
        b2cs.set(key, row);
      }
    } else {
      const n = nil.get(`${line.intra_state ? 'intra' : 'inter'}:${registered}`)!;
      if (line.taxability === 'nil_rated') n.nilRated = sumMoney([n.nilRated, line.taxable_value]);
      if (line.taxability === 'exempt') n.exempt = sumMoney([n.exempt, line.taxable_value]);
      if (line.taxability === 'non_gst') n.nonGst = sumMoney([n.nonGst, line.taxable_value]);
    }

    if (line.taxability !== 'non_gst') {
      const table = registered ? hsn.b2b : hsn.b2c;
      const key = `${line.hsn_code}:${line.uqc}:${line.gst_rate}`;
      const row = table.get(key) ?? {
        hsnCode: line.hsn_code,
        uqc: line.uqc,
        rate: line.gst_rate,
        quantity: '0',
        totalValue: '0.00',
        taxableValue: '0.00',
        igst: '0.00',
        cgst: '0.00',
        sgst: '0.00',
        cess: '0.00',
      };
      row.quantity = addQuantity(row.quantity, line.quantity);
      row.taxableValue = sumMoney([row.taxableValue, line.taxable_value]);
      row.igst = sumMoney([row.igst, line.igst]);
      row.cgst = sumMoney([row.cgst, line.cgst]);
      row.sgst = sumMoney([row.sgst, line.sgst]);
      row.cess = sumMoney([row.cess, line.cess]);
      row.totalValue = sumMoney([row.taxableValue, row.igst, row.cgst, row.sgst, row.cess]);
      table.set(key, row);
    }
  }

  if (unclassified.size > 0) {
    issues.push(
      `${unclassified.size} invoice(s) have lines with no HSN code or GST rule, left out above: ${[...unclassified].slice(0, 10).join(', ')}${
        unclassified.size > 10 ? '…' : ''
      }. Set the products' HSN codes; invoices already issued keep the tax they were issued with.`,
    );
  }
  if (financeCharges > 0) {
    issues.push(`${financeCharges} finance-charge invoice(s) in the period aren't analysed for GST here — review them separately.`);
  }
  const numbers = [...invoiceNumbers].sort();
  const withRates = <T extends { buckets: Map<string, RateBucket> }>(inv: T) => {
    const { buckets, ...rest } = inv;
    return { ...rest, rates: [...buckets.values()] };
  };
  return {
    currency,
    from,
    to,
    supplierGstin: profile.gstin,
    registrationType: profile.registrationType,
    b2b: [...b2b.values()].map(withRates),
    b2cl: [...b2cl.values()].map(withRates),
    b2cs: [...b2cs.values()],
    nil: [...nil.values()],
    hsn: { b2b: [...hsn.b2b.values()], b2c: [...hsn.b2c.values()] },
    documents: {
      series: 'Sale invoices',
      from: numbers[0] ?? null,
      to: numbers[numbers.length - 1] ?? null,
      issued: numbers.length,
      cancelled: 0,
    },
    issues,
  };
}

/** Quantities are 3-dp strings; sum them exactly in thousandths. */
function addQuantity(a: string, b: string): string {
  const milli = (v: string) => {
    const [w, f = ''] = v.split('.');
    return BigInt(w || '0') * 1000n + BigInt((f + '000').slice(0, 3));
  };
  const total = milli(a) + milli(b);
  return `${total / 1000n}.${(total % 1000n).toString().padStart(3, '0')}`;
}

export function buildGstr3b(currency: string, from: string, to: string, profile: TaxProfile, lines: GstLineRow[]): Gstr3b {
  const taxable = lines.filter((l) => l.taxability === 'taxable');
  const sum = (rows: GstLineRow[], key: 'taxable_value' | 'igst' | 'cgst' | 'sgst' | 'cess') => sumMoney(rows.map((r) => r[key]));
  const interUnregistered = new Map<string, { taxable: string[]; igst: string[] }>();
  for (const l of taxable) {
    if (l.intra_state || l.buyer_gstin) continue;
    const pos = l.place_of_supply ?? '';
    const e = interUnregistered.get(pos) ?? { taxable: [], igst: [] };
    e.taxable.push(l.taxable_value);
    e.igst.push(l.igst);
    interUnregistered.set(pos, e);
  }
  const notes = [
    'Input tax credit (table 4) is not tracked in Morbeez — fresh produce bought from farmers carries no GST. Add ITC from your purchase records.',
    'Tax on reverse charge (e.g. goods transport by a GTA) is not tracked — add it from your records.',
  ];
  if (lines.some((l) => l.taxability === 'unclassified')) {
    notes.push('Some sales in the period have no HSN code or GST rule and are left out — see the GSTR-1 view.');
  }
  if (profile.registrationType !== 'regular') notes.unshift('GSTR-3B is filed by regular taxpayers — shown for reference.');
  const outward = {
    taxableValue: sum(taxable, 'taxable_value'),
    igst: sum(taxable, 'igst'),
    cgst: sum(taxable, 'cgst'),
    sgst: sum(taxable, 'sgst'),
    cess: sum(taxable, 'cess'),
  };
  return {
    currency,
    from,
    to,
    outwardTaxable: outward,
    outwardNilExempt: sum(lines.filter((l) => l.taxability === 'nil_rated' || l.taxability === 'exempt'), 'taxable_value'),
    outwardNonGst: sum(lines.filter((l) => l.taxability === 'non_gst'), 'taxable_value'),
    interStateToUnregistered: [...interUnregistered.entries()].map(([pos, e]) => ({
      placeOfSupply: pos,
      taxableValue: sumMoney(e.taxable),
      igst: sumMoney(e.igst),
    })),
    taxPayable: { igst: outward.igst, cgst: outward.cgst, sgst: outward.sgst, cess: outward.cess },
    notes,
  };
}

