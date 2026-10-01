import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import {
  AdvanceRecord,
  AssignmentRecord,
  AssignmentStatus,
  IncentiveRule,
  MinimumWageRate,
  PayRate,
  PayrollSettings,
  SettlementLine,
  SettlementRecord,
  WorkerRow,
} from '../entities/payroll.entity';

const RATE_COLUMNS = `r.id, r.employee_id, r.pay_basis, r.rate::text AS rate, r.unit_label,
  r.effective_from::text AS effective_from, r.effective_to::text AS effective_to`;

export const toRate = (r: Record<string, unknown>): PayRate => ({
  id: r.id as string,
  employeeId: r.employee_id as string,
  payBasis: r.pay_basis as PayRate['payBasis'],
  rate: r.rate as string,
  unitLabel: r.unit_label as string | null,
  effectiveFrom: r.effective_from as string,
  effectiveTo: r.effective_to as string | null,
});

const ASSIGNMENT_SELECT = `
  SELECT a.id, a.employee_id, e.name AS employee_name, a.work_date::text AS work_date, a.kind, a.status,
         a.hours::text AS hours, a.units::text AS units, a.trip_id, a.notes, a.settlement_id,
         s.settlement_number, a.version
  FROM workforce.assignment a
  JOIN trading_partners.employee e ON e.id = a.employee_id
  LEFT JOIN workforce.settlement s ON s.id = a.settlement_id`;

const toAssignment = (r: Record<string, unknown>): AssignmentRecord => ({
  id: r.id as string,
  employeeId: r.employee_id as string,
  employeeName: r.employee_name as string,
  workDate: r.work_date as string,
  kind: r.kind as AssignmentRecord['kind'],
  status: r.status as AssignmentStatus,
  hours: r.hours as string | null,
  units: r.units as string | null,
  tripId: r.trip_id as string | null,
  notes: r.notes as string | null,
  settlementId: r.settlement_id as string | null,
  settlementNumber: r.settlement_number as number | null,
  version: r.version as number,
});

// What each advance still has outstanding: recoveries on settlements that
// weren't voided count, drafts included (they hold the recovery until
// approved or discarded).
const ADVANCE_SELECT = `
  SELECT ad.id, ad.employee_id, e.name AS employee_name, ad.amount::text AS amount,
         COALESCE(rec.recovered, 0)::numeric(12,2)::text AS recovered,
         (ad.amount - COALESCE(rec.recovered, 0))::numeric(12,2)::text AS outstanding,
         ad.paid_on::text AS paid_on, ad.paid_from, ad.notes
  FROM workforce.advance ad
  JOIN trading_partners.employee e ON e.id = ad.employee_id
  LEFT JOIN (
    SELECT l.advance_id, -SUM(l.amount) AS recovered
    FROM workforce.settlement_line l JOIN workforce.settlement s ON s.id = l.settlement_id
    WHERE l.kind = 'advance_recovery' AND s.status <> 'void'
    GROUP BY l.advance_id
  ) rec ON rec.advance_id = ad.id`;

const toAdvance = (r: Record<string, unknown>): AdvanceRecord => ({
  id: r.id as string,
  employeeId: r.employee_id as string,
  employeeName: r.employee_name as string,
  amount: r.amount as string,
  recovered: r.recovered as string,
  outstanding: r.outstanding as string,
  paidOn: r.paid_on as string,
  paidFrom: r.paid_from as AdvanceRecord['paidFrom'],
  notes: r.notes as string | null,
});

const SETTLEMENT_SELECT = `
  SELECT s.id, s.settlement_number, s.employee_id, e.name AS employee_name, s.period_start::text AS period_start,
         s.period_end::text AS period_end, s.status, s.gross::text AS gross, s.deductions::text AS deductions,
         s.net::text AS net, s.warnings, s.prepared_by, COALESCE(pu.phone, pu.email::text) AS prepared_by_email, s.prepared_at,
         COALESCE(au.phone, au.email::text) AS approved_by_email, s.approved_at, s.paid_at, s.paid_from, s.payment_reference,
         s.voided_at, s.void_reason, s.version, s.approval_entry_id
  FROM workforce.settlement s
  JOIN trading_partners.employee e ON e.id = s.employee_id
  LEFT JOIN identity.app_user pu ON pu.id = s.prepared_by
  LEFT JOIN identity.app_user au ON au.id = s.approved_by`;

