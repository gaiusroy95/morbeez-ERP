import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../../../infra/database/database.service';
import { LANGUAGES, Language } from '../../../common/languages';
import { AiRepository } from '../repositories/ai.repository';
import { AiDataRepository } from '../repositories/ai-data.repository';
import { DECIDE_PERMISSION } from '../entities/ai.entity';
import { ChannelsConfig } from './channels.config';
import { ChannelsRepository, InboundMessage } from './channels.repository';
import { ClaudeOrderReader, ReaderFailed } from './claude-order-reader';
import { OrderReading, readOrderByRules } from './order-reader';
import { messagesOf, orderDraftFromMessage, orderInWords, orderReceivedReply, textMessage } from './whatsapp';
import { validWhatsAppSignature } from './signatures';

export interface ChannelActor {
  tenantId: string;
  userId: string;
  permissions: string[];
}

const languageOf = (v: string): Language => ((LANGUAGES as readonly string[]).includes(v) ? (v as Language) : 'en');

/**
 * Orders customers send on WhatsApp (AI Order Intelligence; requirements
 * Part 14). Meta delivers each message to the webhook; it's stored at once
 * (once, however often Meta delivers it), then read: whose number it is,
 * what they ordered — by Claude when a key is set, else by simple rules —
 * checked against the products the business sells, and made into a
 * suggestion on AI Orders. The owner checks it against the message and
 * places it; nothing is ordered by the AI (DR.1, DR.3). If the business
 * chose to, the customer is told what was understood.
 */
@Injectable()
export class WhatsAppService {
  private readonly log = new Logger(WhatsAppService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ChannelsConfig,
    private readonly repo: ChannelsRepository,
    private readonly ai: AiRepository,
    private readonly data: AiDataRepository,
    private readonly reader: ClaudeOrderReader,
  ) {}

  /** Meta's subscription check: echo the challenge if the token is ours. */
  verify(mode: string | undefined, token: string | undefined, challenge: string | undefined): string {
    const expected = this.config.whatsapp.verifyToken;
    if (!expected) throw new NotFoundException('WhatsApp is not set up');
    if (mode !== 'subscribe' || token !== expected || !challenge) throw new ForbiddenException('Verification failed');
    return challenge;
  }

  /** A webhook delivery: checked, stored, answered at once; read after the answer. */
  async receive(rawBody: Buffer | undefined, signature: string | undefined, body: unknown): Promise<{ received: number }> {
    const secret = this.config.whatsapp.appSecret;
    if (!secret || !this.config.whatsappReceives) throw new NotFoundException('WhatsApp is not set up');
    if (!rawBody || !validWhatsAppSignature(rawBody, signature, secret)) throw new ForbiddenException('Bad signature');
    let received = 0;
    for (const m of messagesOf(body)) {
      const tenantId = await this.repo.tenantForWhatsApp(m.phoneNumberId);
      if (!tenantId) {
        this.log.warn(`WhatsApp message to an unknown number id ${m.phoneNumberId}: ignored`);
        continue;
      }
      const id = await this.db.withTenant(tenantId, (client) =>
        this.repo.insertMessage(client, { tenantId, providerMessageId: m.id, fromPhone: m.from, senderName: m.name, messageType: m.type, body: m.text, receivedAt: m.at }),
      );
      if (!id) continue;
      received += 1;
      // Meta wants its answer within seconds; reading may take longer.
      setImmediate(() => void this.process(tenantId, id));
    }
    return { received };
  }

  messages(tenantId: string): Promise<InboundMessage[]> {
    return this.db.withTenant(tenantId, (client) => this.repo.messages(client, 100));
  }

  /** After the owner put the sender's number on a customer, or the reader failed: read it again. */
  async readAgain(actor: ChannelActor, id: string): Promise<InboundMessage> {
    if (!actor.permissions.includes(DECIDE_PERMISSION.order)) throw new ForbiddenException(`Reading it again needs the ${DECIDE_PERMISSION.order} permission`);
    await this.db.withTenant(actor.tenantId, async (client) => {
      const m = await this.repo.message(client, id);
      if (!m) throw new NotFoundException('Message not found');
      if (m.status === 'suggested') throw new ConflictException('It is on AI Orders already');
      await this.repo.settleMessage(client, id, { status: 'received' });
    });
    await this.process(actor.tenantId, id);
    return (await this.db.withTenant(actor.tenantId, (client) => this.repo.message(client, id))) as InboundMessage;
  }

  /** Never throws: whatever goes wrong is written on the message for the owner to see. */
  async process(tenantId: string, id: string): Promise<void> {
    try {
      await this.read(tenantId, id);
    } catch (err) {
      this.log.error(`WhatsApp message ${id}: ${err instanceof Error ? err.message : String(err)}`);
      await this.db
        .withTenant(tenantId, (client) => this.repo.settleMessage(client, id, { status: 'failed', note: 'Something went wrong reading it — read it again, or place it by hand.' }))
        .catch(() => undefined);
    }
  }

