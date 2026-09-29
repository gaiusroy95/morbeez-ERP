import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AiSettings, Draft, RecommendationDecision, RecommendationRecord, RecommendationType } from '../entities/ai.entity';

type Row = Record<string, unknown>;

const REC_SELECT = `
  SELECT r.id, r.run_id, r.type, r.subject_kind, r.subject_id, r.target_date::text AS target_date, r.title, r.proposal, r.evidence,
         r.explanation, r.expected_impact::text AS expected_impact, r.confidence, r.sensitive, r.producer, r.expires_at, r.created_at,
         d.decision, d.decided_by, u.email AS decided_by_email, d.decided_at, d.submitted, d.reason, d.result_ref
  FROM ai.recommendation r
  LEFT JOIN ai.recommendation_decision d ON d.recommendation_id = r.id
  LEFT JOIN identity.app_user u ON u.id = d.decided_by`;

const toRec = (r: Row): RecommendationRecord => ({
  id: r.id as string,
  runId: r.run_id as string,
  type: r.type as RecommendationType,
  subjectKind: r.subject_kind as string,
  subjectId: r.subject_id as string | null,
  subjectName: null,
  targetDate: r.target_date as string | null,
  title: r.title as string,
  proposal: r.proposal as Record<string, unknown>,
  evidence: r.evidence as RecommendationRecord['evidence'],
  explanation: r.explanation as string,
  expectedImpact: r.expected_impact as string | null,
  confidence: r.confidence as RecommendationRecord['confidence'],
  sensitive: r.sensitive as boolean,
  producer: r.producer as string,
  expiresAt: r.expires_at as Date,
  createdAt: r.created_at as Date,
  status: (r.decision as RecommendationRecord['status']) ?? (new Date(r.expires_at as Date) <= new Date() ? 'expired' : 'open'),
  decision: r.decision
    ? {
        decision: r.decision as RecommendationDecision,
        decidedByEmail: r.decided_by_email as string | null,
        decidedAt: r.decided_at as Date,
        submitted: r.submitted as Record<string, unknown> | null,
        reason: r.reason as string | null,
        resultRef: r.result_ref as Record<string, unknown> | null,
      }
    : null,
});

/**
 * The ai schema: the only tables the AI writes, and only by inserting
 * (AI System DR.1, REC.4, DR.4). A run's recommendations and the expiry of
 * those it supersedes commit together.
 */