const toSettlement = (r: Record<string, unknown>): SettlementRecord & { approvalEntryId: string | null } => ({
  id: r.id as string,
  settlementNumber: r.settlement_number as number,
  employeeId: r.employee_id as string,
  employeeName: r.employee_name as string,
  periodStart: r.period_start as string,
  periodEnd: r.period_end as string,
  status: r.status as SettlementRecord['status'],
  gross: r.gross as string,
  deductions: r.deductions as string,
  net: r.net as string,
  warnings: r.warnings as string[],
  preparedBy: r.prepared_by as string,
  preparedByEmail: r.prepared_by_email as string | null,
  preparedAt: r.prepared_at as Date,
  approvedByEmail: r.approved_by_email as string | null,
  approvedAt: r.approved_at as Date | null,
  paidAt: r.paid_at as Date | null,
  paidFrom: r.paid_from as SettlementRecord['paidFrom'],
  paymentReference: r.payment_reference as string | null,
  voidedAt: r.voided_at as Date | null,
  voidReason: r.void_reason as string | null,
  version: r.version as number,
  approvalEntryId: r.approval_entry_id as string | null,
});

/**
 * Workforce's own tables (workforce schema, and the employee record it
 * extends). Trips are read only for their times. RLS scopes every
 * statement; the client always comes from DatabaseService.withTenant.
 */
@Injectable()
export class PayrollRepository {
  async today(client: PoolClient): Promise<{ today: string; timezone: string }> {
    const r = await client.query<{ today: string; timezone: string }>(
      `SELECT (now() AT TIME ZONE timezone)::date::text AS today, timezone FROM tenant.tenant WHERE id = current_tenant_id()`,
    );
    return r.rows[0];
  }

  // ---- Settings ----

  async settings(client: PoolClient): Promise<PayrollSettings> {
    const r = await client.query('SELECT default_state_code, min_wage_policy, version FROM workforce.payroll_settings');
    const row = r.rows[0];
    return row
      ? { defaultStateCode: row.default_state_code, minWagePolicy: row.min_wage_policy, version: row.version }
      : { defaultStateCode: null, minWagePolicy: 'top_up', version: 0 };
  }

  async saveSettings(client: PoolClient, tenantId: string, userId: string, version: number, s: Omit<PayrollSettings, 'version'>): Promise<boolean> {
    if (version === 0) {
      const r = await client.query(
        `INSERT INTO workforce.payroll_settings (tenant_id, default_state_code, min_wage_policy, updated_by)
         VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id) DO NOTHING`,
        [tenantId, s.defaultStateCode, s.minWagePolicy, userId],
      );
      return (r.rowCount ?? 0) === 1;
    }
    const r = await client.query(
      `UPDATE workforce.payroll_settings SET default_state_code = $1, min_wage_policy = $2, updated_by = $3,
         version = version + 1, updated_at = now() WHERE version = $4`,
      [s.defaultStateCode, s.minWagePolicy, userId, version],
    );
    return (r.rowCount ?? 0) === 1;
  }

  // ---- Workers ----

