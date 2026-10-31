import { createHmac } from 'crypto';
import { checkReading, readOrderByRules, ReadableProduct } from './order-reader';
import { twilioSignature, validTwilioSignature, validWhatsAppSignature } from './signatures';
import { callTwiml, keypressTwiml, linesInWords, rupeesInWords, spokenText, statusOf } from './voice-script';
import { messagesOf, orderDraftFromMessage, orderInWords, orderReceivedReply } from './whatsapp';
import { dialable } from './voice.service';

const P: ReadableProduct[] = [
  { id: 'p-tomato', name: 'Tomato', uom: 'kg' },
  { id: 'p-onion', name: 'Onion', uom: 'kg' },
  { id: 'p-small-onion', name: 'Small Onion', uom: 'kg' },
  { id: 'p-banana', name: 'Banana', uom: 'dozen' },
];

describe('reading an order by rules', () => {
  it('reads a product and a number in either order, one item a line or comma', () => {
    const r = readOrderByRules('Tomato 20 kg\n15kg onion, banana - 4', P);
    expect(r.isOrder).toBe(true);
    expect(r.lines).toEqual([
      { productId: 'p-tomato', quantity: 20, said: 'Tomato 20 kg' },
      { productId: 'p-onion', quantity: 15, said: '15kg onion' },
      { productId: 'p-banana', quantity: 4, said: 'banana - 4' },
    ]);
    expect(r.delivery).toBe('unspecified');
  });

  it('prefers the longer name, turns grams into kilos, and adds up the same product twice', () => {
    const r = readOrderByRules('small onion 5 kg; tomato 500 g and tomatoes 2 kg', P);
    expect(r.lines).toEqual([
      { productId: 'p-small-onion', quantity: 5, said: 'small onion 5 kg' },
      { productId: 'p-tomato', quantity: 2.5, said: 'tomato 500 g; tomatoes 2 kg' },
    ]);
  });

  it("says what it couldn't match, and that a greeting is no order", () => {
    expect(readOrderByRules('carrot 10 kg, tomato 3 kg', P).notUnderstood).toEqual(['carrot 10 kg']);
    const hello = readOrderByRules('Good morning! Payment sent yesterday.', P);
    expect(hello.isOrder).toBe(false);
    expect(hello.lines).toEqual([]);
  });

  it('hears "today" in English and the transliterated words for it', () => {
    expect(readOrderByRules('tomato 10 kg today please', P).delivery).toBe('today');
    expect(readOrderByRules('innu tomato 10 kg venam', P).delivery).toBe('today');
  });
});

describe('checking a reading', () => {
  it('keeps only listed products in sensible quantities', () => {
    const r = checkReading(
      {
        is_order: true,
        delivery: 'tomorrow',
        lines: [
          { product_id: 'p-tomato', quantity: 12.3456, said: 'thakkali 12' },
          { product_id: 'made-up', quantity: 3, said: 'mango 3' },
          { product_id: 'p-onion', quantity: 0, said: 'onion zero' },
          { product_id: 'p-onion', quantity: 1e9, said: 'onion lots' },
        ],
        not_understood: ['coriander'],
      },
      P,
    );
    expect(r.lines).toEqual([{ productId: 'p-tomato', quantity: 12.346, said: 'thakkali 12' }]);
    expect(r.notUnderstood).toEqual(['coriander', 'mango 3', 'onion zero', 'onion lots']);
  });

  it('refuses a reading in the wrong shape', () => {
    expect(() => checkReading({ lines: 'tomato' }, P)).toThrow();
  });
});

describe('signatures', () => {
  it("checks Meta's sha256 signature over the raw body", () => {
    const body = Buffer.from('{"entry":[]}');
    const good = `sha256=${createHmac('sha256', 'app-secret-1').update(body).digest('hex')}`;
    expect(validWhatsAppSignature(body, good, 'app-secret-1')).toBe(true);
    expect(validWhatsAppSignature(body, good, 'another-secret')).toBe(false);
    expect(validWhatsAppSignature(Buffer.from('{"entry":[1]}'), good, 'app-secret-1')).toBe(false);
    expect(validWhatsAppSignature(body, undefined, 'app-secret-1')).toBe(false);
  });

  it("matches Twilio's documented example", () => {
    // https://www.twilio.com/docs/usage/webhooks/webhooks-security
    const params = { CallSid: 'CA1234567890ABCDE', Caller: '+12349013030', Digits: '1234', From: '+12349013030', To: '+18005551212' };
    const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
    expect(twilioSignature('12345', url, params)).toBe('0/KCTR6DLpKmkAf8muzZqo1nDgQ=');
    expect(validTwilioSignature('12345', url, params, '0/KCTR6DLpKmkAf8muzZqo1nDgQ=')).toBe(true);
    expect(validTwilioSignature('12345', url, { ...params, Digits: '1' }, '0/KCTR6DLpKmkAf8muzZqo1nDgQ=')).toBe(false);
  });
});