@Injectable()
export class AiRepository {
  /** One run per tenant at a time. */
  async lockRuns(client: PoolClient): Promise<void> {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('ai.run:' || current_tenant_id()::text))`);
  }

  async settings(client: PoolClient): Promise<AiSettings> {
    const r = await client.query(
      `SELECT target_margin_pct::text AS m, max_price_move_pct::text AS step, min_customer_margin_pct::text AS minc,
              cost_of_capital_pct::text AS coc, default_cost_per_km::text AS km, disabled_types, version FROM ai.ai_settings`,
    );
    const s = r.rows[0];
    return s
      ? { targetMarginPct: s.m, maxPriceMovePct: s.step, minCustomerMarginPct: s.minc, costOfCapitalPct: s.coc, defaultCostPerKm: s.km, disabledTypes: s.disabled_types, version: s.version }
      : { targetMarginPct: '20.00', maxPriceMovePct: '15.00', minCustomerMarginPct: '5.00', costOfCapitalPct: '12.00', defaultCostPerKm: '18.00', disabledTypes: [], version: 0 };
  }

  async saveSettings(client: PoolClient, tenantId: string, userId: string, version: number, s: Omit<AiSettings, 'version'>): Promise<boolean> {
    const values = [s.targetMarginPct, s.maxPriceMovePct, s.minCustomerMarginPct, s.costOfCapitalPct, s.defaultCostPerKm, s.disabledTypes, userId];
    if (version === 0) {
      const r = await client.query(
        `INSERT INTO ai.ai_settings (target_margin_pct, max_price_move_pct, min_customer_margin_pct, cost_of_capital_pct, default_cost_per_km, disabled_types, updated_by, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (tenant_id) DO NOTHING`,
        [...values, tenantId],
      );
      return (r.rowCount ?? 0) === 1;
    }
    const r = await client.query(
      `UPDATE ai.ai_settings SET target_margin_pct = $1, max_price_move_pct = $2, min_customer_margin_pct = $3, cost_of_capital_pct = $4,
         default_cost_per_km = $5, disabled_types = $6, updated_by = $7, version = version + 1, updated_at = now()
       WHERE version = $8`,
      [...values, version],
    );
    return (r.rowCount ?? 0) === 1;
  }

  async insertRun(client: PoolClient, r: { id: string; tenantId: string; startedAt: Date; produced: Record<string, number>; suppressed: Record<string, string>; userId: string }): Promise<void> {
    await client.query(
      'INSERT INTO ai.run (id, tenant_id, started_at, produced, suppressed, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
      [r.id, r.tenantId, r.startedAt, JSON.stringify(r.produced), JSON.stringify(r.suppressed), r.userId],
    );
  }

  async lastRun(client: PoolClient): Promise<{ id: string; startedAt: Date; finishedAt: Date; produced: Record<string, number>; suppressed: Record<string, string>; byEmail: string | null } | null> {
    const r = await client.query(
      `SELECT r.id, r.started_at, r.finished_at, r.produced, r.suppressed, u.email FROM ai.run r LEFT JOIN identity.app_user u ON u.id = r.created_by
       ORDER BY r.started_at DESC LIMIT 1`,
    );
    const x = r.rows[0];
    return x ? { id: x.id, startedAt: x.started_at, finishedAt: x.finished_at, produced: x.produced, suppressed: x.suppressed, byEmail: x.email } : null;
  }

  /** Open recommendations of these types are superseded by a fresh run. */
  async expireOpen(client: PoolClient, tenantId: string, types: RecommendationType[]): Promise<number> {
    if (!types.length) return 0;
    const r = await client.query(
      `INSERT INTO ai.recommendation_decision (recommendation_id, tenant_id, decision, reason)
       SELECT r.id, $1, 'expired', 'Superseded by a newer suggestion'
       FROM ai.recommendation r
       WHERE r.type = ANY($2::text[]) AND NOT EXISTS (SELECT 1 FROM ai.recommendation_decision d WHERE d.recommendation_id = r.id)`,
      [tenantId, types],
    );
    return r.rowCount ?? 0;
  }

  async insert(client: PoolClient, tenantId: string, runId: string, d: Draft): Promise<void> {
    await client.query(
      `INSERT INTO ai.recommendation (tenant_id, run_id, type, subject_kind, subject_id, target_date, title, proposal, evidence, explanation,
         expected_impact, confidence, sensitive, producer, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        tenantId,
        runId,
        d.type,
        d.subjectKind,
        d.subjectId,
        d.targetDate,
        d.title,
        JSON.stringify(d.proposal),
        JSON.stringify(d.evidence),
        d.explanation,
        d.expectedImpact,
        d.confidence,
        d.sensitive,
        d.producer,
        d.expiresAt,
      ],
    );
  }

  async list(
    client: PoolClient,
    f: { status: 'open' | 'decided' | 'all'; type: string | null; includeSensitive: boolean; since: Date | null; limit: number; offset: number },
  ): Promise<{ recs: RecommendationRecord[]; total: number }> {
    const r = await client.query(
      `SELECT x.*, count(*) OVER () AS total_count FROM (${REC_SELECT}
       WHERE ($1::text IS NULL OR r.type = $1) AND ($2 OR NOT r.sensitive) AND ($3::timestamptz IS NULL OR r.created_at >= $3)
         AND CASE $4 WHEN 'open' THEN d.recommendation_id IS NULL AND r.expires_at > now()
                     WHEN 'decided' THEN d.recommendation_id IS NOT NULL ELSE true END
       ) x
       ORDER BY x.expires_at, x.expected_impact DESC NULLS LAST, x.created_at DESC
       LIMIT $5 OFFSET $6`,
      [f.type, f.includeSensitive, f.since, f.status, f.limit, f.offset],
    );
    return { recs: r.rows.map(toRec), total: Number(r.rows[0]?.total_count ?? 0) };
  }

  async find(client: PoolClient, id: string): Promise<RecommendationRecord | null> {
    const r = await client.query(`${REC_SELECT} WHERE r.id = $1`, [id]);
    return r.rows[0] ? toRec(r.rows[0]) : null;
  }

  /** Records the one decision; false when another decision got there first. */
  async decide(
    client: PoolClient,
    d: { tenantId: string; id: string; decision: RecommendationDecision; userId: string; submitted: unknown; reason: string | null; resultRef: unknown },
  ): Promise<boolean> {
    const r = await client.query(
      `INSERT INTO ai.recommendation_decision (recommendation_id, tenant_id, decision, decided_by, submitted, reason, result_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (recommendation_id) DO NOTHING`,
      [d.id, d.tenantId, d.decision, d.userId, d.submitted === undefined ? null : JSON.stringify(d.submitted), d.reason, d.resultRef === undefined ? null : JSON.stringify(d.resultRef)],
    );
    return (r.rowCount ?? 0) === 1;
  }

  /** Counts by type and outcome since a time — the track record (AI System EVAL.7). */
  async outcomeCounts(client: PoolClient, since: Date, includeSensitive: boolean): Promise<Row[]> {
    const r = await client.query(
      `SELECT r.type,
              count(*)::int AS shown,
              count(*) FILTER (WHERE d.decision = 'accepted')::int AS accepted,
              count(*) FILTER (WHERE d.decision = 'modified')::int AS modified,
              count(*) FILTER (WHERE d.decision = 'dismissed')::int AS dismissed,
              count(*) FILTER (WHERE d.decision = 'expired' OR (d.decision IS NULL AND r.expires_at <= now()))::int AS expired,
              count(*) FILTER (WHERE d.decision IS NULL AND r.expires_at > now())::int AS open
       FROM ai.recommendation r LEFT JOIN ai.recommendation_decision d ON d.recommendation_id = r.id
       WHERE r.created_at >= $1 AND ($2 OR NOT r.sensitive)
       GROUP BY r.type ORDER BY r.type`,
      [since, includeSensitive],
    );
    return r.rows;
  }

  /** Past buying and price suggestions whose day has come, for scoring against what happened. */
  async pastForecasts(client: PoolClient, before: string, since: string): Promise<Row[]> {
    const r = await client.query(
      `SELECT r.type, r.subject_id AS product_id, r.target_date::text AS target_date, r.proposal, COALESCE(d.decision, CASE WHEN r.expires_at <= now() THEN 'expired' ELSE 'open' END) AS decision
       FROM ai.recommendation r LEFT JOIN ai.recommendation_decision d ON d.recommendation_id = r.id
       WHERE r.type IN ('procurement', 'pricing') AND r.target_date < $1::date AND r.target_date >= $2::date
         AND NOT (d.decision = 'expired' AND d.reason = 'Superseded by a newer suggestion')`,
      [before, since],
    );
    return r.rows;
  }
}
