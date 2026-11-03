import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { DatabaseService } from '../../../infra/database/database.service';
import { AuditService } from '../../../infra/audit/audit.service';
import { LANGUAGES, Language } from '../../../common/languages';
import { formatOrderNumber } from '../../../common/persistence/document-number';
import { AiRepository } from '../repositories/ai.repository';
import { AiDataRepository } from '../repositories/ai-data.repository';
import { DECIDE_PERMISSION } from '../entities/ai.entity';
import { ChannelsConfig } from './channels.config';
import { ChannelsRepository, VoiceCall } from './channels.repository';
import { ChannelActor } from './whatsapp.service';
import { BriefLine, briefFor, CallBrief, CallPurpose, describeBrief, LANGUAGE_NAME, resultOf } from './call-brief';

const languageOf = (v: string): Language => ((LANGUAGES as readonly string[]).includes(v) ? (v as Language) : 'en');

/** An Indian mobile as it's dialled: +91 and ten digits. Null when it can't be one. */
export function dialable(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (phone.trim().startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
  return null;
}

export interface PlaceCall {
  customerId: string;
  purpose: CallPurpose;
  /** Their usual order (order_reminder), or an order far from it (quantity_confirm): the AI Calling row's suggestion. */
  recommendationId?: string;
  /** A new order to confirm. */
  orderId?: string;
  /** A follow-up: what to talk about. */
  topic?: string;
}

const sameText = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * AI calls to customers (AI Calling; requirements Part 23; the client: a
 * conversation, not press 1 / press 2). The owner picks a customer and what
 * the call is about; Sarvam's voice agent rings them from the business's
 * number and talks with them in their language — the facts it's given are
 * fixed by code (the amount due, the order and its lines, the owner's topic)
 * — then reports what came of it: an outcome, a summary, what it collected
 * (a changed quantity, a payment date, when to call back) and the
 * conversation. Nothing changes in the books: placing a changed order or
 * recording a payment stays the owner's (DR.1). A customer marked Do Not Call
 * is never called.
 */
@Injectable()
export class VoiceService {
  private readonly log = new Logger(VoiceService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ChannelsConfig,
    private readonly repo: ChannelsRepository,
    private readonly ai: AiRepository,
    private readonly data: AiDataRepository,
    private readonly audit: AuditService,
  ) {}

  history(tenantId: string): Promise<VoiceCall[]> {
    return this.db.withTenant(tenantId, (client) => this.repo.calls(client, new Date(Date.now() - 14 * 86_400_000), 200));
  }

  /** What the call will be about, before it's placed. */
  async preview(actor: ChannelActor, dto: PlaceCall): Promise<{ text: string; language: string; toPhone: string | null }> {
    const { brief, customer } = await this.prepare(actor, dto);
    return { text: describeBrief(brief), language: LANGUAGE_NAME[languageOf(customer.language)], toPhone: dialable(customer.phone) };
  }

  private async prepare(actor: ChannelActor, dto: PlaceCall) {
    if (!actor.permissions.includes(DECIDE_PERMISSION.order)) throw new ForbiddenException(`Calling a customer needs the ${DECIDE_PERMISSION.order} permission`);
    if (dto.purpose === 'payment_reminder' && !actor.permissions.includes('finance:read')) throw new ForbiddenException('A payment reminder needs the finance:read permission');
    return this.db.withTenant(actor.tenantId, async (client) => {
      const customer = await this.repo.customerForCall(client, dto.customerId);
      if (!customer) throw new NotFoundException('Customer not found');
      if (customer.doNotCall) throw new ConflictException(`${customer.name} is marked Do Not Call`);
      const business = await this.repo.businessName(client);
      const lang = languageOf(customer.language);
      const base = { business: business.name, customer: customer.name };
      let orderId: string | null = null;
      let brief: CallBrief;
      const orderBrief = async (id: string, purpose: 'order_confirm' | 'quantity_confirm') => {
        const order = await this.repo.orderForCall(client, id);
        if (!order || order.customerId !== dto.customerId) throw new NotFoundException('Order not found');
        if (order.status === 'cancelled' || order.status === 'delivered') throw new ConflictException(`${formatOrderNumber(order.number)} is ${order.status}`);
        orderId = id;
        return briefFor(purpose, lang, { ...base, orderNumber: formatOrderNumber(order.number), deliveryDate: order.deliveryDate, lines: order.lines, orderTotal: order.total });
      };
      switch (dto.purpose) {
        case 'payment_reminder': {
          const due = await this.data.dueFor(client, dto.customerId);
          if (Number(due.amount) <= 0) throw new ConflictException(`Nothing is due from ${customer.name}`);
          brief = briefFor('payment_reminder', lang, { ...base, amountDue: due.amount, dueSince: due.since });
          break;
        }
        case 'order_reminder': {
          if (!dto.recommendationId) throw new BadRequestException('Say which usual order the call is about');
          const rec = await this.ai.find(client, dto.recommendationId);
          if (!rec || rec.type !== 'order' || rec.subjectId !== dto.customerId || rec.proposal.action !== 'delivery_order') throw new NotFoundException('Suggestion not found');
          if (rec.proposal.source === 'whatsapp') throw new BadRequestException(`${customer.name} ordered on WhatsApp already — place it from AI Orders`);
          const lines = (rec.proposal.lines as { productId: string; quantity: string; uom: string }[]) ?? [];
          const names = await this.repo.productNames(client, lines.map((l) => l.productId));
          const said: BriefLine[] = lines.map((l) => ({ name: names.get(l.productId)?.name ?? '', quantity: l.quantity, uom: l.uom || names.get(l.productId)?.uom || '' }));
          brief = briefFor('order_reminder', lang, { ...base, deliveryDate: (rec.proposal.deliveryDate as string) ?? null, lines: said });
          break;
        }
        case 'quantity_confirm': {
          if (!dto.recommendationId) throw new BadRequestException('Say which order the call is about');
          const rec = await this.ai.find(client, dto.recommendationId);
          if (!rec || rec.type !== 'order' || rec.subjectId !== dto.customerId || rec.proposal.action !== 'confirm_order') throw new NotFoundException('Suggestion not found');
          brief = await orderBrief(rec.proposal.orderId as string, 'quantity_confirm');
          break;
        }
        case 'order_confirm':
          if (!dto.orderId) throw new BadRequestException('Say which order the call is about');
          brief = await orderBrief(dto.orderId, 'order_confirm');
          break;
        case 'follow_up':
          if (!dto.topic || dto.topic.trim().length < 3) throw new BadRequestException('Say what the call is about');
          brief = briefFor('follow_up', lang, { ...base, topic: dto.topic });
          break;
        default:
          throw new BadRequestException('Unknown kind of call');
      }
      return { customer, brief, orderId: orderId as string | null, lang };
    });
  }

  async place(actor: ChannelActor, dto: PlaceCall): Promise<VoiceCall> {
    if (!this.config.callsReady) throw new ConflictException('AI calls are not set up on this server (Sarvam Voice Agents and PUBLIC_API_URL)');
    const settings = await this.db.withTenant(actor.tenantId, (client) => this.repo.settings(client));
    if (!settings.callsEnabled) throw new ConflictException('Turn on AI calls under Settings → Integrations first');
    const { customer, brief, orderId, lang } = await this.prepare(actor, dto);
    const to = dialable(customer.phone);
    if (!to) throw new BadRequestException(`${customer.name} has no phone number that can be called`);
    const id = randomUUID();
    const token = randomBytes(24).toString('hex');
    await this.db.withTenant(actor.tenantId, async (client) => {
      if (await this.repo.liveCall(client, dto.customerId)) throw new ConflictException(`A call to ${customer.name} is already under way`);
      await this.repo.insertCall(client, {
        id,
        tenantId: actor.tenantId,
        customerId: dto.customerId,
        purpose: dto.purpose,
        language: lang,
        toPhone: to,
        brief,
        orderId,
        topic: dto.purpose === 'follow_up' ? brief.topic : null,
        webhookToken: token,
        userId: actor.userId,
      });
      await this.audit.record(client, { tenantId: actor.tenantId, actorUserId: actor.userId, action: 'create', entityType: 'voice_call', entityId: id, after: { ...dto, to, brief } });
    });

    const v = this.config.sarvamVoice;
    let placed: { attemptId: string } | { error: string };
    try {
      const res = await fetch(`${v.apiBase}/api/outbounds/v1/orgs/${v.orgId}/workspaces/${v.workspaceId}/outbounds`, {
        method: 'POST',
        headers: { 'X-API-Key': v.apiKey!, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_config: {
            app_id: v.appId,
            app_version: v.appVersion,
            connection_config: { connection_id: v.connectionId, agent_phone_number: v.fromNumber },
            agent_variables: brief,
            app_overrides: { initial_language_name: LANGUAGE_NAME[lang] },
          },
          user_config: { user_phone_number: to },
          webhook_config: { url: `${this.config.publicApiUrl}/webhooks/sarvam/calls/${id}?token=${token}`, metadata: { callId: id } },
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = (await res.json().catch(() => ({}))) as { attempt_id?: string; detail?: { msg?: string }[] | string };
      const detail = Array.isArray(body.detail) ? body.detail.map((d) => d.msg).filter(Boolean).join('; ') : body.detail;
      placed = res.ok && body.attempt_id ? { attemptId: body.attempt_id } : { error: `Sarvam refused the call: ${detail || res.status}` };
    } catch (err) {
      placed = { error: `Sarvam couldn't be reached: ${err instanceof Error ? err.message : String(err)}` };
    }
    return this.db.withTenant(actor.tenantId, async (client) => {
      await this.repo.placedCall(client, id, placed);
      return (await this.repo.call(client, id)) as VoiceCall;
    });
  }

  /**
   * Sarvam's report when the call ends (its webhook, unsigned): the token in
   * the URL — made for this call, never shown — is what proves it's Sarvam's.
   * A call already reported isn't changed.
   */
  async finished(callId: string, token: string | undefined, payload: unknown): Promise<{ recorded: boolean }> {
    const tenantId = await this.repo.tenantForCall(callId);
    if (!tenantId) throw new NotFoundException('Call not found');
    return this.db.withTenant(tenantId, async (client) => {
      const secrets = await this.repo.callSecrets(client, callId);
      if (!secrets || !token || !sameText(token, secrets.webhookToken)) throw new ForbiddenException('Bad token');
      const result = resultOf(payload);
      if (secrets.attemptId && result.attemptId && result.attemptId !== secrets.attemptId) throw new BadRequestException('Not this call’s attempt');
      const recorded = await this.repo.finishCall(client, callId, result);
      if (recorded) this.log.log(`Call ${callId} ${result.status}${result.outcome ? `: ${result.outcome}` : ''}`);
      return { recorded };
    });
  }
}
