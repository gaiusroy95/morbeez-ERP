import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../infra/database/database.service';
import { CallOutcome, CallPurpose, CallScript, CallStatus } from './voice-script';

export interface IntegrationSettings {
  whatsappPhoneNumberId: string | null;
  whatsappReply: boolean;
  callsEnabled: boolean;
  /** 0 before the first save. */
  version: number;
}

export type InboundStatus = 'received' | 'suggested' | 'no_customer' | 'no_order' | 'not_text' | 'failed';

export interface InboundMessage {
  id: string;
  channel: 'whatsapp';
  fromPhone: string;
  senderName: string | null;
  customerId: string | null;
  customerName: string | null;
  messageType: string;
  body: string;
  receivedAt: Date;
  status: InboundStatus;
  reader: 'claude' | 'rules' | null;
  extraction: Record<string, unknown> | null;
  recommendationId: string | null;
  note: string | null;
  repliedAt: Date | null;
}

export interface VoiceCall {
  id: string;
  customerId: string;
  customerName: string;
  purpose: CallPurpose;
  language: string;
  toPhone: string;
  script: CallScript;
  orderId: string | null;
  status: CallStatus;
  digits: string | null;
  outcome: CallOutcome | null;
  answeredAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
  error: string | null;
  requestedBy: string | null;
  createdAt: Date;
}

type Row = Record<string, unknown>;

const toMessage = (r: Row): InboundMessage => ({
  id: r.id as string,
  channel: 'whatsapp',
  fromPhone: r.from_phone as string,
  senderName: r.sender_name as string | null,
  customerId: r.customer_id as string | null,
  customerName: (r.customer_name as string | null) ?? null,
  messageType: r.message_type as string,
  body: r.body as string,
  receivedAt: r.received_at as Date,
  status: r.status as InboundStatus,
  reader: r.reader as InboundMessage['reader'],
  extraction: r.extraction as Record<string, unknown> | null,
  recommendationId: r.recommendation_id as string | null,
  note: r.note as string | null,
  repliedAt: r.replied_at as Date | null,
});

const toCall = (r: Row): VoiceCall => ({
  id: r.id as string,
  customerId: r.customer_id as string,
  customerName: r.customer_name as string,
  purpose: r.purpose as CallPurpose,
  language: r.language as string,
  toPhone: r.to_phone as string,
  script: r.script as CallScript,
  orderId: r.order_id as string | null,
  status: r.status as CallStatus,
  digits: r.digits as string | null,
  outcome: r.outcome as CallOutcome | null,
  answeredAt: r.answered_at as Date | null,
  endedAt: r.ended_at as Date | null,
  durationSeconds: r.duration_seconds as number | null,
  error: r.error as string | null,
  requestedBy: (r.requested_by_name as string | null) ?? null,
  createdAt: r.created_at as Date,
});

const NAME_OF = (user: string) => `
  COALESCE((SELECT e.name FROM trading_partners.employee e WHERE e.user_id = ${user} ORDER BY e.created_at LIMIT 1),
           (SELECT COALESCE(u.phone, u.email) FROM identity.app_user u WHERE u.id = ${user}))`;

const MESSAGE_SELECT = `SELECT m.*, c.name AS customer_name FROM ai.inbound_message m LEFT JOIN trading_partners.customer c ON c.id = m.customer_id`;
const CALL_SELECT = `SELECT v.*, c.name AS customer_name, ${NAME_OF('v.requested_by')} AS requested_by_name
  FROM ai.voice_call v JOIN trading_partners.customer c ON c.id = v.customer_id`;

/**
 * The AI's channels to customers: which WhatsApp number is the business's,
 * the messages that came in on it, the calls placed. Writes only these
 * tables (and, through AiRepository, suggestions); reads customers, orders
 * and products to say what a message or a call is about.
 */
@Injectable()
export class ChannelsRepository {
  constructor(private readonly db: DatabaseService) {}

  // ---- Untenanted: the providers' webhooks ----

  async tenantForWhatsApp(phoneNumberId: string): Promise<string | null> {
    const r = await this.db.query<{ t: string | null }>('SELECT tenant.find_tenant_for_whatsapp($1) AS t', [phoneNumberId]);
    return r.rows[0]?.t ?? null;
  }

  async tenantForCall(callId: string): Promise<string | null> {
    const r = await this.db.query<{ t: string | null }>('SELECT ai.find_tenant_for_call($1::uuid) AS t', [callId]);
    return r.rows[0]?.t ?? null;
  }

  // ---- Settings ----

