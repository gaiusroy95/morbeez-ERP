import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { fromCents, toCents } from '../../../common/money';

// The system accounts the engine itself posts to — every tenant's chart has
// them (money.ledger_account is the template; migrations
// create-finance-ledger and create-tenant-chart-of-accounts). A tenant's own
// accounts are posted to only by manual journals (postManualWithClient).
export type LedgerAccount =
  | 'cash_on_hand'
  | 'bank'
  | 'cash_with_drivers'
  | 'accounts_receivable'
  | 'inventory_asset'
  | 'farmer_advance'
  | 'accounts_payable_farmer'
  | 'retained_earnings'
  | 'revenue_sales'
  | 'finance_charge_income'
  | 'cash_over'
  | 'cost_of_goods_sold'
  | 'shrinkage_expense'
  | 'trip_expense_fuel'
  | 'trip_expense_toll'
  | 'trip_expense_labour'
  | 'trip_expense_other'
  | 'cash_shortage'
  | 'finance_costs'
  | 'output_cgst'
  | 'output_sgst'
  | 'output_igst'
  | 'output_cess'
  | 'tds_payable'
  | 'employee_advance'
  | 'wages_payable'
  | 'salaries_wages'
  | 'incentives_expense'
  | 'vehicle_fuel'
  | 'vehicle_insurance_taxes'
  | 'vehicle_hire_charges'
  | 'repairs_maintenance'
  | 'depreciation_expense'
  | 'fixed_assets_vehicles'
  | 'accumulated_depreciation'
  | 'gain_on_disposal'
  | 'loss_on_disposal'
  | 'owner_capital'
  | 'hire_payable'
  | 'vehicle_loans'
  | 'loan_interest'
  | 'crate_recoveries'
  | 'crate_purchases';

export type LedgerEntryType =
  | 'invoice_issued'
  | 'cogs_recognized'
  | 'payable_accrued'
  | 'payment_received'
  | 'payment_reversed'
  | 'farmer_payment_made'
  | 'finance_charge_accrued'
  | 'finance_cost_recorded'
  | 'trip_advance_issued'
  | 'trip_expense_recorded'
  | 'trip_reconciled'
  | 'trip_cash_deposited'
  | 'inventory_written_off'
  | 'manual_journal'
  | 'journal_reversal'
  | 'period_close'
  | 'period_reopen'
  | 'tds_deducted'
  | 'tds_deposited'
  | 'worker_advance_paid'
  | 'payroll_accrued'
  | 'payroll_paid'
  | 'payroll_voided'
  | 'vehicle_fuel_bought'
  | 'vehicle_maintained'
  | 'vehicle_document_paid'
  | 'vehicle_capitalized'
  | 'vehicle_depreciated'
  | 'vehicle_disposed'
  | 'vehicle_loan_disbursed'
  | 'vehicle_loan_emi_paid'
  | 'vehicle_hire_billed'
  | 'vehicle_hire_paid'
  | 'crate_charge_invoiced'
  | 'crate_charge_deducted'
  | 'crates_purchased';

export interface LedgerParty {
  type: 'customer' | 'farmer';
  id: string;
}

export interface LedgerLineInput<A extends string = LedgerAccount> {
  account: A;
  party?: LedgerParty;
  debit?: string;
  credit?: string;
}

export interface LedgerPosting<A extends string = LedgerAccount> {
  tenantId: string;
  entryType: LedgerEntryType;
  sourceType: string;
  sourceId: string;
  occurredAt: Date;
  memo: string;
  createdBy: string;
  reversesEntryId?: string;
  lines: LedgerLineInput<A>[];
}

export interface PostedLine {
  account: LedgerAccount;
  partyType: 'customer' | 'farmer' | null;
  partyId: string | null;
  debit: string;
  credit: string;
}

export class UnbalancedEntryError extends Error {}