  async workers(client: PoolClient, today: string, employeeId: string | null = null): Promise<WorkerRow[]> {
    const r = await client.query(
      `SELECT e.id AS employee_id, e.name, e.role_type, e.status, (e.user_id IS NOT NULL) AS has_login,
              COALESCE(p.employment_type, 'permanent') AS employment_type, COALESCE(p.skill_category, 'unskilled') AS skill_category,
              p.work_state_code, p.joined_on::text AS joined_on, p.left_on::text AS left_on, p.phone,
              COALESCE(p.version, 0) AS profile_version,
              cur.id AS rate_id, cur.pay_basis, cur.rate::text AS rate, cur.unit_label,
              cur.effective_from::text AS effective_from, cur.effective_to::text AS effective_to,
              COALESCE((SELECT SUM(ad.amount) FROM workforce.advance ad WHERE ad.employee_id = e.id), 0)
                - COALESCE((SELECT -SUM(l.amount) FROM workforce.settlement_line l JOIN workforce.settlement s ON s.id = l.settlement_id
                            WHERE s.employee_id = e.id AND l.kind = 'advance_recovery' AND s.status <> 'void'), 0) AS advance_outstanding
       FROM trading_partners.employee e
       LEFT JOIN workforce.worker_profile p ON p.employee_id = e.id
       LEFT JOIN LATERAL (
         SELECT * FROM workforce.pay_rate r
         WHERE r.employee_id = e.id AND r.effective_from <= $1::date AND (r.effective_to IS NULL OR r.effective_to >= $1::date)
         ORDER BY r.effective_from DESC LIMIT 1
       ) cur ON true
       WHERE $2::uuid IS NULL OR e.id = $2
       ORDER BY e.status, e.name`,
      [today, employeeId],
    );
    return r.rows.map((row) => ({
      employeeId: row.employee_id,
      name: row.name,
      roleType: row.role_type,
      status: row.status,
      hasLogin: row.has_login,
      employmentType: row.employment_type,
      skillCategory: row.skill_category,
      workStateCode: row.work_state_code,
      joinedOn: row.joined_on,
      leftOn: row.left_on,
      phone: row.phone,
      profileVersion: Number(row.profile_version),
      currentRate: row.rate_id
        ? toRate({ id: row.rate_id, employee_id: row.employee_id, pay_basis: row.pay_basis, rate: row.rate, unit_label: row.unit_label, effective_from: row.effective_from, effective_to: row.effective_to })
        : null,
      advanceOutstanding: Number(row.advance_outstanding).toFixed(2),
    }));
  }

  async employeeExists(client: PoolClient, id: string): Promise<{ role_type: string; status: string; name: string } | null> {
    const r = await client.query('SELECT role_type, status, name FROM trading_partners.employee WHERE id = $1', [id]);
    return r.rows[0] ?? null;
  }

  async saveProfile(
    client: PoolClient,
    tenantId: string,
    employeeId: string,
    userId: string,
    version: number,
    p: { employmentType: string; skillCategory: string; workStateCode: string | null; joinedOn: string | null; leftOn: string | null; phone: string | null },
  ): Promise<boolean> {
    const values = [employeeId, tenantId, p.employmentType, p.skillCategory, p.workStateCode, p.joinedOn, p.leftOn, p.phone, userId];
    if (version === 0) {
      const r = await client.query(
        `INSERT INTO workforce.worker_profile
           (employee_id, tenant_id, employment_type, skill_category, work_state_code, joined_on, left_on, phone, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (employee_id) DO NOTHING`,
        values,
      );
      return (r.rowCount ?? 0) === 1;
    }
    const r = await client.query(
      `UPDATE workforce.worker_profile SET employment_type = $3, skill_category = $4, work_state_code = $5, joined_on = $6,
         left_on = $7, phone = $8, updated_by = $9, version = version + 1, updated_at = now()
       WHERE employee_id = $1 AND tenant_id = $2 AND version = $10`,
      [...values, version],
    );
    return (r.rowCount ?? 0) === 1;
  }

  async ratesFor(client: PoolClient, employeeId: string): Promise<PayRate[]> {
    const r = await client.query(`SELECT ${RATE_COLUMNS} FROM workforce.pay_rate r WHERE r.employee_id = $1 ORDER BY r.effective_from DESC`, [employeeId]);
    return r.rows.map(toRate);
  }

