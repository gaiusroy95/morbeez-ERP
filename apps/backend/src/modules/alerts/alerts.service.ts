import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../infra/database/database.service';
import { dayWindow } from '../../common/zoned-time';
import { AlertsRepository, OwnerAlert } from './alerts.repository';
import { DaySummary, DaySummaryRepository } from './day-summary.repository';

export interface EveningSummary extends DaySummary {
  date: string;
  /** The day's exceptions — already sent the moment they happened. */
  exceptions: OwnerAlert[];
  /** The owner has handed the day over (day-off mode). */
  ownerAway: boolean;
}

@Injectable()
export class AlertsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly alerts: AlertsRepository,
    private readonly days: DaySummaryRepository,
  ) {}

  list(tenantId: string, unreadOnly: boolean, limit: number): Promise<OwnerAlert[]> {
    return this.db.withTenant(tenantId, async (client) => {
      await this.alerts.sweepWithClient(client, tenantId);
      return this.alerts.listWithClient(client, { unreadOnly, limit: Math.min(Math.max(limit, 1), 200) });
    });
  }

  unreadCount(tenantId: string): Promise<{ unread: number; critical: number }> {
    return this.db.withTenant(tenantId, async (client) => {
      await this.alerts.sweepWithClient(client, tenantId);
      return this.alerts.unreadCountWithClient(client);
    });
  }

  async markRead(tenantId: string, userId: string, id: string | null): Promise<{ marked: number }> {
    return { marked: await this.db.withTenant(tenantId, (client) => this.alerts.markReadWithClient(client, userId, id)) };
  }

  /** Normal = summary, exception = immediate alert (client Q&A, E: Q20). */
  summary(tenantId: string, date?: string): Promise<EveningSummary> {
    return this.db.withTenant(tenantId, async (client) => {
      const tenant = (
        await client.query<{ timezone: string; owner_away_until: Date | null }>(
          'SELECT timezone, owner_away_until FROM tenant.tenant WHERE id = $1',
          [tenantId],
        )
      ).rows[0];
      const window = dayWindow(tenant?.timezone || 'Asia/Kolkata', date);
      const [figures, exceptions] = await Promise.all([
        this.days.summaryWithClient(client, window.from, window.to),
        this.alerts.listBetweenWithClient(client, window.from, window.to),
      ]);
      const away = tenant?.owner_away_until ?? null;
      return { date: window.date, ...figures, exceptions, ownerAway: !!away && away > window.from };
    });
  }
}