@Injectable()
export class LedgerRepository {
  /**
   * Posts one balanced entry. Zero-amount lines are dropped (a payment with
   * no fee has no fee line); the rest must balance and number at least two
   * — checked here for a clear error, and again by the database's deferred
   * trigger at COMMIT, which nothing can bypass (Accounting Engine, DE.1).
   */
  postWithClient(client: PoolClient, posting: LedgerPosting): Promise<string> {
    return this.insertWithClient(client, posting);
  }

  /**
   * A posting whose accounts come from the tenant's own chart rather than
   * the system set — manual journals, reversals, and period closes. The
   * database's (tenant_id, account_code) foreign key refuses an account the
   * tenant doesn't have; the caller checks it's active and not a control
   * account first.
   */
  postManualWithClient(client: PoolClient, posting: LedgerPosting<string>): Promise<string> {
    return this.insertWithClient(client, posting);
  }

  private async insertWithClient(client: PoolClient, posting: LedgerPosting<string>): Promise<string> {
    const lines = posting.lines
      .map((line) => ({ ...line, debit: toCents(line.debit ?? '0'), credit: toCents(line.credit ?? '0') }))
      .filter((line) => line.debit !== 0n || line.credit !== 0n);

    for (const line of lines) {
      if (line.debit < 0n || line.credit < 0n || (line.debit > 0n && line.credit > 0n)) {
        throw new UnbalancedEntryError(`Invalid ledger line on ${line.account}`);
      }
    }
    const debits = lines.reduce((sum, line) => sum + line.debit, 0n);
    const credits = lines.reduce((sum, line) => sum + line.credit, 0n);
    if (lines.length < 2 || debits !== credits) {
      throw new UnbalancedEntryError(
        `Ledger entry ${posting.entryType} does not balance (debits ${fromCents(debits)}, credits ${fromCents(credits)})`,
      );
    }

    const entry = await client.query<{ id: string }>(
      `INSERT INTO money.ledger_entry
         (tenant_id, entry_type, source_type, source_id, occurred_at, memo, reverses_entry_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        posting.tenantId,
        posting.entryType,
        posting.sourceType,
        posting.sourceId,
        posting.occurredAt,
        posting.memo,
        posting.reversesEntryId ?? null,
        posting.createdBy,
      ],
    );
    const entryId = entry.rows[0].id;

    // One multi-row insert: the lines land together or not at all.
    const values: unknown[] = [];
    const tuples = lines.map((line, i) => {
      const base = i * 7;
      values.push(
        posting.tenantId,
        entryId,
        line.account,
        line.party?.type ?? null,
        line.party?.id ?? null,
        fromCents(line.debit),
        fromCents(line.credit),
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
    });
    await client.query(
      `INSERT INTO money.ledger_line (tenant_id, entry_id, account_code, party_type, party_id, debit, credit)
       VALUES ${tuples.join(', ')}`,
      values,
    );
    return entryId;
  }

  async findEntryWithClient(
    client: PoolClient,
    entryType: LedgerEntryType,
    sourceId: string,
  ): Promise<{ id: string; lines: PostedLine[] } | null> {
    const entry = await client.query<{ id: string }>(
      'SELECT id FROM money.ledger_entry WHERE entry_type = $1 AND source_id = $2',
      [entryType, sourceId],
    );
    if (!entry.rows[0]) return null;
    const lines = await client.query<{
      account_code: LedgerAccount;
      party_type: 'customer' | 'farmer' | null;
      party_id: string | null;
      debit: string;
      credit: string;
    }>('SELECT account_code, party_type, party_id, debit, credit FROM money.ledger_line WHERE entry_id = $1', [
      entry.rows[0].id,
    ]);
    return {
      id: entry.rows[0].id,
      lines: lines.rows.map((l) => ({
        account: l.account_code,
        partyType: l.party_type,
        partyId: l.party_id,
        debit: l.debit,
        credit: l.credit,
      })),
    };
  }
}