  /** Ends the rate still open on `from` the day before, then adds the new one. */
  async addRate(
    client: PoolClient,
    tenantId: string,
    userId: string,
    rate: { employeeId: string; payBasis: string; rate: string; unitLabel: string | null; effectiveFrom: string },
  ): Promise<string> {
    await client.query(
      `UPDATE workforce.pay_rate SET effective_to = $2::date - 1
       WHERE employee_id = $1 AND effective_from < $2::date AND (effective_to IS NULL OR effective_to >= $2::date)`,
      [rate.employeeId, rate.effectiveFrom],
    );
    const r = await client.query<{ id: string }>(
      `INSERT INTO workforce.pay_rate (tenant_id, employee_id, pay_basis, rate, unit_label, effective_from, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [tenantId, rate.employeeId, rate.payBasis, rate.rate, rate.unitLabel, rate.effectiveFrom, userId],
    );
    return r.rows[0].id;
  }

  /** The last day already covered by a non-void settlement for this worker — rates can't change before it. */
  async lastSettledDay(client: PoolClient, employeeId: string): Promise<string | null> {
    const r = await client.query<{ d: string | null }>(
      "SELECT max(period_end)::text AS d FROM workforce.settlement WHERE employee_id = $1 AND status <> 'void'",
      [employeeId],
    );
    return r.rows[0].d;
  }

  // ---- Assignments ----

  async assignments(client: PoolClient, from: string, to: string, employeeId: string | null): Promise<AssignmentRecord[]> {
    const r = await client.query(
      `${ASSIGNMENT_SELECT}
       WHERE a.work_date BETWEEN $1::date AND $2::date AND ($3::uuid IS NULL OR a.employee_id = $3)
       ORDER BY a.work_date DESC, e.name, a.created_at`,
      [from, to, employeeId],
    );
    return r.rows.map(toAssignment);
  }

  async findAssignment(client: PoolClient, id: string): Promise<AssignmentRecord | null> {
    const r = await client.query(`${ASSIGNMENT_SELECT} WHERE a.id = $1`, [id]);
    return r.rows[0] ? toAssignment(r.rows[0]) : null;
  }

  async insertAssignment(
    client: PoolClient,
    tenantId: string,
    userId: string,
    a: { employeeId: string; workDate: string; kind: string; status: string; hours: string | null; units: string | null; tripId: string | null; notes: string | null },
  ): Promise<string> {
    const r = await client.query<{ id: string }>(
      `INSERT INTO workforce.assignment (tenant_id, employee_id, work_date, kind, status, hours, units, trip_id, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [tenantId, a.employeeId, a.workDate, a.kind, a.status, a.hours, a.units, a.tripId, a.notes, userId],
    );
    return r.rows[0].id;
  }

  /** Null row count = the version didn't match, or it's already on a settlement. */
  async updateAssignment(
    client: PoolClient,
    id: string,
    version: number,
    a: { status: string; hours: string | null; units: string | null; notes: string | null },
  ): Promise<boolean> {
    const r = await client.query(
      `UPDATE workforce.assignment SET status = $3, hours = $4, units = $5, notes = $6, version = version + 1, updated_at = now()
       WHERE id = $1 AND version = $2 AND settlement_id IS NULL`,
      [id, version, a.status, a.hours, a.units, a.notes],
    );
    return (r.rowCount ?? 0) === 1;
  }

  /** A completed trip's hours, in the tenant's timezone. */
  async tripWork(client: PoolClient, tripId: string): Promise<{ driver_employee_id: string; work_date: string; hours: string | null; stops: number } | null> {
    const r = await client.query(
      `SELECT t.driver_employee_id,
              ((COALESCE(t.started_at, t.completed_at) AT TIME ZONE tn.timezone)::date)::text AS work_date,
              CASE WHEN t.started_at IS NULL OR t.completed_at IS NULL THEN NULL
                   ELSE LEAST(24, GREATEST(0.01, ROUND(EXTRACT(EPOCH FROM (t.completed_at - t.started_at)) / 3600.0, 2)))::text END AS hours,
              (SELECT count(*)::int FROM fulfilment.trip_stop s WHERE s.trip_id = t.id AND s.status = 'completed') AS stops
       FROM fulfilment.trip t JOIN tenant.tenant tn ON tn.id = t.tenant_id
       WHERE t.id = $1`,
      [tripId],
    );
    return r.rows[0] ?? null;
  }

  async tripAssignmentExists(client: PoolClient, tripId: string, employeeId: string): Promise<boolean> {
    const r = await client.query('SELECT 1 FROM workforce.assignment WHERE trip_id = $1 AND employee_id = $2', [tripId, employeeId]);
    return (r.rowCount ?? 0) > 0;
  }

  /** Completed and absent work in a period, not yet on any settlement. */
  async unsettledWork(client: PoolClient, employeeId: string, from: string, to: string): Promise<AssignmentRecord[]> {
    const r = await client.query(
      `${ASSIGNMENT_SELECT}
       WHERE a.employee_id = $1 AND a.work_date BETWEEN $2::date AND $3::date
         AND a.status IN ('completed', 'absent') AND a.settlement_id IS NULL
       ORDER BY a.work_date`,
      [employeeId, from, to],
    );
    return r.rows.map(toAssignment);
  }

  async linkAssignments(client: PoolClient, settlementId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await client.query('UPDATE workforce.assignment SET settlement_id = $1 WHERE id = ANY($2) AND settlement_id IS NULL', [settlementId, ids]);
  }

  async unlinkAssignments(client: PoolClient, settlementId: string): Promise<void> {
    await client.query('UPDATE workforce.assignment SET settlement_id = NULL WHERE settlement_id = $1', [settlementId]);
  }

  // ---- Rules ----

  async incentiveRules(client: PoolClient): Promise<IncentiveRule[]> {
    const r = await client.query(
      `SELECT id, name, role_type, basis, threshold::text AS threshold, amount::text AS amount,
              effective_from::text AS effective_from, effective_to::text AS effective_to
       FROM workforce.incentive_rule ORDER BY effective_to IS NOT NULL, name, effective_from DESC`,
    );
    return r.rows.map((x) => ({
      id: x.id,
      name: x.name,
      roleType: x.role_type,
      basis: x.basis,
      threshold: x.threshold,
      amount: x.amount,
      effectiveFrom: x.effective_from,
      effectiveTo: x.effective_to,
    }));
  }

  async insertIncentiveRule(
    client: PoolClient,
    tenantId: string,
    userId: string,
    x: { name: string; roleType: string | null; basis: string; threshold: string; amount: string; effectiveFrom: string },
  ): Promise<string> {
    const r = await client.query<{ id: string }>(
      `INSERT INTO workforce.incentive_rule (tenant_id, name, role_type, basis, threshold, amount, effective_from, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [tenantId, x.name, x.roleType, x.basis, x.threshold, x.amount, x.effectiveFrom, userId],
    );
    return r.rows[0].id;
  }

  async endRule(client: PoolClient, table: 'incentive_rule' | 'minimum_wage_rate', id: string, effectiveTo: string): Promise<{ effective_from: string } | null> {
    const r = await client.query(
      `UPDATE workforce.${table} SET effective_to = $2 WHERE id = $1 AND effective_from <= $2::date RETURNING effective_from::text`,
      [id, effectiveTo],
    );
    return r.rows[0] ?? null;
  }

  async minimumWages(client: PoolClient): Promise<MinimumWageRate[]> {
    const r = await client.query(
      `SELECT id, state_code, skill_category, daily_rate::text AS daily_rate, effective_from::text AS effective_from,
              effective_to::text AS effective_to, source
       FROM workforce.minimum_wage_rate ORDER BY state_code, skill_category, effective_from DESC`,
    );
    return r.rows.map((x) => ({
      id: x.id,
      stateCode: x.state_code,
      skillCategory: x.skill_category,
      dailyRate: x.daily_rate,
      effectiveFrom: x.effective_from,
      effectiveTo: x.effective_to,
      source: x.source,
    }));
  }

  /** Ends the open rate for the state and category the day before, then adds the new one. */
  async insertMinimumWage(
    client: PoolClient,
    tenantId: string,
    userId: string,
    m: { stateCode: string; skillCategory: string; dailyRate: string; effectiveFrom: string; source: string | null },
  ): Promise<string> {
    await client.query(
      `UPDATE workforce.minimum_wage_rate SET effective_to = $3::date - 1
       WHERE state_code = $1 AND skill_category = $2 AND effective_from < $3::date AND (effective_to IS NULL OR effective_to >= $3::date)`,
      [m.stateCode, m.skillCategory, m.effectiveFrom],
    );
    const r = await client.query<{ id: string }>(
      `INSERT INTO workforce.minimum_wage_rate (tenant_id, state_code, skill_category, daily_rate, effective_from, source, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [tenantId, m.stateCode, m.skillCategory, m.dailyRate, m.effectiveFrom, m.source, userId],
    );
    return r.rows[0].id;
  }

  // ---- Advances ----

  async advances(client: PoolClient, employeeId: string | null, openOnly: boolean): Promise<AdvanceRecord[]> {
    const r = await client.query(
      `SELECT * FROM (${ADVANCE_SELECT}) x
       WHERE ($1::uuid IS NULL OR x.employee_id = $1) AND (NOT $2 OR x.outstanding::numeric > 0)
       ORDER BY x.paid_on, x.id`,
      [employeeId, openOnly],
    );
    return r.rows.map(toAdvance);
  }

  async insertAdvance(
    client: PoolClient,
    fields: { id: string; tenantId: string; employeeId: string; amount: string; paidOn: string; paidFrom: string; notes: string | null; entryId: string; userId: string },
  ): Promise<void> {
    await client.query(
      `INSERT INTO workforce.advance (id, tenant_id, employee_id, amount, paid_on, paid_from, notes, ledger_entry_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [fields.id, fields.tenantId, fields.employeeId, fields.amount, fields.paidOn, fields.paidFrom, fields.notes, fields.entryId, fields.userId],
    );
  }

  // ---- Settlements ----

  async lockEmployee(client: PoolClient, employeeId: string): Promise<void> {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('workforce.employee'), hashtext($1))`, [employeeId]);
  }

  async overlapping(client: PoolClient, employeeId: string, from: string, to: string): Promise<{ settlement_number: number; status: string } | null> {
    const r = await client.query(
      `SELECT settlement_number, status FROM workforce.settlement
       WHERE employee_id = $1 AND status <> 'void' AND period_start <= $3::date AND period_end >= $2::date LIMIT 1`,
      [employeeId, from, to],
    );
    return r.rows[0] ?? null;
  }

  async nextSettlementNumber(client: PoolClient): Promise<number> {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('workforce.settlement:' || current_tenant_id()::text))`);
    const r = await client.query<{ n: number }>('SELECT COALESCE(MAX(settlement_number), 0) + 1 AS n FROM workforce.settlement');
    return r.rows[0].n;
  }

  async insertSettlement(
    client: PoolClient,
    s: {
      id: string;
      tenantId: string;
      number: number;
      employeeId: string;
      from: string;
      to: string;
      gross: string;
      deductions: string;
      net: string;
      warnings: string[];
      userId: string;
      lines: SettlementLine[];
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO workforce.settlement
         (id, tenant_id, settlement_number, employee_id, period_start, period_end, gross, deductions, net, warnings, prepared_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [s.id, s.tenantId, s.number, s.employeeId, s.from, s.to, s.gross, s.deductions, s.net, JSON.stringify(s.warnings), s.userId],
    );
    for (const [i, l] of s.lines.entries()) {
      await client.query(
        `INSERT INTO workforce.settlement_line
           (tenant_id, settlement_id, sort, kind, description, quantity, rate, amount, incentive_rule_id, advance_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [s.tenantId, s.id, i, l.kind, l.description, l.quantity, l.rate, l.amount, l.incentiveRuleId, l.advanceId],
      );
    }
  }