describe('what a call says', () => {
  const script = { business: 'Morbeez Fresh', amount: '12500.00', lines: [{ name: 'Tomato', quantity: '20.000', uom: 'kg' }], orderNumber: 'D-00042', deliveryDate: '2026-11-01' };

  it('says amounts and quantities as a voice reads them', () => {
    expect(rupeesInWords('12500.00')).toBe('12500');
    expect(rupeesInWords('99.50')).toBe('99.50');
    expect(linesInWords(script.lines, 'en')).toBe('20 kilos Tomato');
    expect(linesInWords(script.lines, 'ml')).toBe('20 കിലോ Tomato');
  });

  it("speaks the customer's language with an Indian voice and asks for one key", () => {
    const xml = callTwiml('payment_reminder', 'ta', script, 'https://api.example.com/webhooks/twilio/voice/c1/keypress');
    expect(xml).toContain('<Gather input="dtmf" numDigits="1"');
    expect(xml).toContain('action="https://api.example.com/webhooks/twilio/voice/c1/keypress"');
    expect(xml).toContain('language="ta-IN" voice="Google.ta-IN-Standard-A"');
    expect(xml).toContain('12500 ரூபாய்');
    expect(spokenText('order_confirm', 'en', script)).toContain('About your order D-00042 for 2026-11-01: 20 kilos Tomato.');
  });

  it('escapes what goes into the XML', () => {
    expect(callTwiml('order_reminder', 'en', { ...script, business: 'A & B <Fresh>' }, 'https://x/k')).toContain('A &amp; B &lt;Fresh&gt;');
  });

  it('turns the key into an outcome', () => {
    expect(keypressTwiml('payment_reminder', 'en', script, '1').outcome).toBe('confirmed');
    expect(keypressTwiml('payment_reminder', 'kn', script, '2').outcome).toBe('callback');
    expect(keypressTwiml('order_reminder', 'en', script, '9').outcome).toBe('no_response');
    expect(keypressTwiml('order_reminder', 'en', script, '').twiml).toContain('<Hangup/>');
  });

  it("maps Twilio's call statuses", () => {
    expect(statusOf('in-progress')).toBe('in_progress');
    expect(statusOf('no-answer')).toBe('no_answer');
    expect(statusOf('initiated')).toBe('queued');
    expect(statusOf('something-new')).toBeNull();
  });

  it('dials Indian mobiles as +91 and ten digits', () => {
    expect(dialable('98000 00011')).toBe('+919800000011');
    expect(dialable('+91 98000-00011')).toBe('+919800000011');
    expect(dialable('919800000011')).toBe('+919800000011');
    expect(dialable('09800000011')).toBe('+919800000011');
    expect(dialable('12345')).toBeNull();
    expect(dialable(null)).toBeNull();
  });
});

describe('WhatsApp', () => {
  const webhook = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '919800000099', phone_number_id: '1098765432' },
              contacts: [{ profile: { name: 'Hotel Sagar' }, wa_id: '919800000011' }],
              messages: [
                { from: '919800000011', id: 'wamid.A', timestamp: '1793500000', type: 'text', text: { body: 'Tomato 20 kg' } },
                { from: '919800000011', id: 'wamid.B', timestamp: '1793500060', type: 'audio', audio: { id: 'm1' } },
              ],
            },
          },
          { field: 'messages', value: { metadata: { phone_number_id: '1098765432' }, statuses: [{ id: 'wamid.X', status: 'read' }] } },
        ],
      },
    ],
  };

  it('takes the messages out of a delivery, ignoring statuses', () => {
    const m = messagesOf(webhook);
    expect(m).toHaveLength(2);
    expect(m[0]).toEqual({ phoneNumberId: '1098765432', id: 'wamid.A', from: '919800000011', name: 'Hotel Sagar', type: 'text', text: 'Tomato 20 kg', at: new Date(1793500000 * 1000) });
    expect(m[1].type).toBe('audio');
    expect(m[1].text).toBe('');
    expect(messagesOf({ nonsense: true })).toEqual([]);
  });

  it('makes a delivery-order suggestion priced as last charged, else at list price', () => {
    const reading = { isOrder: true, delivery: 'unspecified' as const, lines: [{ productId: 'p-tomato', quantity: 20, said: 'Tomato 20 kg' }, { productId: 'p-onion', quantity: 5, said: 'onion 5' }], notUnderstood: ['carrot'] };
    const products = new Map([
      ['p-tomato', { name: 'Tomato', uom: 'kg', basePrice: '30.00' }],
      ['p-onion', { name: 'Onion', uom: 'kg', basePrice: '40.00' }],
    ]);
    const d = orderDraftFromMessage({
      messageId: 'm-1', customerId: 'c-1', customerName: 'Hotel Sagar', body: 'Tomato 20 kg, onion 5, carrot', receivedAt: '31 Oct, 7:42 am',
      deliveryDate: '2026-11-01', expiresAt: new Date('2026-11-01T18:30:00Z'), reader: 'rules', reading, products,
      lastPrices: new Map([['c-1:p-tomato', '28.00']]),
    });
    expect(d.type).toBe('order');
    expect(d.proposal).toMatchObject({ action: 'delivery_order', customerId: 'c-1', deliveryDate: '2026-11-01', source: 'whatsapp', messageId: 'm-1' });
    expect(d.proposal.lines).toEqual([
      { productId: 'p-tomato', uom: 'kg', quantity: '20.000', unitPrice: '28.00', low: '20.000', high: '20.000' },
      { productId: 'p-onion', uom: 'kg', quantity: '5.000', unitPrice: '40.00', low: '5.000', high: '5.000' },
    ]);
    expect(d.expectedImpact).toBe('760.00');
    expect(d.confidence).toBe('early_estimate');
    expect(d.producer).toBe('whatsapp:rules@1');
    expect(d.evidence.map((e) => e.fact)).toEqual(['WhatsApp message, 31 Oct, 7:42 am', 'Read by simple rules as', 'Not recognised', 'Priced as last charged']);
    expect(orderInWords(reading, products)).toBe('20 kg Tomato, 5 kg Onion');
  });

  it("answers in the customer's language", () => {
    expect(orderReceivedReply('en', 'Morbeez Fresh', '20 kg Tomato')).toBe("Thank you, Morbeez Fresh has your order: 20 kg Tomato. We'll confirm it shortly.");
    expect(orderReceivedReply('ml', 'Morbeez Fresh', '20 kg Tomato')).toContain('നന്ദി');
  });
});
