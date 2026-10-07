import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

export type AlertKind =
  | 'cash_mismatch'
  | 'collection_discrepancy'
  | 'inventory_mismatch'
  | 'customer_rejection'
  | 'procurement_issue'
  | 'driver_unable_to_continue'
  | 'trip_blocked'
  | 'operational_problem'
  | 'security'
  | 'shrinkage'
  | 'breakage'
  | 'dispute_stale';
export type AlertSeverity = 'critical' | 'warning';

export interface OwnerAlert {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  detail: string;
  tripId: string | null;
  createdAt: Date;
  readAt: Date | null;
}

export interface NewAlert {
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  detail: string;
  tripId?: string | null;
  /** Raising the same thing twice (a retried request) is one alert. */
  dedupeKey: string;
}

interface AlertRow {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  detail: string;
  trip_id: string | null;
  created_at: Date;
  read_at: Date | null;
}

const toAlert = (r: AlertRow): OwnerAlert => ({
  id: r.id,
  kind: r.kind,
  severity: r.severity,
  title: r.title,
  detail: r.detail,
  tripId: r.trip_id,
  createdAt: r.created_at,
  readAt: r.read_at,
});

/** What the owner is told the moment it happens, and what waits for the evening (client Q&A, E: Q19–Q20). */
@Injectable()
export class AlertsRepository {
  /** Inside the caller's transaction: the alert exists exactly when what it reports does. */
  async raiseWithClient(client: PoolClient, tenantId: string, alert: NewAlert): Promise<void> {
    await client.query(
      `INSERT INTO tenant.owner_alert (tenant_id, kind, severity, title, detail, trip_id, dedupe_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
      [tenantId, alert.kind, alert.severity, alert.title, alert.detail, alert.tripId ?? null, alert.dedupeKey],
    );
  }

  async listWithClient(client: PoolClient, opts: { unreadOnly: boolean; limit: number }): Promise<OwnerAlert[]> {
    const result = await client.query<AlertRow>(
      `SELECT * FROM tenant.owner_alert
        ${opts.unreadOnly ? 'WHERE read_at IS NULL' : ''}
        ORDER BY created_at DESC
        LIMIT $1`,
      [opts.limit],
    );
    return result.rows.map(toAlert);
  }

  async unreadCountWithClient(client: PoolClient): Promise<{ unread: number; critical: number }> {
    const result = await client.query<{ unread: string; critical: string }>(
      `SELECT count(*) AS unread, count(*) FILTER (WHERE severity = 'critical') AS critical
         FROM tenant.owner_alert WHERE read_at IS NULL`,
    );
    return { unread: Number(result.rows[0].unread), critical: Number(result.rows[0].critical) };
  }

  async markReadWithClient(client: PoolClient, userId: string, id: string | null): Promise<number> {
    const result = await client.query(
      `UPDATE tenant.owner_alert SET read_at = now(), read_by = $1
        WHERE read_at IS NULL ${id ? 'AND id = $2' : ''}`,
      id ? [userId, id] : [userId],
    );
    return result.rowCount ?? 0;
  }

  async listBetweenWithClient(client: PoolClient, from: Date, to: Date): Promise<OwnerAlert[]> {
    const result = await client.query<AlertRow>(
      'SELECT * FROM tenant.owner_alert WHERE created_at >= $1 AND created_at < $2 ORDER BY created_at',
      [from, to],
    );
    return result.rows.map(toAlert);
  }

  /**
   * Exceptions that come from time passing rather than from an action: an
   * invoice dispute nobody has touched for 30 days (client Q&A, finance).
   * Run whenever the owner's alerts are read — the bell asks every minute —
   * so no scheduler is needed; the dedupe key makes it raise once per quiet
   * spell (new activity and another 30 quiet days raise it again).
   */
  async sweepWithClient(client: PoolClient, tenantId: string): Promise<void> {
    await client.query(
      `INSERT INTO tenant.owner_alert (tenant_id, kind, severity, title, detail, dedupe_key)
       SELECT $1, 'dispute_stale', 'critical',
              'Dispute untouched for ' || floor(extract(epoch FROM now() - d.last_activity_at) / 86400)::int || ' days — ' || c.name,
              '₹' || d.amount::text || ' disputed on ' || i.invoice_number || ': ' || d.reason ||
                '. Nothing is written off or reversed automatically — resolve it or note what is happening.',
              'dispute-stale:' || d.id || ':' || d.last_activity_at::text
         FROM money.invoice_dispute d
         JOIN money.invoice i ON i.id = d.invoice_id
         JOIN trading_partners.customer c ON c.id = d.customer_id
        WHERE d.status = 'open' AND d.last_activity_at < now() - interval '30 days'
       ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
      [tenantId],
    );
  }
}