  async settlements(client: PoolClient, status: string | null, employeeId: string | null, from: string | null, to: string | null): Promise<SettlementRecord[]> {
    const r = await client.query(
      `${SETTLEMENT_SELECT}
       WHERE ($1::text IS NULL OR s.status = $1) AND ($2::uuid IS NULL OR s.employee_id = $2)
         AND ($3::date IS NULL OR s.period_end >= $3::date) AND ($4::date IS NULL OR s.period_start <= $4::date)
       ORDER BY s.settlement_number DESC
       LIMIT 500`,
      [status, employeeId, from, to],
    );
    return r.rows.map(toSettlement);
  }

  async findSettlement(client: PoolClient, id: string): Promise<(SettlementRecord & { approvalEntryId: string | null }) | null> {
    const r = await client.query(`${SETTLEMENT_SELECT} WHERE s.id = $1`, [id]);
    return r.rows[0] ? toSettlement(r.rows[0]) : null;
  }

  async settlementLines(client: PoolClient, id: string): Promise<SettlementLine[]> {
    const r = await client.query(
      `SELECT kind, description, quantity::text AS quantity, rate::text AS rate, amount::text AS amount, incentive_rule_id, advance_id
       FROM workforce.settlement_line WHERE settlement_id = $1 ORDER BY sort`,
      [id],
    );
    return r.rows.map((l) => ({
      kind: l.kind,
      description: l.description,
      quantity: l.quantity,
      rate: l.rate,
      amount: l.amount,
      incentiveRuleId: l.incentive_rule_id,
      advanceId: l.advance_id,
    }));
  }

  /** Moves a settlement forward; false when the version or status didn't match. */
  async transition(client: PoolClient, id: string, version: number, from: string, set: Record<string, unknown>): Promise<boolean> {
    const keys = Object.keys(set);
    const assignments = keys.map((k, i) => `${k} = $${i + 4}`).join(', ');
    const r = await client.query(
      `UPDATE workforce.settlement SET ${assignments}, version = version + 1 WHERE id = $1 AND version = $2 AND status = $3`,
      [id, version, from, ...keys.map((k) => set[k])],
    );
    return (r.rowCount ?? 0) === 1;
  }
}