  async settings(client: PoolClient): Promise<IntegrationSettings> {
    const r = await client.query('SELECT whatsapp_phone_number_id, whatsapp_reply, calls_enabled, version FROM tenant.integration_setting');
    const s = r.rows[0];
    return s
      ? { whatsappPhoneNumberId: s.whatsapp_phone_number_id, whatsappReply: s.whatsapp_reply, callsEnabled: s.calls_enabled, version: s.version }
      : { whatsappPhoneNumberId: null, whatsappReply: false, callsEnabled: false, version: 0 };
  }

  /** Saved only over the version read; false when someone saved in between. */
  async saveSettings(client: PoolClient, tenantId: string, userId: string, version: number, s: Omit<IntegrationSettings, 'version'>): Promise<boolean> {
    if (version === 0) {
      const r = await client.query(
        `INSERT INTO tenant.integration_setting (tenant_id, whatsapp_phone_number_id, whatsapp_reply, calls_enabled, updated_by)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (tenant_id) DO NOTHING`,
        [tenantId, s.whatsappPhoneNumberId, s.whatsappReply, s.callsEnabled, userId],
      );
      return (r.rowCount ?? 0) > 0;
    }
    const r = await client.query(
      `UPDATE tenant.integration_setting SET whatsapp_phone_number_id = $2, whatsapp_reply = $3, calls_enabled = $4, updated_by = $5,
         updated_at = now(), version = version + 1
       WHERE tenant_id = $1 AND version = $6`,
      [tenantId, s.whatsappPhoneNumberId, s.whatsappReply, s.callsEnabled, userId, version],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async businessName(client: PoolClient): Promise<{ name: string; timezone: string; today: string; tomorrow: string }> {
    const r = await client.query(
      `SELECT name, timezone, (now() AT TIME ZONE timezone)::date::text AS today, ((now() AT TIME ZONE timezone)::date + 1)::text AS tomorrow
         FROM tenant.tenant WHERE id = current_tenant_id()`,
    );
    return r.rows[0];
  }

  // ---- WhatsApp messages ----

  /** Null when this message came in already (Meta delivers at least once). */
  async insertMessage(
    client: PoolClient,
    m: { tenantId: string; providerMessageId: string; fromPhone: string; senderName: string | null; messageType: string; body: string; receivedAt: Date },
  ): Promise<string | null> {
    const r = await client.query<{ id: string }>(
      `INSERT INTO ai.inbound_message (tenant_id, provider_message_id, from_phone, sender_name, message_type, body, received_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id, channel, provider_message_id) DO NOTHING
       RETURNING id`,
      [m.tenantId, m.providerMessageId, m.fromPhone, m.senderName, m.messageType, m.body.slice(0, 4096), m.receivedAt],
    );
    return r.rows[0]?.id ?? null;
  }

  async message(client: PoolClient, id: string): Promise<InboundMessage | null> {
    const r = await client.query(`${MESSAGE_SELECT} WHERE m.id = $1`, [id]);
    return r.rows[0] ? toMessage(r.rows[0]) : null;
  }

  async messages(client: PoolClient, limit: number): Promise<InboundMessage[]> {
    const r = await client.query(`${MESSAGE_SELECT} ORDER BY m.received_at DESC LIMIT $1`, [limit]);
    return r.rows.map(toMessage);
  }

  async settleMessage(
    client: PoolClient,
    id: string,
    s: { status: InboundStatus; customerId?: string | null; reader?: 'claude' | 'rules' | null; extraction?: unknown; recommendationId?: string | null; note?: string | null },
  ): Promise<void> {
    await client.query(
      `UPDATE ai.inbound_message SET status = $2, customer_id = COALESCE($3, customer_id), reader = $4, extraction = $5,
         recommendation_id = $6, note = $7
       WHERE id = $1`,
      [id, s.status, s.customerId ?? null, s.reader ?? null, s.extraction === undefined ? null : JSON.stringify(s.extraction), s.recommendationId ?? null, s.note ?? null],
    );
  }

  async markReplied(client: PoolClient, id: string): Promise<void> {
    await client.query('UPDATE ai.inbound_message SET replied_at = now() WHERE id = $1', [id]);
  }

  /** The customer whose phone ends in the same ten digits as the sender's. */
  async customerByPhone(client: PoolClient, phone: string): Promise<{ id: string; name: string; language: string } | null> {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) return null;
    const r = await client.query(
      `SELECT id, name, preferred_language FROM trading_partners.customer
        WHERE status = 'active' AND length(regexp_replace(contact->>'phone', '\\D', '', 'g')) >= 10
          AND right(regexp_replace(contact->>'phone', '\\D', '', 'g'), 10) = $1
        ORDER BY created_at LIMIT 1`,
      [digits.slice(-10)],
    );
    const c = r.rows[0];
    return c ? { id: c.id, name: c.name, language: c.preferred_language ?? 'en' } : null;
  }

  // ---- Calls ----

  async customerForCall(client: PoolClient, id: string): Promise<{ name: string; phone: string | null; language: string } | null> {
    const r = await client.query(`SELECT name, contact->>'phone' AS phone, preferred_language FROM trading_partners.customer WHERE id = $1 AND status = 'active'`, [id]);
    const c = r.rows[0];
    return c ? { name: c.name, phone: c.phone, language: c.preferred_language ?? 'en' } : null;
  }

  /** What an order says, for a call confirming it. */
  async orderForCall(client: PoolClient, orderId: string): Promise<{ customerId: string; number: number; deliveryDate: string | null; status: string; lines: { name: string; quantity: string; uom: string }[] } | null> {
    const o = await client.query(
      `SELECT customer_id, number, delivery_date::text AS delivery_date, status FROM commerce.customer_order WHERE id = $1`,
      [orderId],
    );
    if (!o.rows[0]) return null;
    const l = await client.query(
      `SELECT p.name, l.quantity::text AS quantity, p.base_uom AS uom FROM commerce.customer_order_line l JOIN trading_partners.product p ON p.id = l.product_id
        WHERE l.order_id = $1 ORDER BY p.name`,
      [orderId],
    );
    return { customerId: o.rows[0].customer_id, number: o.rows[0].number, deliveryDate: o.rows[0].delivery_date, status: o.rows[0].status, lines: l.rows };
  }

  async productNames(client: PoolClient, ids: string[]): Promise<Map<string, { name: string; uom: string }>> {
    if (!ids.length) return new Map();
    const r = await client.query('SELECT id, name, base_uom AS uom FROM trading_partners.product WHERE id = ANY($1::uuid[])', [ids]);
    return new Map(r.rows.map((x) => [x.id as string, { name: x.name as string, uom: x.uom as string }]));
  }

  async insertCall(
    client: PoolClient,
    c: { id: string; tenantId: string; customerId: string; purpose: CallPurpose; language: string; toPhone: string; script: CallScript; orderId: string | null; userId: string },
  ): Promise<void> {
    await client.query(
      `INSERT INTO ai.voice_call (id, tenant_id, customer_id, purpose, language, to_phone, script, order_id, requested_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [c.id, c.tenantId, c.customerId, c.purpose, c.language, c.toPhone, JSON.stringify(c.script), c.orderId, c.userId],
    );
  }

  async call(client: PoolClient, id: string): Promise<VoiceCall | null> {
    const r = await client.query(`${CALL_SELECT} WHERE v.id = $1`, [id]);
    return r.rows[0] ? toCall(r.rows[0]) : null;
  }

  async calls(client: PoolClient, since: Date, limit: number): Promise<VoiceCall[]> {
    const r = await client.query(`${CALL_SELECT} WHERE v.created_at >= $1 ORDER BY v.created_at DESC LIMIT $2`, [since, limit]);
    return r.rows.map(toCall);
  }

  /** A call already ringing or talking to this customer: one at a time. */
  async liveCall(client: PoolClient, customerId: string): Promise<boolean> {
    const r = await client.query(
      `SELECT 1 FROM ai.voice_call WHERE customer_id = $1 AND status IN ('queued', 'ringing', 'in_progress') AND created_at > now() - interval '15 minutes'`,
      [customerId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async updateCall(
    client: PoolClient,
    id: string,
    u: { sid?: string; status?: CallStatus; digits?: string; outcome?: CallOutcome; answered?: boolean; ended?: boolean; durationSeconds?: number | null; error?: string | null },
  ): Promise<void> {
    await client.query(
      `UPDATE ai.voice_call SET
         provider_call_sid = COALESCE($2, provider_call_sid),
         status = CASE WHEN status IN ('completed', 'busy', 'no_answer', 'failed', 'canceled') THEN status ELSE COALESCE($3, status) END,
         digits = COALESCE($4, digits),
         outcome = COALESCE($5, outcome),
         answered_at = CASE WHEN $6 THEN COALESCE(answered_at, now()) ELSE answered_at END,
         ended_at = CASE WHEN $7 THEN COALESCE(ended_at, now()) ELSE ended_at END,
         duration_seconds = COALESCE($8, duration_seconds),
         error = COALESCE($9, error),
         updated_at = now()
       WHERE id = $1`,
      [id, u.sid ?? null, u.status ?? null, u.digits ?? null, u.outcome ?? null, !!u.answered, !!u.ended, u.durationSeconds ?? null, u.error ?? null],
    );
  }
}
