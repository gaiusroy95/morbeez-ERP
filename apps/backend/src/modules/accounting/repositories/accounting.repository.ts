import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { ReportGroup, RootType } from '../entities/accounting.entity';

// Entry types that move a period's revenue and expenses to retained
// earnings and back. A P&L leaves them out — otherwise a closed period would
// read as zero profit.
export const CLOSING_ENTRY_TYPES = ['period_close', 'period_reopen'];

export interface TenantBooks {
  timezone: string;
  currency: string;
  today: string;
}

export interface AccountRow {
  id: string;
  code: string;
  number: number;
  name: string;
  root_type: RootType;
  report_group: ReportGroup;
  is_system: boolean;
  is_control: boolean;
  is_active: boolean;
  description: string | null;
  version: number;
  net: string; // debit − credit
}

export interface EntryRow {
  id: string;
  entry_type: string;
  source_type: string;
  source_id: string;
  occurred_at: Date;
  date: string;
  memo: string | null;
  reverses_entry_id: string | null;
  reversed_by_entry_id: string | null;
  created_by: string;
  created_by_email: string | null;
  created_at: Date;
  journal_number: number | null;
  reference: string | null;
  total: string;
}

export interface LineRow {
  entry_id: string;
  account_code: string;
  account_number: number;
  account_name: string;
  party_type: 'customer' | 'farmer' | null;
  party_id: string | null;
  party_name: string | null;
  debit: string;
  credit: string;
}

export interface LedgerLineRow {
  entry_id: string;
  occurred_at: Date;
  date: string;
  entry_type: string;
  memo: string | null;
  journal_number: number | null;
  party_name: string | null;
  debit: string;
  credit: string;
}

export interface CloseRow {
  id: string;
  period_start: string | null;
  period_end: string;
  net_income: string;
  closing_entry_id: string | null;
  notes: string | null;
  closed_by: string;
  closed_by_email: string | null;
  closed_at: Date;
  reopened_at: Date | null;
  reopened_by_email: string | null;
  reopen_reason: string | null;
}

const ACCOUNT_COLUMNS = `a.id, a.code, a.number, a.name, a.root_type, a.report_group, a.is_system, a.is_control,
  a.is_active, a.description, a.version`;

const ENTRY_SELECT = `
  SELECT e.id, e.entry_type, e.source_type, e.source_id, e.occurred_at,
         (e.occurred_at AT TIME ZONE $1)::date::text AS date,
         e.memo, e.reverses_entry_id, r.id AS reversed_by_entry_id,
         e.created_by, u.email::text AS created_by_email, e.created_at,
         mj.journal_number, mj.reference,
         (SELECT ROUND(SUM(x.debit), 2)::text FROM money.ledger_line x WHERE x.entry_id = e.id) AS total
  FROM money.ledger_entry e
  LEFT JOIN money.ledger_entry r ON r.reverses_entry_id = e.id
  LEFT JOIN money.manual_journal mj ON e.entry_type = 'manual_journal' AND mj.id = e.source_id
  LEFT JOIN identity.app_user u ON u.id = e.created_by`;

/**
 * Accounting's reads over Finance's ledger (a reporting read model —
 * System Architecture DB.4) and its own writes to the chart of accounts,
 * manual journal headers, and period closes. Ledger lines are only ever
 * written through Finance's LedgerService. RLS scopes every statement to
 * the tenant; the client always comes from DatabaseService.withTenant.
 */
@Injectable()
export class AccountingRepository {
  async books(client: PoolClient): Promise<TenantBooks | null> {
    const result = await client.query<TenantBooks>(
      `SELECT timezone, currency, (now() AT TIME ZONE timezone)::date::text AS today
       FROM tenant.tenant WHERE id = current_tenant_id()`,
    );
    return result.rows[0] ?? null;
  }

