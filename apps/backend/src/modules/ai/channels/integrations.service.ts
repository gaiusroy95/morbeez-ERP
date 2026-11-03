import { ConflictException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../infra/database/database.service';
import { AuditService } from '../../../infra/audit/audit.service';
import { ChannelsConfig } from './channels.config';
import { ChannelsRepository, IntegrationSettings } from './channels.repository';
import { SarvamOrderReader } from './sarvam-order-reader';

export interface IntegrationsStatus {
  /** Where Meta and Sarvam reach this API; null when PUBLIC_API_URL isn't set. */
  publicApiUrl: string | null;
  whatsapp: {
    /** The webhook can be verified and its deliveries checked (WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET). */
    receives: boolean;
    /** Replies can be sent (WHATSAPP_ACCESS_TOKEN). */
    replies: boolean;
    /** To paste into Meta's app → WhatsApp → Configuration. */
    webhookUrl: string | null;
    messagesLast7Days: number;
  };
  reader: {
    /** Sarvam AI reads orders (SARVAM_API_KEY); else simple rules do. */
    sarvam: boolean;
    model: string | null;
  };
  calls: {
    /** Sarvam Voice Agents and PUBLIC_API_URL are set. */
    ready: boolean;
    fromNumber: string | null;
    callsLast7Days: number;
  };
  settings: IntegrationSettings;
}

export interface SaveIntegrationSettings {
  version: number;
  whatsappPhoneNumberId: string | null;
  whatsappReply: boolean;
  callsEnabled: boolean;
}

/**
 * Settings → Integrations: which outside services this server has keys for
 * (the environment's business, never the owner's — see .env.example), and
 * the business's own choices: its WhatsApp number's id, whether customers get
 * a reply, whether AI calls may be placed.
 */
@Injectable()
export class IntegrationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ChannelsConfig,
    private readonly repo: ChannelsRepository,
    private readonly reader: SarvamOrderReader,
    private readonly audit: AuditService,
  ) {}

  status(tenantId: string): Promise<IntegrationsStatus> {
    return this.db.withTenant(tenantId, async (client) => {
      const settings = await this.repo.settings(client);
      const counts = await client.query<{ messages: number; calls: number }>(
        `SELECT (SELECT count(*)::int FROM ai.inbound_message WHERE received_at > now() - interval '7 days') AS messages,
                (SELECT count(*)::int FROM ai.voice_call WHERE created_at > now() - interval '7 days') AS calls`,
      );
      const base = this.config.publicApiUrl;
      return {
        publicApiUrl: base,
        whatsapp: {
          receives: this.config.whatsappReceives,
          replies: this.config.whatsappReplies,
          webhookUrl: base ? `${base}/webhooks/whatsapp` : null,
          messagesLast7Days: counts.rows[0].messages,
        },
        reader: { sarvam: this.reader.available, model: this.reader.available ? this.reader.model : null },
        calls: { ready: this.config.callsReady, fromNumber: this.config.sarvamVoice.fromNumber, callsLast7Days: counts.rows[0].calls },
        settings,
      };
    });
  }

  saveSettings(tenantId: string, userId: string, dto: SaveIntegrationSettings): Promise<IntegrationsStatus> {
    const next = { whatsappPhoneNumberId: dto.whatsappPhoneNumberId?.trim() || null, whatsappReply: dto.whatsappReply, callsEnabled: dto.callsEnabled };
    return this.db
      .withTenant(tenantId, async (client) => {
        const before = await this.repo.settings(client);
        if (!(await this.repo.saveSettings(client, tenantId, userId, dto.version, next))) {
          throw new ConflictException('Integration settings were changed by someone else — reload and try again');
        }
        await this.audit.record(client, {
          tenantId,
          actorUserId: userId,
          action: before.version === 0 ? 'create' : 'update',
          entityType: 'integration_setting',
          entityId: tenantId,
          before: before as unknown as Record<string, unknown>,
          after: next,
        });
      })
      .catch((err: { code?: string; constraint?: string }) => {
        if (err?.code === '23505') throw new ConflictException("That WhatsApp number is set up for another business — check the phone number ID");
        throw err;
      })
      .then(() => this.status(tenantId));
  }
}
