import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { compareMoney, isPositiveMoney, normalizeMoney, subtractMoney, sumMoney, toCents } from '../../common/money';
import { LedgerAccount, LedgerLineInput, LedgerPosting, LedgerRepository } from './repositories/ledger.repository';

export type TripExpenseCategory = 'fuel' | 'toll' | 'labour' | 'other';

const EXPENSE_ACCOUNT: Record<TripExpenseCategory, LedgerAccount> = {
  fuel: 'trip_expense_fuel',
  toll: 'trip_expense_toll',
  labour: 'trip_expense_labour',
  other: 'trip_expense_other',
};

/**
 * The one way other modules post to Finance's ledger. Each method takes the
 * caller's client, so the posting commits or rolls back with the business
 * change that caused it (DE.1, DE.3) — a trip can't start without its
 * advance on the books, nor an expense be recorded without its entry.
 *
 * Trip cash is a float: handing the driver an advance moves cash into
 * "Cash with drivers"; each expense draws it down into its transport
 * expense account; the reconciliation returns what's left to cash on hand,
 * booking any gap as a shortage (expense) or overage (income). Customer
 * collections on a trip are separate — they're payments, posted by
 * ReceivablesService.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly ledger: LedgerRepository) {}

  /** A posting to the engine's own system accounts, e.g. payroll (Workforce). */
  postSystemWithClient(client: PoolClient, posting: LedgerPosting): Promise<string> {
    return this.ledger.postWithClient(client, posting);
  }

  /** Manual journals, reversals, and period closes — accounts from the tenant's own chart. */
  postManualWithClient(client: PoolClient, posting: LedgerPosting<string>): Promise<string> {
    return this.ledger.postManualWithClient(client, posting);
  }

  /** Posted when the trip starts: that's when the driver leaves with the cash. No advance, no entry. */
  async postTripAdvanceWithClient(
    client: PoolClient,
    tenantId: string,
    actorUserId: string,
    trip: { id: string; advanceAmount: string; occurredAt: Date },
  ): Promise<void> {
    const amount = normalizeMoney(trip.advanceAmount);
    if (!isPositiveMoney(amount)) return;
    await this.ledger.postWithClient(client, {
      tenantId,
      entryType: 'trip_advance_issued',
      sourceType: 'trip',
      sourceId: trip.id,
      occurredAt: trip.occurredAt,
      memo: 'Cash advance handed to the driver',
      createdBy: actorUserId,
      lines: [
        { account: 'cash_with_drivers', debit: amount },
        { account: 'cash_on_hand', credit: amount },
      ],
    });
  }

  async postTripExpenseWithClient(
    client: PoolClient,
    tenantId: string,
    actorUserId: string,
    expense: { id: string; tripId: string; category: TripExpenseCategory; amount: string; notes: string | null; occurredAt: Date },
  ): Promise<void> {
    const amount = normalizeMoney(expense.amount);
    await this.ledger.postWithClient(client, {
      tenantId,
      entryType: 'trip_expense_recorded',
      sourceType: 'trip_expense',
      sourceId: expense.id,
      occurredAt: expense.occurredAt,
      memo: `Trip ${expense.category}${expense.notes ? `: ${expense.notes}` : ''}`,
      createdBy: actorUserId,
      lines: [
        { account: EXPENSE_ACCOUNT[expense.category], debit: amount },
        { account: 'cash_with_drivers', credit: amount },
      ],
    });
  }

  /**
   * Settles the float: cash handed back returns to cash on hand, and
   * whatever the float still held beyond that is a shortage (or, if the
   * driver brought back more, an overage). The float's balance for the
   * trip is advance − expenses — possibly negative, when the driver spent
   * their own money — so its line goes on whichever side clears it.
   */
  async postTripReconciliationWithClient(
    client: PoolClient,
    tenantId: string,
    actorUserId: string,
    reconciliation: {
      id: string;
      tripId: string;
      advanceAmount: string;
      // Cash that came into the float on the road — spot sales paid in cash.
      cashIn?: string;
      totalExpenses: string;
      cashReturned: string;
      occurredAt: Date;
    },
  ): Promise<void> {
    const float = subtractMoney(sumMoney([reconciliation.advanceAmount, reconciliation.cashIn ?? '0']), reconciliation.totalExpenses);
    const returned = normalizeMoney(reconciliation.cashReturned);
    const variance = subtractMoney(float, returned); // > 0: short; < 0: over
    const lines: LedgerLineInput[] = [{ account: 'cash_on_hand', debit: returned }];
    lines.push(signedLine('cash_with_drivers', subtractMoney('0', float)));
    if (compareMoney(variance, '0') > 0) lines.push({ account: 'cash_shortage', debit: variance });
    if (compareMoney(variance, '0') < 0) lines.push({ account: 'cash_over', credit: subtractMoney('0', variance) });
    // A trip with no advance, no expenses, and nothing returned moved no money.
    if (lines.every((l) => toCents(l.debit ?? '0') === 0n && toCents(l.credit ?? '0') === 0n)) return;
    await this.ledger.postWithClient(client, {
      tenantId,
      entryType: 'trip_reconciled',
      sourceType: 'trip_reconciliation',
      sourceId: reconciliation.id,
      occurredAt: reconciliation.occurredAt,
      memo:
        compareMoney(variance, '0') === 0
          ? 'Trip cash reconciled — balanced'
          : `Trip cash reconciled — ${compareMoney(variance, '0') > 0 ? 'short' : 'over'} ${normalizeMoney(variance.replace('-', ''))}`,
      createdBy: actorUserId,
      lines,
    });
  }

  /**
   * Shrinkage, and stock rejected after grading, at the lot's own cost
   * (SHR.1, LOT.1) — its own expense line, never netted into COGS (SHR.3).
   */
  async postInventoryWriteOffWithClient(
    client: PoolClient,
    tenantId: string,
    actorUserId: string,
    writeOff: { movementId: string; lotId: string; kind: 'shrinkage' | 'rejected_post_acceptance'; value: string; reason: string | null; occurredAt: Date },
  ): Promise<void> {
    const value = normalizeMoney(writeOff.value);
    if (!isPositiveMoney(value)) return;
    await this.ledger.postWithClient(client, {
      tenantId,
      entryType: 'inventory_written_off',
      sourceType: 'inventory_movement',
      sourceId: writeOff.movementId,
      occurredAt: writeOff.occurredAt,
      memo: `${writeOff.kind === 'shrinkage' ? 'Shrinkage' : 'Rejected after grading'}${writeOff.reason ? `: ${writeOff.reason}` : ''}`,
      createdBy: actorUserId,
      lines: [
        { account: 'shrinkage_expense', debit: value },
        { account: 'inventory_asset', credit: value },
      ],
    });
  }
}

/** A positive amount debits the account; a negative one credits it. */
function signedLine(account: LedgerAccount, amount: string): LedgerLineInput {
  return compareMoney(amount, '0') >= 0 ? { account, debit: amount } : { account, credit: subtractMoney('0', amount) };
}
