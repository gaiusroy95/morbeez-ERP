import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

@Injectable()
export class OpeningBalancesRepository {
  /** Today in the tenant's time zone, and the last day the books are closed through (if any). */
  async booksWithClient(client: PoolClient): Promise<{ today: string; closedThrough: string | null }> {
    const r = await client.query<{ today: string; closed_through: string | null }>(
      `SELECT (now() AT TIME ZONE t.timezone)::date::text AS today,
              (SELECT max(period_end)::text FROM money.period_close WHERE reopened_at IS NULL) AS closed_through
         FROM tenant.tenant t WHERE t.id = current_tenant_id()`,
    );
    return { today: r.rows[0].today, closedThrough: r.rows[0].closed_through };
  }

  /** The first instant of a day in the tenant's time zone. */
  async startOfDayWithClient(client: PoolClient, day: string): Promise<Date> {
    const r = await client.query<{ at: Date }>(
      `SELECT ($1::date::timestamp AT TIME ZONE t.timezone) AS at FROM tenant.tenant t WHERE t.id = current_tenant_id()`,
      [day],
    );
    return r.rows[0].at;
  }
}