  /** Tenant-local dates → [startAt, endAt) instants. `from` null = the beginning of the books. */
  async instants(client: PoolClient, timezone: string, from: string | null, to: string): Promise<{ startAt: Date | null; endAt: Date }> {
    const result = await client.query<{ start_at: Date | null; end_at: Date }>(
      `SELECT CASE WHEN $2::date IS NULL THEN NULL ELSE $2::date::timestamp AT TIME ZONE $1 END AS start_at,
              ($3::date + 1)::timestamp AT TIME ZONE $1 AS end_at`,
      [timezone, from, to],
    );
    return { startAt: result.rows[0].start_at, endAt: result.rows[0].end_at };
  }

  // ---- Chart of accounts ----

  async listAccounts(client: PoolClient, includeInactive: boolean): Promise<AccountRow[]> {
    const result = await client.query<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS}, ROUND(COALESCE(SUM(l.debit - l.credit), 0), 2)::text AS net
       FROM money.account a
       LEFT JOIN money.ledger_line l ON l.tenant_id = a.tenant_id AND l.account_code = a.code
       WHERE $1 OR a.is_active
       GROUP BY a.tenant_id, a.code
       ORDER BY a.number`,
      [includeInactive],
    );
    return result.rows;
  }

  async findAccount(client: PoolClient, code: string): Promise<AccountRow | null> {
    const result = await client.query<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS}, ROUND(COALESCE(SUM(l.debit - l.credit), 0), 2)::text AS net
       FROM money.account a
       LEFT JOIN money.ledger_line l ON l.tenant_id = a.tenant_id AND l.account_code = a.code
       WHERE a.code = $1
       GROUP BY a.tenant_id, a.code`,
      [code],
    );
    return result.rows[0] ?? null;
  }

  async findAccounts(client: PoolClient, codes: string[]): Promise<Omit<AccountRow, 'net'>[]> {
    const result = await client.query<Omit<AccountRow, 'net'>>(
      `SELECT ${ACCOUNT_COLUMNS} FROM money.account a WHERE a.code = ANY($1)`,
      [codes],
    );
    return result.rows;
  }

  async accountNumberTaken(client: PoolClient, number: number, exceptCode?: string): Promise<boolean> {
    const result = await client.query('SELECT 1 FROM money.account WHERE number = $1 AND code IS DISTINCT FROM $2', [
      number,
      exceptCode ?? null,
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  async codesLike(client: PoolClient, base: string): Promise<string[]> {
    const result = await client.query<{ code: string }>(
      "SELECT code FROM money.account WHERE code = $1 OR code LIKE $1 || '\\_%'",
      [base],
    );
    return result.rows.map((r) => r.code);
  }

  async insertAccount(
    client: PoolClient,
    tenantId: string,
    actorUserId: string,
    fields: { code: string; number: number; name: string; rootType: RootType; reportGroup: ReportGroup; description: string | null },
  ): Promise<void> {
    await client.query(
      `INSERT INTO money.account (tenant_id, code, number, name, root_type, report_group, description, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [tenantId, fields.code, fields.number, fields.name, fields.rootType, fields.reportGroup, fields.description, actorUserId],
    );
  }

  /** Null when the version didn't match (someone changed it first). */
  async updateAccount(
    client: PoolClient,
    code: string,
    version: number,
    fields: { number?: number; name?: string; description?: string; isActive?: boolean },
  ): Promise<boolean> {
    const result = await client.query(
      `UPDATE money.account SET
         number = COALESCE($3, number),
         name = COALESCE($4, name),
         description = CASE WHEN $5::text IS NULL THEN description ELSE NULLIF(btrim($5), '') END,
         is_active = COALESCE($6, is_active),
         version = version + 1,
         updated_at = now()
       WHERE code = $1 AND version = $2`,
      [code, version, fields.number ?? null, fields.name ?? null, fields.description ?? null, fields.isActive ?? null],
    );
    return (result.rowCount ?? 0) === 1;
  }

  // ---- Journal entries ----

  async nextJournalNumber(client: PoolClient): Promise<number> {
    // Serialises numbering per tenant for the rest of the transaction.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('manual_journal:' || current_tenant_id()::text))`);
    const result = await client.query<{ next: number }>(
      'SELECT COALESCE(MAX(journal_number), 0) + 1 AS next FROM money.manual_journal',
    );
    return result.rows[0].next;
  }

  async insertManualJournal(
    client: PoolClient,
    fields: { id: string; tenantId: string; journalNumber: number; entryDate: string; reference: string | null; memo: string; createdBy: string },
  ): Promise<void> {
    await client.query(
      `INSERT INTO money.manual_journal (id, tenant_id, journal_number, entry_date, reference, memo, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [fields.id, fields.tenantId, fields.journalNumber, fields.entryDate, fields.reference, fields.memo, fields.createdBy],
    );
  }

  /**
   * The instant a journal dated `date` is posted at: now, if it's dated
   * today; otherwise noon that day, tenant-local — inside the day whatever
   * the reports' day boundaries.
   */
  async journalInstant(client: PoolClient, timezone: string, date: string): Promise<Date> {
    const result = await client.query<{ at: Date }>(
      `SELECT CASE WHEN $2::date = (now() AT TIME ZONE $1)::date THEN now()
                   ELSE ($2::date + time '12:00')::timestamp AT TIME ZONE $1 END AS at`,
      [timezone, date],
    );
    return result.rows[0].at;
  }

  async listEntries(
    client: PoolClient,
    timezone: string,
    filter: { startAt: Date | null; endAt: Date; accountCode?: string; manualOnly: boolean; limit: number; offset: number },
  ): Promise<{ rows: EntryRow[]; total: number }> {
    // Placeholders numbered from `first`: the list query's $1 is the
    // timezone, which the count query doesn't take — an unused parameter
    // has no type Postgres can infer.
    const where = (first: number) => {
      const [start, end, code, manual] = [first, first + 1, first + 2, first + 3].map((n) => `$${n}`);
      return `e.occurred_at < ${end} AND (${start}::timestamptz IS NULL OR e.occurred_at >= ${start})
        AND (${code}::text IS NULL OR EXISTS (SELECT 1 FROM money.ledger_line f WHERE f.entry_id = e.id AND f.account_code = ${code}))
        AND (NOT ${manual}::boolean OR e.entry_type IN ('manual_journal', 'journal_reversal'))`;
    };
    const params = [filter.startAt, filter.endAt, filter.accountCode ?? null, filter.manualOnly];
    const total = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM money.ledger_entry e WHERE ${where(1)}`,
      params,
    );
    const rows = await client.query<EntryRow>(
      `${ENTRY_SELECT}
       WHERE ${where(2)}
       ORDER BY e.occurred_at DESC, e.created_at DESC, e.id
       LIMIT $6 OFFSET $7`,
      [timezone, ...params, filter.limit, filter.offset],
    );
    return { rows: rows.rows, total: total.rows[0].n };
  }

  async findEntry(client: PoolClient, timezone: string, id: string): Promise<EntryRow | null> {
    const result = await client.query<EntryRow>(`${ENTRY_SELECT} WHERE e.id = $2`, [timezone, id]);
    return result.rows[0] ?? null;
  }

  async linesFor(client: PoolClient, entryIds: string[]): Promise<LineRow[]> {
    if (entryIds.length === 0) return [];
    const result = await client.query<LineRow>(
      `SELECT l.entry_id, l.account_code, a.number AS account_number, a.name AS account_name,
              l.party_type, l.party_id, COALESCE(c.name, f.name) AS party_name,
              l.debit::text AS debit, l.credit::text AS credit
       FROM money.ledger_line l
       JOIN money.account a ON a.tenant_id = l.tenant_id AND a.code = l.account_code
       LEFT JOIN trading_partners.customer c ON l.party_type = 'customer' AND c.id = l.party_id
       LEFT JOIN trading_partners.farmer f ON l.party_type = 'farmer' AND f.id = l.party_id
       WHERE l.entry_id = ANY($1)
       ORDER BY l.entry_id, (l.debit > 0) DESC, a.number`,
      [entryIds],
    );
    return result.rows;
  }

  // ---- General ledger ----

  async accountMovement(
    client: PoolClient,
    code: string,
    startAt: Date,
    endAt: Date,
  ): Promise<{ opening: string; debit: string; credit: string }> {
    const result = await client.query<{ opening: string; debit: string; credit: string }>(
      `SELECT ROUND(COALESCE(SUM(l.debit - l.credit) FILTER (WHERE e.occurred_at < $2), 0), 2)::text AS opening,
              ROUND(COALESCE(SUM(l.debit) FILTER (WHERE e.occurred_at >= $2), 0), 2)::text AS debit,
              ROUND(COALESCE(SUM(l.credit) FILTER (WHERE e.occurred_at >= $2), 0), 2)::text AS credit
       FROM money.ledger_line l
       JOIN money.ledger_entry e ON e.id = l.entry_id
       WHERE l.account_code = $1 AND e.occurred_at < $3`,
      [code, startAt, endAt],
    );
    return result.rows[0];
  }

  async accountLines(
    client: PoolClient,
    timezone: string,
    code: string,
    startAt: Date,
    endAt: Date,
    limit: number,
  ): Promise<LedgerLineRow[]> {
    const result = await client.query<LedgerLineRow>(
      `SELECT e.id AS entry_id, e.occurred_at, (e.occurred_at AT TIME ZONE $1)::date::text AS date,
              e.entry_type, e.memo, mj.journal_number, COALESCE(c.name, f.name) AS party_name,
              l.debit::text AS debit, l.credit::text AS credit
       FROM money.ledger_line l
       JOIN money.ledger_entry e ON e.id = l.entry_id
       LEFT JOIN money.manual_journal mj ON e.entry_type = 'manual_journal' AND mj.id = e.source_id
       LEFT JOIN trading_partners.customer c ON l.party_type = 'customer' AND c.id = l.party_id
       LEFT JOIN trading_partners.farmer f ON l.party_type = 'farmer' AND f.id = l.party_id
       WHERE l.account_code = $2 AND e.occurred_at >= $3 AND e.occurred_at < $4
       ORDER BY e.occurred_at, e.created_at, e.id, l.id
       LIMIT $5`,
      [timezone, code, startAt, endAt, limit],
    );
    return result.rows;
  }

  // ---- Balances for the trial balance and statements ----

  /**
   * Net (debit − credit) per account over [startAt, endAt), every account
   * in the chart. `startAt` null = from the beginning of the books.
   * `excludeClosing` leaves out period-close entries — for a P&L.
   */
  async balances(client: PoolClient, startAt: Date | null, endAt: Date, excludeClosing: boolean): Promise<AccountRow[]> {
    const result = await client.query<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS}, ROUND(COALESCE(SUM(m.debit - m.credit), 0), 2)::text AS net
       FROM money.account a
       LEFT JOIN (
         SELECT l.tenant_id, l.account_code, l.debit, l.credit
         FROM money.ledger_line l
         JOIN money.ledger_entry e ON e.id = l.entry_id
         WHERE e.occurred_at < $2
           AND ($1::timestamptz IS NULL OR e.occurred_at >= $1)
           AND (NOT $3 OR e.entry_type <> ALL($4))
       ) m ON m.tenant_id = a.tenant_id AND m.account_code = a.code
       GROUP BY a.tenant_id, a.code
       ORDER BY a.number`,
      [startAt, endAt, excludeClosing, CLOSING_ENTRY_TYPES],
    );
    return result.rows;
  }

  /**
   * For each entry in the range that moved cash, the non-cash side of it,
   * per account, as credit − debit. Because every entry balances, these sum
   * exactly to the change in cash — each one says where cash came from or
   * went (a direct-method cash-flow statement straight off the ledger).
   * Transfers between cash accounts have no non-cash side and drop out.
   */
  async cashCounterparts(
    client: PoolClient,
    startAt: Date,
    endAt: Date,
  ): Promise<{ code: string; number: number; name: string; report_group: ReportGroup; amount: string }[]> {
    const result = await client.query<{ code: string; number: number; name: string; report_group: ReportGroup; amount: string }>(
      `WITH cash_entries AS (
         SELECT DISTINCT l.entry_id
         FROM money.ledger_line l
         JOIN money.ledger_entry e ON e.id = l.entry_id
         JOIN money.account a ON a.tenant_id = l.tenant_id AND a.code = l.account_code
         WHERE a.report_group = 'cash' AND e.occurred_at >= $1 AND e.occurred_at < $2
       )
       SELECT a.code, a.number, a.name, a.report_group, ROUND(SUM(l.credit - l.debit), 2)::text AS amount
       FROM money.ledger_line l
       JOIN cash_entries ce ON ce.entry_id = l.entry_id
       JOIN money.account a ON a.tenant_id = l.tenant_id AND a.code = l.account_code
       WHERE a.report_group <> 'cash'
       GROUP BY a.code, a.number, a.name, a.report_group
       HAVING SUM(l.credit - l.debit) <> 0
       ORDER BY a.number`,
      [startAt, endAt],
    );
    return result.rows;
  }

  // ---- Periods ----

  async lockedThrough(client: PoolClient): Promise<string | null> {
    const result = await client.query<{ through: string | null }>(
      'SELECT max(period_end)::text AS through FROM money.period_close WHERE reopened_at IS NULL',
    );
    return result.rows[0].through;
  }

  async listCloses(client: PoolClient): Promise<CloseRow[]> {
    const result = await client.query<CloseRow>(
      `SELECT pc.id, pc.period_start::text, pc.period_end::text, pc.net_income::text, pc.closing_entry_id, pc.notes,
              pc.closed_by, cu.email::text AS closed_by_email, pc.closed_at,
              pc.reopened_at, ru.email::text AS reopened_by_email, pc.reopen_reason
       FROM money.period_close pc
       LEFT JOIN identity.app_user cu ON cu.id = pc.closed_by
       LEFT JOIN identity.app_user ru ON ru.id = pc.reopened_by
       ORDER BY pc.period_end DESC, pc.closed_at DESC`,
    );
    return result.rows;
  }

  async findClose(client: PoolClient, id: string): Promise<{ id: string; period_end: string; closing_entry_id: string | null; reopened_at: Date | null } | null> {
    const result = await client.query<{ id: string; period_end: string; closing_entry_id: string | null; reopened_at: Date | null }>(
      'SELECT id, period_end::text, closing_entry_id, reopened_at FROM money.period_close WHERE id = $1',
      [id],
    );
    return result.rows[0] ?? null;
  }

  /** Serialises closing and reopening per tenant for the rest of the transaction. */
  async lockPeriods(client: PoolClient): Promise<void> {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('period_close:' || current_tenant_id()::text))`);
  }

  async insertClose(
    client: PoolClient,
    fields: {
      id: string;
      tenantId: string;
      periodStart: string | null;
      periodEnd: string;
      netIncome: string;
      closingEntryId: string | null;
      notes: string | null;
      closedBy: string;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO money.period_close (id, tenant_id, period_start, period_end, net_income, closing_entry_id, notes, closed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [fields.id, fields.tenantId, fields.periodStart, fields.periodEnd, fields.netIncome, fields.closingEntryId, fields.notes, fields.closedBy],
    );
  }

  async markReopened(client: PoolClient, id: string, userId: string, reason: string, reopenEntryId: string | null): Promise<void> {
    await client.query(
      `UPDATE money.period_close
       SET reopened_at = now(), reopened_by = $2, reopen_reason = $3, reopen_entry_id = $4
       WHERE id = $1 AND reopened_at IS NULL`,
      [id, userId, reason, reopenEntryId],
    );
  }

  /** Operational loose ends dated inside a period about to close. */
  async closeWarnings(client: PoolClient, endAt: Date): Promise<{ unreconciled_trips: number; ungraded_lots: number; pending_approvals: number }> {
    const result = await client.query<{ unreconciled_trips: number; ungraded_lots: number; pending_approvals: number }>(
      `SELECT
         (SELECT count(*)::int FROM fulfilment.trip WHERE status = 'completed' AND completed_at < $1) AS unreconciled_trips,
         (SELECT count(*)::int FROM commerce.lot WHERE status = 'received_ungraded' AND received_at < $1) AS ungraded_lots,
         (SELECT count(*)::int FROM approvals.approval_request WHERE status = 'pending' AND created_at < $1) AS pending_approvals`,
      [endAt],
    );
    return result.rows[0];
  }
}
