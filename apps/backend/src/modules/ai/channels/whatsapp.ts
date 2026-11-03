// The shapes of Meta's WhatsApp Cloud API: the webhook it sends, the text
// reply the business sends back — kept here, apart from what's done with them.

import { Language } from '../../../common/languages';
import { Draft } from '../entities/ai.entity';
import { multiplyToMoney, sumMoney } from '../../../common/money';
import { OrderReading } from './order-reader';

export interface WebhookMessage {
  /** The business's number it came to (Meta's id for it). */
  phoneNumberId: string;
  id: string;
  /** The sender's number: digits, with the country code. */
  from: string;
  name: string | null;
  type: string;
  text: string;
  at: Date;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Every message in a webhook delivery; statuses (sent, read) and anything else are ignored. */
export function messagesOf(body: unknown): WebhookMessage[] {
  const out: WebhookMessage[] = [];
  for (const entry of arr(obj(body).entry)) {
    for (const change of arr(obj(entry).changes)) {
      const value = obj(obj(change).value);
      const phoneNumberId = str(obj(value.metadata).phone_number_id);
      if (!phoneNumberId) continue;
      const names = new Map(arr(value.contacts).map((c) => [str(obj(c).wa_id), str(obj(obj(c).profile).name)]));
      for (const m of arr(value.messages)) {
        const msg = obj(m);
        const id = str(msg.id);
        const from = str(msg.from);
        if (!id || !from) continue;
        const type = str(msg.type) ?? 'unknown';
        const text =
          type === 'text' ? (str(obj(msg.text).body) ?? '') : type === 'button' ? (str(obj(msg.button).text) ?? '') : '';
        const ts = Number(str(msg.timestamp));
        out.push({ phoneNumberId, id, from, name: names.get(from) ?? null, type: type === 'button' ? 'text' : type, text, at: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date() });
      }
    }
  }
  return out;
}

/** A text message to send back (within the 24 hours after the customer wrote, no template is needed). */
export function textMessage(to: string, body: string): Record<string, unknown> {
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body } };
}

/**
 * What the business says back: the order as read, in the customer's
 * language — the client's own words in English. The other three are drafts
 * for native review. Sent from the business's own number, so it isn't named.
 */
export function orderReceivedReply(lang: Language, what: string): string {
  switch (lang) {
    case 'ml':
      return `നന്ദി. നിങ്ങളുടെ ഓർഡർ ഞങ്ങൾ മനസ്സിലാക്കിയത്: ${what}. ഞങ്ങളുടെ ടീം പരിശോധിച്ച് ഉടൻ സ്ഥിരീകരിക്കും.`;
    case 'kn':
      return `ಧನ್ಯವಾದಗಳು. ನಿಮ್ಮ ಆರ್ಡರ್ ಅನ್ನು ನಾವು ಹೀಗೆ ಅರ್ಥಮಾಡಿಕೊಂಡಿದ್ದೇವೆ: ${what}. ನಮ್ಮ ತಂಡ ಪರಿಶೀಲಿಸಿ ಶೀಘ್ರದಲ್ಲೇ ದೃಢೀಕರಿಸುತ್ತದೆ.`;
    case 'ta':
      return `நன்றி. உங்கள் ஆர்டரை நாங்கள் இவ்வாறு புரிந்துகொண்டோம்: ${what}. எங்கள் குழு சரிபார்த்து விரைவில் உறுதிப்படுத்தும்.`;
    default:
      return `Thank you. We understood your order as ${what}. Our team will verify and confirm shortly.`;
  }
}

const qty = (q: number, uom: string) => `${Number(q.toFixed(3)).toLocaleString('en-IN')} ${uom}`;
const inr = (v: string) => `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** "20 kg Tomato, 10 kg Onion". */
export function orderInWords(reading: OrderReading, products: Map<string, { name: string; uom: string }>): string {
  return reading.lines.map((l) => `${qty(l.quantity, products.get(l.productId)?.uom ?? '')} ${products.get(l.productId)?.name ?? ''}`.trim()).join(', ');
}

/**
 * The suggestion a WhatsApp order becomes: a delivery order for the owner
 * to check against the message and place (AI Orders), priced as this
 * customer was last charged, else at today's list price. The same shape
 * the order producer makes, so the same dialog places it.
 */
export function orderDraftFromMessage(m: {
  messageId: string;
  customerId: string;
  customerName: string;
  body: string;
  receivedAt: string;
  deliveryDate: string;
  expiresAt: Date;
  reader: 'sarvam' | 'rules';
  reading: OrderReading;
  products: Map<string, { name: string; uom: string; basePrice: string | null }>;
  lastPrices: Map<string, string>;
}): Draft {
  const lines = m.reading.lines.map((l) => ({
    productId: l.productId,
    uom: m.products.get(l.productId)?.uom ?? '',
    quantity: l.quantity.toFixed(3),
    unitPrice: m.lastPrices.get(`${m.customerId}:${l.productId}`) ?? m.products.get(l.productId)?.basePrice ?? '0.00',
    low: l.quantity.toFixed(3),
    high: l.quantity.toFixed(3),
  }));
  const what = orderInWords(m.reading, m.products);
  const quoted = m.body.length > 300 ? `${m.body.slice(0, 297)}…` : m.body;
  const unread = m.reading.notUnderstood.length ? m.reading.notUnderstood.join(', ') : null;
  return {
    type: 'order',
    subjectKind: 'customer',
    subjectId: m.customerId,
    targetDate: m.deliveryDate,
    title: `${m.customerName} ordered on WhatsApp — ${what}`,
    proposal: {
      action: 'delivery_order',
      customerId: m.customerId,
      deliveryDate: m.deliveryDate,
      lines,
      source: 'whatsapp',
      messageId: m.messageId,
      compare: { lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })) },
    },
    evidence: [
      { fact: `WhatsApp message, ${m.receivedAt}`, value: quoted, source: { kind: 'whatsapp', label: m.customerName } },
      { fact: m.reader === 'sarvam' ? 'Read by Sarvam AI as' : 'Read by simple rules as', value: what, source: { kind: 'whatsapp' } },
      ...(unread ? [{ fact: 'Not recognised', value: unread, source: { kind: 'whatsapp' } }] : []),
      { fact: 'Priced as last charged', value: lines.map((l) => `${m.products.get(l.productId)?.name ?? ''} ${inr(l.unitPrice)}/${l.uom}`).join(', '), source: { kind: 'orders', label: m.customerName } },
    ],
    explanation:
      `${m.customerName} wrote on WhatsApp (${m.receivedAt}): “${quoted}”. Read as ${what}` +
      `${unread ? `; not recognised: ${unread}` : ''}. Check it against the message, then place it.`,
    expectedImpact: sumMoney(lines.map((l) => multiplyToMoney(l.quantity, l.unitPrice))),
    confidence: m.reader === 'sarvam' ? 'rough_guide' : 'early_estimate',
    sensitive: false,
    producer: `whatsapp:${m.reader}@1`,
    expiresAt: m.expiresAt,
  };
}