  private async read(tenantId: string, id: string): Promise<void> {
    const { m, customer, business } = await this.db.withTenant(tenantId, async (client) => {
      const m = await this.repo.message(client, id);
      return { m, customer: m ? await this.repo.customerByPhone(client, m.fromPhone) : null, business: await this.repo.businessName(client) };
    });
    if (!m || m.status !== 'received') return;
    const settle = (s: Parameters<ChannelsRepository['settleMessage']>[2]) => this.db.withTenant(tenantId, (client) => this.repo.settleMessage(client, id, s));

    if (m.messageType !== 'text' || !m.body.trim()) {
      return settle({ status: 'not_text', customerId: customer?.id, note: 'Only text messages are read. Listen to or look at it on WhatsApp and place the order by hand.' });
    }
    if (!customer) {
      return settle({ status: 'no_customer', note: `No customer has the number +${m.fromPhone}. Add it to the customer, then read it again.` });
    }

    const { products, lastPrices } = await this.db.withTenantReadOnly(tenantId, 'morbeez_ai', async (client) => ({
      products: await this.data.products(client),
      lastPrices: await this.data.lastPrices(client),
    }));
    const readable = products.map((p) => ({ id: p.id, name: p.name, uom: p.uom }));
    let reading: OrderReading;
    let reader: 'claude' | 'rules' = 'rules';
    let note: string | null = null;
    if (this.reader.available) {
      try {
        reading = await this.reader.read(m.body, business.name, readable);
        reader = 'claude';
      } catch (err) {
        reading = readOrderByRules(m.body, readable);
        note = `Claude couldn't read it (${err instanceof ReaderFailed ? err.message : 'an error'}); read by simple rules instead.`;
      }
    } else {
      reading = readOrderByRules(m.body, readable);
    }
    const extraction = { delivery: reading.delivery, lines: reading.lines, notUnderstood: reading.notUnderstood };
    if (!reading.isOrder || !reading.lines.length) {
      return settle({
        status: 'no_order',
        customerId: customer.id,
        reader,
        extraction,
        note:
          note ??
          (reading.notUnderstood.length
            ? `No product on the list was recognised (${reading.notUnderstood.join(', ')}). Place it by hand if it's an order.`
            : 'Not an order.'),
      });
    }

    const names = new Map(products.map((p) => [p.id, { name: p.name, uom: p.uom, basePrice: p.base_price }]));
    const deliveryDate = reading.delivery === 'today' ? business.today : business.tomorrow;
    const receivedAt = m.receivedAt.toLocaleString('en-IN', { timeZone: business.timezone, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    await this.db.withTenant(tenantId, async (client) => {
      const end = await client.query<{ at: Date }>(`SELECT (($1::date + 1)::timestamp AT TIME ZONE $2) AS at`, [deliveryDate, business.timezone]);
      const draft = orderDraftFromMessage({
        messageId: id,
        customerId: customer.id,
        customerName: customer.name,
        body: m.body,
        receivedAt,
        deliveryDate,
        expiresAt: end.rows[0].at,
        reader,
        reading,
        products: names,
        lastPrices,
      });
      const runId = randomUUID();
      await this.ai.insertRun(client, { id: runId, tenantId, startedAt: m.receivedAt, produced: { order: 1 }, suppressed: {}, userId: null, source: 'whatsapp' });
      const recommendationId = await this.ai.insert(client, tenantId, runId, draft);
      await this.repo.settleMessage(client, id, { status: 'suggested', customerId: customer.id, reader, extraction, recommendationId, note });
    });

    const settings = await this.db.withTenant(tenantId, (client) => this.repo.settings(client));
    if (settings.whatsappReply && settings.whatsappPhoneNumberId && this.config.whatsappReplies) {
      const text = orderReceivedReply(languageOf(customer.language), business.name, orderInWords(reading, names));
      if (await this.send(settings.whatsappPhoneNumberId, m.fromPhone, text)) {
        await this.db.withTenant(tenantId, (client) => this.repo.markReplied(client, id));
      }
    }
  }

  private async send(phoneNumberId: string, to: string, text: string): Promise<boolean> {
    const w = this.config.whatsapp;
    try {
      const res = await fetch(`${w.apiBase}/${w.apiVersion}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${w.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(textMessage(to, text)),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) this.log.warn(`WhatsApp reply refused: ${res.status} ${(await res.text()).slice(0, 300)}`);
      return res.ok;
    } catch (err) {
      this.log.warn(`WhatsApp reply failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
}
