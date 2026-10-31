import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
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
import { callTwiml, CallPurpose, CallScript, FINAL, keypressTwiml, spokenText, statusOf } from './voice-script';
import { validTwilioSignature } from './signatures';

const languageOf = (v: string): Language => ((LANGUAGES as readonly string[]).includes(v) ? (v as Language) : 'en');

/** An Indian mobile as Twilio dials it: +91 and ten digits. Null when it can't be one. */
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
  /** An order call: the suggestion it's about (AI Calling's row). */
  recommendationId?: string;
}

/**
 * Automated calls to customers (AI Calling; requirements Part 23): the owner
 * picks a customer on AI Calling and places the call; Twilio rings them and
 * asks this API what to say. The call says the facts fixed when it was
 * placed — the amount due, the usual order, the order's lines — in the
 * customer's language, and asks for one key: 1 yes, 2 call me back. What
 * they pressed is shown on AI Calling; nothing changes in the books (DR.1).
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

  /** What the call will say, before it's placed. */
  async preview(actor: ChannelActor, dto: PlaceCall): Promise<{ text: string; language: Language; toPhone: string | null }> {
    const { script, customer } = await this.prepare(actor, dto);
    const language = languageOf(customer.language);
    return { text: spokenText(dto.purpose, language, script), language, toPhone: dialable(customer.phone) };
  }

  private async prepare(actor: ChannelActor, dto: PlaceCall) {
    if (!actor.permissions.includes(DECIDE_PERMISSION.order)) throw new ForbiddenException(`Calling a customer needs the ${DECIDE_PERMISSION.order} permission`);
    if (dto.purpose === 'payment_reminder' && !actor.permissions.includes('finance:read')) throw new ForbiddenException('A payment reminder needs the finance:read permission');
    return this.db.withTenant(actor.tenantId, async (client) => {
      const customer = await this.repo.customerForCall(client, dto.customerId);
      if (!customer) throw new NotFoundException('Customer not found');
      const business = await this.repo.businessName(client);
      // "Dev Wholesaler Co." — said without a second full stop after it.
      const script: CallScript = { business: business.name.trim().replace(/\.+$/, '') };
      let orderId: string | null = null;
      if (dto.purpose === 'payment_reminder') {
        script.amount = await this.data.dueFor(client, dto.customerId);
        if (Number(script.amount) <= 0) throw new ConflictException(`Nothing is due from ${customer.name}`);
      } else {
        if (!dto.recommendationId) throw new BadRequestException('Say which suggestion the call is about');
        const rec = await this.ai.find(client, dto.recommendationId);
        if (!rec || rec.type !== 'order' || rec.subjectId !== dto.customerId) throw new NotFoundException('Suggestion not found');
        const action = rec.proposal.action;
        if (dto.purpose === 'order_reminder') {
          if (action !== 'delivery_order') throw new BadRequestException("That suggestion isn't a usual order");
          if (rec.proposal.source === 'whatsapp') throw new BadRequestException(`${customer.name} ordered on WhatsApp already — place it from AI Orders`);
          const lines = (rec.proposal.lines as { productId: string; quantity: string; uom: string }[]) ?? [];
          const names = await this.repo.productNames(client, lines.map((l) => l.productId));
          script.lines = lines.map((l) => ({ name: names.get(l.productId)?.name ?? '', quantity: l.quantity, uom: l.uom || names.get(l.productId)?.uom || '' }));
        } else {
          if (action !== 'confirm_order') throw new BadRequestException("That suggestion isn't about an order placed");
          orderId = rec.proposal.orderId as string;
          const order = await this.repo.orderForCall(client, orderId);
          if (!order || order.customerId !== dto.customerId) throw new NotFoundException('Order not found');
          if (order.status === 'cancelled') throw new ConflictException(`${formatOrderNumber(order.number)} was cancelled`);
          script.orderNumber = formatOrderNumber(order.number);
          script.deliveryDate = order.deliveryDate ?? undefined;
          script.lines = order.lines;
        }
      }
      return { customer, script, orderId };
    });
  }

  async place(actor: ChannelActor, dto: PlaceCall): Promise<VoiceCall> {
    if (!this.config.callsReady) throw new ConflictException('Automated calls are not set up on this server (Twilio and PUBLIC_API_URL)');
    const settings = await this.db.withTenant(actor.tenantId, (client) => this.repo.settings(client));
    if (!settings.callsEnabled) throw new ConflictException('Turn on automated calls under Settings → Integrations first');
    const { customer, script, orderId } = await this.prepare(actor, dto);
    const to = dialable(customer.phone);
    if (!to) throw new BadRequestException(`${customer.name} has no phone number that can be called`);
    const id = randomUUID();
    await this.db.withTenant(actor.tenantId, async (client) => {
      if (await this.repo.liveCall(client, dto.customerId)) throw new ConflictException(`A call to ${customer.name} is already under way`);
      await this.repo.insertCall(client, { id, tenantId: actor.tenantId, customerId: dto.customerId, purpose: dto.purpose, language: languageOf(customer.language), toPhone: to, script, orderId, userId: actor.userId });
      await this.audit.record(client, { tenantId: actor.tenantId, actorUserId: actor.userId, action: 'create', entityType: 'voice_call', entityId: id, after: { ...dto, to, script } });
    });

    const t = this.config.twilio;
    const base = `${this.config.publicApiUrl}/webhooks/twilio/voice/${id}`;
    const form = new URLSearchParams({ To: to, From: t.fromNumber!, Url: base, Method: 'POST', StatusCallback: `${base}/status`, StatusCallbackMethod: 'POST', Timeout: '30' });
    for (const event of ['initiated', 'ringing', 'answered', 'completed']) form.append('StatusCallbackEvent', event);
    let update: Parameters<ChannelsRepository['updateCall']>[2];
    try {
      const res = await fetch(`${t.apiBase}/2010-04-01/Accounts/${t.accountSid}/Calls.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${t.accountSid}:${t.authToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as { sid?: string; status?: string; message?: string };
      update = res.ok && body.sid
        ? { sid: body.sid, status: statusOf(body.status) ?? 'queued' }
        : { status: 'failed', ended: true, error: `Twilio refused the call: ${body.message ?? res.status}` };
    } catch (err) {
      update = { status: 'failed', ended: true, error: `Twilio couldn't be reached: ${err instanceof Error ? err.message : String(err)}` };
    }
    return this.db.withTenant(actor.tenantId, async (client) => {
      await this.repo.updateCall(client, id, update);
      return (await this.repo.call(client, id)) as VoiceCall;
    });
  }

  // ---- Twilio's side: untenanted, signed ----

  private async signedCall(callId: string, url: string, params: Record<string, string>, signature: string | undefined): Promise<{ tenantId: string; call: VoiceCall }> {
    const token = this.config.twilio.authToken;
    if (!token) throw new NotFoundException('Calls are not set up');
    if (!validTwilioSignature(token, url, params, signature)) throw new ForbiddenException('Bad signature');
    const tenantId = await this.repo.tenantForCall(callId);
    if (!tenantId) throw new NotFoundException('Call not found');
    const call = await this.db.withTenant(tenantId, (client) => this.repo.call(client, callId));
    if (!call) throw new NotFoundException('Call not found');
    return { tenantId, call };
  }

  /** The customer answered: what to say. */
  async twiml(callId: string, url: string, params: Record<string, string>, signature: string | undefined): Promise<string> {
    const { tenantId, call } = await this.signedCall(callId, url, params, signature);
    await this.db.withTenant(tenantId, (client) => this.repo.updateCall(client, callId, { status: 'in_progress', answered: true, sid: params.CallSid }));
    return callTwiml(call.purpose, languageOf(call.language), call.script, `${this.config.publicApiUrl}/webhooks/twilio/voice/${callId}/keypress`);
  }

  /** The key they pressed, and the goodbye. */
  async keypress(callId: string, url: string, params: Record<string, string>, signature: string | undefined): Promise<string> {
    const { tenantId, call } = await this.signedCall(callId, url, params, signature);
    const digits = (params.Digits ?? '').slice(0, 5);
    const { outcome, twiml } = keypressTwiml(call.purpose, languageOf(call.language), call.script, digits);
    await this.db.withTenant(tenantId, (client) => this.repo.updateCall(client, callId, { digits: digits || undefined, outcome }));
    return twiml;
  }

  /** Ringing, answered, finished — and how long it took. */
  async status(callId: string, url: string, params: Record<string, string>, signature: string | undefined): Promise<void> {
    const { tenantId, call } = await this.signedCall(callId, url, params, signature);
    const status = statusOf(params.CallStatus);
    if (!status) return;
    const final = FINAL.includes(status);
    const duration = params.CallDuration !== undefined ? Number(params.CallDuration) : null;
    await this.db.withTenant(tenantId, (client) =>
      this.repo.updateCall(client, callId, {
        sid: params.CallSid,
        status,
        ended: final,
        durationSeconds: Number.isFinite(duration) ? duration : null,
        // Answered and hung up without a key: no answer to the question.
        outcome: final && !call.outcome && call.answeredAt ? 'no_response' : undefined,
        error: status === 'failed' && params.ErrorMessage ? params.ErrorMessage : null,
      }),
    );
    if (final) this.log.log(`Call ${callId} ${status}${duration ? ` after ${duration}s` : ''}`);
  }
}
