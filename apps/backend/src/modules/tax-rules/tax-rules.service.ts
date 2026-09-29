import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { compareMoney, isPositiveMoney, minMoney, normalizeMoney, percentOfMoney, subtractMoney, sumMoney } from '../../common/money';
import { deducteeTypeFromPan, financialYearStart } from '../../common/india';
import { DEFAULT_PROFILE, TaxRulesRepository } from './repositories/tax-rules.repository';
import {
  DeducteeType,
  InvoiceLineTaxInput,
  InvoiceTax,
  LineTax,
  TaxProfile,
  TdsAssessment,
} from './entities/tax-rules.entity';

/**
 * The tax rules engine: what GST an invoice carries, and what TDS a
 * payable attracts — both computed from the tenant's configured rules as
 * they stood on the transaction's date, never from constants in code.
 * Pure computation plus the tax schema's own records; Finance calls it
 * inside its own transactions, so an invoice and its tax analysis (or a
 * payable and its deduction) commit together.
 */
@Injectable()
export class TaxRulesService {
  constructor(private readonly repo: TaxRulesRepository) {}

  async profileWithClient(client: PoolClient): Promise<TaxProfile> {
    return (await this.repo.profile(client)) ?? DEFAULT_PROFILE;
  }

  /**
   * GST on a sale, line by line:
   *   - an unregistered business charges none — a plain invoice;
   *   - a composition dealer charges none either — a bill of supply;
   *   - a regular one applies each product's HSN rule on the invoice date:
   *     CGST + SGST (half the rate each) when the place of supply is its own
   *     state, IGST otherwise. Place of supply is the customer's state,
   *     or the supplier's own when the customer has none recorded (goods
   *     handed over locally).
   * A product with no HSN, or an HSN no rule covers, is invoiced untaxed
   * and marked 'unclassified' — delivery never fails on missing tax
   * set-up; the returns and e-invoice checks flag it instead.
   */
  async computeInvoiceTaxWithClient(
    client: PoolClient,
    input: { customerId: string; issuedOn: string; lines: InvoiceLineTaxInput[] },
  ): Promise<InvoiceTax> {
    const profile = await this.profileWithClient(client);
    const buyer = await this.repo.customerTax(client, input.customerId);
    const resolved = await this.repo.resolveProducts(
      client,
      input.lines.map((l) => l.productId),
      input.issuedOn,
      input.lines.map((l) => l.hsnCode ?? null),
    );
    const supplierState = profile.stateCode;
    const placeOfSupply = buyer?.state_code ?? supplierState;
    const intraState = !supplierState || !placeOfSupply || supplierState === placeOfSupply;
    const charges = profile.registrationType === 'regular';

    const lines: LineTax[] = input.lines.map((line, i) => {
      const { hsn_code, base_uom, rule } = resolved[i];
      const taxable = normalizeMoney(line.taxableValue);
      const base = {
        hsnCode: hsn_code,
        uqc: TaxRulesRepository.uqcFor(base_uom),
        ruleId: rule?.id ?? null,
        taxableValue: taxable,
        cgst: '0.00',
        sgst: '0.00',
        igst: '0.00',
        cess: '0.00',
        total: taxable,
      };
      if (profile.registrationType === 'unregistered') {
        return { ...base, taxability: 'not_registered', gstRate: '0.00', cessRate: '0.00', ruleId: null };
      }
      if (!rule) return { ...base, taxability: 'unclassified', gstRate: '0.00', cessRate: '0.00' };
      if (!charges || rule.taxability !== 'taxable') {
        // A composition dealer records the classification but charges nothing.
        return { ...base, taxability: rule.taxability, gstRate: charges ? rule.rate : '0.00', cessRate: '0.00' };
      }
      const cgst = intraState ? percentOfMoney(taxable, rule.rate, 2) : '0.00';
      const sgst = intraState ? percentOfMoney(taxable, rule.rate, 2) : '0.00';
      const igst = intraState ? '0.00' : percentOfMoney(taxable, rule.rate);
      const cess = percentOfMoney(taxable, rule.cessRate);
      return {
        ...base,
        taxability: 'taxable',
        gstRate: rule.rate,
        cessRate: rule.cessRate,
        cgst,
        sgst,
        igst,
        cess,
        total: sumMoney([taxable, cgst, sgst, igst, cess]),
      };
    });

    const total = (key: 'taxableValue' | 'cgst' | 'sgst' | 'igst' | 'cess' | 'total') => sumMoney(lines.map((l) => l[key]));
    const taxCharged = sumMoney([total('cgst'), total('sgst'), total('igst'), total('cess')]);
    return {
      documentType:
        profile.registrationType === 'unregistered'
          ? 'invoice'
          : profile.registrationType === 'composition' || !isPositiveMoney(taxCharged)
            ? 'bill_of_supply'
            : 'tax_invoice',
      registrationType: profile.registrationType,
      supplierGstin: profile.gstin,
      supplierState,
      buyerGstin: buyer?.gstin ?? null,
      buyerLegalName: buyer?.legal_name ?? null,
      buyerAddressLine1: buyer?.address_line1 ?? null,
      buyerCity: buyer?.city ?? null,
      buyerPincode: buyer?.pincode ?? null,
      placeOfSupply,
      intraState,
      lines,
      taxableValue: total('taxableValue'),
      cgst: total('cgst'),
      sgst: total('sgst'),
      igst: total('igst'),
      cess: total('cess'),
      total: total('total'),
    };
  }

