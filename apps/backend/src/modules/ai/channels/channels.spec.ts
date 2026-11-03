import { createHmac } from 'crypto';
import { checkReading, readOrderByRules, ReadableProduct } from './order-reader';
import { validWhatsAppSignature } from './signatures';
import { briefFor, describeBrief, linesInWords, outcomeOf, resultOf } from './call-brief';
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
});

describe('what the voice agent is told, and what it reports', () => {
  const lines = [
    { name: 'Tomato', quantity: '20.000', uom: 'kg', unitPrice: '30.00' },
    { name: 'Onion', quantity: '5.500', uom: 'kg', unitPrice: '40.00' },
  ];

  it('gives the agent only the facts of this call, every one a string', () => {
    const pay = briefFor('payment_reminder', 'ml', { business: 'Dev Wholesaler Co.', customer: 'Hotel Sagar', amountDue: '12500.00', dueSince: '2026-10-01', lines });
    expect(pay).toEqual({
      business_name: 'Dev Wholesaler Co',
      customer_name: 'Hotel Sagar',
      call_purpose: 'payment_reminder',
      customer_language: 'Malayalam',
      amount_due: '12,500 rupees',
      due_since: '2026-10-01',
      order_number: '',
      delivery_date: '',
      order_lines: '',
      order_total: '',
      usual_order: '',
      topic: '',
    });
    const confirm = briefFor('order_confirm', 'ta', { business: 'Dev', customer: 'Sagar', orderNumber: 'D-00042', deliveryDate: '2026-11-03', lines, orderTotal: '820.00' });
    expect(confirm).toMatchObject({ order_number: 'D-00042', order_total: '820 rupees', order_lines: '20 kg Tomato at 30 rupees per kg; 5.5 kg Onion at 40 rupees per kg', amount_due: '', customer_language: 'Tamil' });
    expect(briefFor('order_reminder', 'en', { business: 'Dev', customer: 'Sagar', deliveryDate: '2026-11-03', lines }).usual_order).toBe('20 kg Tomato; 5.5 kg Onion');
    expect(briefFor('follow_up', 'kn', { business: 'Dev', customer: 'Sagar', topic: '  Ask how the new onions were  ' }).topic).toBe('Ask how the new onions were');
  });

  it('says in one line what the call is about', () => {
    expect(describeBrief(briefFor('payment_reminder', 'ml', { business: 'Dev', customer: 'Sagar', amountDue: '12500.00', dueSince: '2026-10-01' }))).toBe(
      'Payment reminder — 12,500 rupees due since 2026-10-01. The agent speaks Malayalam.',
    );
    expect(describeBrief(briefFor('quantity_confirm', 'en', { business: 'Dev', customer: 'Sagar', orderNumber: 'D-00042', deliveryDate: '2026-11-03', lines: lines.slice(0, 1), orderTotal: '600' }))).toBe(
      'Confirm quantities and prices — order D-00042 for 2026-11-03: 20 kg Tomato at 30 rupees per kg (600 rupees). The agent speaks English.',
    );
    // The owner's own full stop isn't doubled.
    expect(describeBrief(briefFor('follow_up', 'en', { business: 'Dev', customer: 'Sagar', topic: 'Ask about the onions.' }))).toBe('Follow-up — Ask about the onions. The agent speaks English.');
    expect(describeBrief(briefFor('follow_up', 'en', { business: 'Dev', customer: 'Sagar', topic: 'Ask about the onions' }))).toBe('Follow-up — Ask about the onions. The agent speaks English.');
    expect(linesInWords([], true)).toBe('');
  });

  it('reads a connected call: the outcome, the summary, what was collected, the conversation', () => {
    const r = resultOf({
      attempt_id: 'att-1',
      status: 'connected',
      channel_info: { channel_type: 'v2v', channel_provider: 'exotel', agent_phone_number: '+918040000000' },
      duration: 74.6,
      interaction_id: '20261102/abc',
      failure_reason: null,
      final_agent_variables: { call_outcome: 'Change Requested', requested_changes: 'Onion 10 kg instead of 5.5', call_summary: 'Wants more onion.', customer_name: 'Sagar' },
      interaction_transcript: [
        { role: 'agent', en_text: 'Hello, this is Dev calling about your order.' },
        { role: 'user', en_text: 'Make the onion 10 kilos.' },
        { role: 'user', en_text: '' },
      ],
    });
    expect(r).toEqual({
      attemptId: 'att-1',
      status: 'completed',
      durationSeconds: 75,
      interactionId: '20261102/abc',
      error: null,
      outcome: 'change_requested',
      summary: 'Wants more onion.',
      details: { call_outcome: 'Change Requested', requested_changes: 'Onion 10 kg instead of 5.5', call_summary: 'Wants more onion.', customer_name: 'Sagar' },
      transcript: [
        { role: 'agent', text: 'Hello, this is Dev calling about your order.' },
        { role: 'user', text: 'Make the onion 10 kilos.' },
      ],
    });
  });

  it('reads a call that never connected, and anything else as failed', () => {
    expect(resultOf({ attempt_id: 'a', status: 'no_answer', duration: null, final_agent_variables: null, interaction_transcript: null })).toMatchObject({ status: 'no_answer', outcome: null, transcript: null, error: null });
    expect(resultOf({ status: 'failed', failure_reason: 'exotel: Phone number is registered under TRAI NDNC' })).toMatchObject({ status: 'failed', error: 'exotel: Phone number is registered under TRAI NDNC' });
    expect(resultOf('nonsense')).toMatchObject({ status: 'failed', error: 'The call could not be placed' });
  });

  it('keeps only the outcomes the agent is set up with', () => {
    expect(outcomeOf('will pay')).toBe('will_pay');
    expect(outcomeOf('ALREADY-PAID')).toBe('already_paid');
    expect(outcomeOf('something else')).toBe('no_decision');
    expect(outcomeOf('')).toBeNull();
    expect(outcomeOf(7)).toBeNull();
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

  it("answers in the customer's language, in the client's words", () => {
    expect(orderReceivedReply('en', '20 kg Tomato')).toBe('Thank you. We understood your order as 20 kg Tomato. Our team will verify and confirm shortly.');
    expect(orderReceivedReply('ml', '20 kg Tomato')).toContain('20 kg Tomato');
    expect(orderReceivedReply('ta', '20 kg Tomato')).toContain('நன்றி');
  });
});