  recordInvoiceTaxWithClient(client: PoolClient, tenantId: string, invoiceId: string, lineIds: string[], tax: InvoiceTax): Promise<void> {
    return this.repo.insertInvoiceTax(client, tenantId, invoiceId, lineIds, tax);
  }

  /**
   * TDS on what a farmer is owed for a graded lot, under the section the
   * tenant applies to farmer purchases (none, unless set — e.g. 194Q only
   * once the tenant's own turnover crosses its limit). Credit is when TDS
   * falls due, so it's assessed at grading, not payment.
   *
   * `priorThisYear` is everything already accrued to this farmer in the
   * financial year before this lot. Two ways a threshold works:
   *   - excess_over_annual (194Q): only the part of the year's purchases
   *     above the annual limit is taxed;
   *   - full_once_crossed (194C and most others): once a single payment or
   *     the year's total crosses its limit, the whole of it is taxed —
   *     including earlier amounts that weren't.
   */
  async assessFarmerTdsWithClient(
    client: PoolClient,
    input: { farmerId: string; amount: string; date: string; priorThisYear: string },
  ): Promise<TdsAssessment | null> {
    const profile = await this.profileWithClient(client);
    if (!profile.farmerTdsSection) return null;
    const farmer = await this.repo.farmerTax(client, input.farmerId);
    if (farmer?.tds_exempt) return null;
    const section = await this.repo.tdsSection(client, profile.farmerTdsSection, input.date);
    if (!section) return null;

    const pan = farmer?.pan ?? null;
    const deducteeType: DeducteeType = !pan ? 'no_pan' : farmer?.deductee_type ?? deducteeTypeFromPan(pan);
    const rate = deducteeType === 'no_pan' ? section.rateNoPan : deducteeType === 'individual_huf' ? section.rateIndividual : section.rateOther;

    const amount = normalizeMoney(input.amount);
    const after = sumMoney([input.priorThisYear, amount]);
    let base = '0.00';
    if (section.basis === 'excess_over_annual') {
      const limit = section.annualThreshold ?? '0';
      if (compareMoney(after, limit) > 0) base = minMoney(amount, subtractMoney(after, limit));
    } else {
      const singleCrossed = section.singleThreshold !== null && compareMoney(amount, section.singleThreshold) > 0;
      const annualCrossed = section.annualThreshold !== null && compareMoney(after, section.annualThreshold) > 0;
      if (annualCrossed) {
        const taxed = await this.repo.taxedBaseThisYear(client, input.farmerId, section.code, financialYearStart(input.date), input.date);
        const catchUp = subtractMoney(input.priorThisYear, taxed);
        base = sumMoney([amount, compareMoney(catchUp, '0') > 0 ? catchUp : '0']);
      } else if (singleCrossed) {
        base = amount;
      }
    }
    const tds = percentOfMoney(base, rate);
    if (!isPositiveMoney(tds)) return null;
    return { section, payeeName: farmer?.name ?? 'Farmer', deducteeType, pan, rate, baseAmount: base, tdsAmount: tds };
  }

  recordDeductionWithClient(
    client: PoolClient,
    fields: Parameters<TaxRulesRepository['insertDeduction']>[1],
  ): Promise<string> {
    return this.repo.insertDeduction(client, fields);
  }
}
