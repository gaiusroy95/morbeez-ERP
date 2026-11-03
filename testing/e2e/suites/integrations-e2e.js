// The AI's channels to customers, end to end through the real API: WhatsApp
// order messages (Meta's webhook, verified and signed), read by Sarvam AI —
// or, when Sarvam fails, by simple rules — into an order suggestion on AI
// Orders, with the client's reply to the customer; and AI calls placed from
// AI Calling to Sarvam's voice agent — a payment reminder, tomorrow's order, a
// new order, a follow-up — with what the agent reported coming back on the
// call's own webhook URL; Do Not Call. Meta and Sarvam are stand-ins this
// suite runs on E2E_STANDIN_URL (run.js's integrations chain points the API at
// them); nothing leaves the machine. Without that chain's settings it only
// checks that everything says it's not set up.
const http = require('http');
const { createHmac, randomUUID } = require('crypto');
const path = require('path');
const { API, BASE, DB_URL, PASSWORD, launchBrowser } = require('../lib/env');
const { Client } = require('pg');

const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STANDIN = process.env.E2E_STANDIN_URL;
const APP_SECRET = process.env.WHATSAPP_APP_SECRET;
const VERIFY = process.env.WHATSAPP_VERIFY_TOKEN;
const PHONE_NUMBER_ID = '1098765432';
const SAGAR_PHONE = '919800000071'; // dev placeholder numbers
const ANNA_PHONE = '+919800000072';
const AGENT_NUMBER = '+919800000090';
const OUTBOUNDS = '/sarvam-voice/api/outbounds/v1/orgs/e2e-org/workspaces/e2e-workspace/outbounds';

async function login(login) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password: PASSWORD }) });
  return (await r.json()).accessToken;
}
function client(token) {
  const call = async (method, path, body) => {
    const r = await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  const ok = async (method, path, body) => {
    const r = await call(method, path, body);
    if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  return { raw: call, get: (p) => ok('GET', p), post: (p, b = {}) => ok('POST', p, b), put: (p, b) => ok('PUT', p, b), patch: (p, b) => ok('PATCH', p, b) };
}
const words = (r) => r.body?.error?.message ?? '';

// ---- The stand-ins: what the API sent each, and what each answers ----

const seen = { sarvam: [], graph: [], outbound: [] };
let reading = null; // what "Sarvam AI" answers next; null → a 500
function standIn(port) {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const json = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.url === '/sarvam/v1/chat/completions') {
        seen.sarvam.push({ headers: req.headers, body: JSON.parse(raw || '{}') });
        if (!reading) return json(500, { error: { message: 'stand-in down', code: 'internal_server_error' } });
        return json(200, {
          id: `chat_${seen.sarvam.length}`, object: 'chat.completion', model: 'sarvam-105b',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(reading) } }],
          usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
        });
      }
      if (req.url.startsWith('/graph/')) {
        seen.graph.push({ url: req.url, headers: req.headers, body: JSON.parse(raw || '{}') });
        return json(200, { messaging_product: 'whatsapp', messages: [{ id: `wamid.reply${seen.graph.length}` }] });
      }
      if (req.url === OUTBOUNDS && req.method === 'POST') {
        const attempt = `attempt_${seen.outbound.length + 1}`;
        seen.outbound.push({ headers: req.headers, body: JSON.parse(raw || '{}'), attempt });
        return json(200, { attempt_id: attempt });
      }
      json(404, {});
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

// ---- Meta's and Sarvam's side ----

function webhook(messages) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '919800000099', phone_number_id: PHONE_NUMBER_ID }, contacts: messages.map((m) => ({ wa_id: m.from, profile: { name: m.name ?? 'Customer' } })), messages: messages.map((m) => ({ from: m.from, id: m.id, timestamp: String(Math.floor(Date.now() / 1000)), type: m.type ?? 'text', ...(m.type && m.type !== 'text' ? { [m.type]: { id: 'media1' } } : { text: { body: m.text } }) })) } }] }],
  };
}
async function deliver(messages, secret = APP_SECRET) {
  const body = JSON.stringify(webhook(messages));
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  const r = await fetch(`${API}/webhooks/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, body });
  return { status: r.status, body: await r.json().catch(() => null) };
}
/** What Sarvam was asked for a call, by the call's id (its webhook metadata). */
const outboundFor = (callId) => seen.outbound.find((o) => o.body.webhook_config?.metadata?.callId === callId);
/** Sarvam's report when a call ends, posted where the call said (unsigned). */
async function report(url, payload) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const reportOf = (o, status, vars, transcript) => ({
  attempt_id: o.attempt,
  interaction_id: `int_${o.attempt}`,
  status,
  ...(status === 'connected' ? { duration: 74.4, final_agent_variables: { ...o.body.app_config.agent_variables, ...vars }, interaction_transcript: transcript ?? [] } : {}),
});

(async () => {
  const owner = client(await login('owner@dev.morbeez.local'));
  const status = await owner.get('/integrations');

  if (!STANDIN || !APP_SECRET) {
    // Not the integrations chain: nothing is set up, and each part says so.
    check('nothing is set up without keys', !status.whatsapp.receives && !status.reader.sarvam && !status.calls.ready, JSON.stringify(status.whatsapp));
    const hook = await fetch(`${API}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1`);
    check('the WhatsApp webhook answers 404 when it isn’t set up', hook.status === 404, String(hook.status));
    const calls = await owner.get('/ai/calls');
    check('AI Calling says AI calls aren’t set up', calls.voice === 'not_set_up', calls.voice);
    return finish();
  }

  const server = await standIn(Number(new URL(STANDIN).port));
  try {
    // ---- Settings → Integrations ----
    check('the server reports WhatsApp, Sarvam AI and AI calls set up', status.whatsapp.receives && status.whatsapp.replies && status.reader.sarvam && status.reader.model === 'sarvam-105b' && status.calls.ready && status.calls.fromNumber === AGENT_NUMBER,
      JSON.stringify({ wa: status.whatsapp.receives, reply: status.whatsapp.replies, reader: status.reader, calls: status.calls }));
    check('replies to customers are on until the owner turns them off', status.settings.whatsappReply === true && status.settings.callsEnabled === false, JSON.stringify(status.settings));
    check('the webhook URL to paste into Meta is under this API', status.whatsapp.webhookUrl === `${API}/webhooks/whatsapp`, status.whatsapp.webhookUrl);
    const badId = await owner.raw('PUT', '/integrations/settings', { version: 0, whatsappPhoneNumberId: 'not-a-number', whatsappReply: true, callsEnabled: true });
    check('a phone number ID that isn’t digits is refused', badId.status === 400, `${badId.status}`);
    const saved = await owner.put('/integrations/settings', { version: 0, whatsappPhoneNumberId: PHONE_NUMBER_ID, whatsappReply: true, callsEnabled: false });
    check('the business’s WhatsApp number is saved', saved.settings.whatsappPhoneNumberId === PHONE_NUMBER_ID && saved.settings.version === 1, JSON.stringify(saved.settings));
    const stale = await owner.raw('PUT', '/integrations/settings', { version: 0, whatsappPhoneNumberId: PHONE_NUMBER_ID, whatsappReply: true, callsEnabled: true });
    check('saving over someone else’s change is refused', stale.status === 409, `${stale.status} ${words(stale)}`);

    // ---- Meta's webhook ----
    const challenge = await fetch(`${API}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=8301`);
    check('Meta’s verification gets its challenge back', challenge.status === 200 && (await challenge.text()) === '8301', String(challenge.status));
    const wrong = await fetch(`${API}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=guess&hub.challenge=8301`);
    check('a wrong verify token is refused', wrong.status === 403, String(wrong.status));
    const forged = await deliver([{ from: SAGAR_PHONE, id: `wamid.${randomUUID()}`, text: 'Tomato 20 kg' }], 'not-the-secret');
    check('a delivery not signed with the app secret is refused', forged.status === 403, String(forged.status));

    // The customer whose number it is, who reads English.
    const customers = (await owner.get('/customers?pageSize=100')).items;
    let sagar = customers.find((c) => c.name === 'Hotel Sagar');
    sagar = await owner.patch(`/customers/${sagar.id}`, { version: sagar.version, contact: { ...(sagar.contact ?? {}), phone: `+${SAGAR_PHONE}` }, preferredLanguage: 'en' });
    const products = (await owner.get('/products?pageSize=100')).items;
    const tomato = products.find((p) => p.name === 'Tomato');
    const onion = products.find((p) => p.name === 'Onion') ?? products.find((p) => p.id !== tomato.id);

    const waitFor = async (id) => {
      for (let i = 0; i < 40; i++) {
        const m = (await owner.get('/ai/whatsapp/messages')).find((x) => x.body !== undefined && x.id === id);
        if (m && m.status !== 'received') return m;
        await sleep(250);
      }
      return null;
    };
    const byProvider = async (providerBody) => (await owner.get('/ai/whatsapp/messages')).find((m) => m.body === providerBody);

    // 1. Read by Sarvam AI: what it says is checked against the product list.
    reading = { is_order: true, delivery: 'tomorrow', lines: [{ product_id: tomato.id, quantity: 20, said: 'thakkali 20 kilo' }, { product_id: randomUUID(), quantity: 3, said: 'mango 3' }], not_understood: [] };
    const first = { from: SAGAR_PHONE, id: `wamid.${randomUUID()}`, text: 'Naale thakkali 20 kilo venam, mango 3', name: 'Sagar' };
    const delivered = await deliver([first]);
    check('a signed delivery is taken at once', delivered.status === 200 && delivered.body?.received === 1, JSON.stringify(delivered.body));
    let msg = await byProvider(first.text);
    msg = msg && (await waitFor(msg.id));
    check('Sarvam AI’s reading becomes a suggestion for Hotel Sagar', msg?.status === 'suggested' && msg.reader === 'sarvam' && msg.customerName === 'Hotel Sagar', JSON.stringify(msg && { s: msg.status, r: msg.reader, n: msg.note }));
    const ask = seen.sarvam[0];
    check('Sarvam is asked with Morbeez’s key, sarvam-105b, low reasoning effort and a strict JSON schema',
      ask?.body.model === 'sarvam-105b' && ask.body.reasoning_effort === 'low' && ask.body.response_format?.type === 'json_schema' && ask.body.response_format.json_schema?.strict === true &&
        ask.headers['api-subscription-key'] === 'e2e-sarvam-key',
      JSON.stringify(ask && { model: ask.body.model, effort: ask.body.reasoning_effort, format: ask.body.response_format?.type }));
    check('the product list goes in the instructions; the message is the customer’s words', ask?.body.messages[0].role === 'system' && ask.body.messages[0].content.includes(tomato.id) && ask.body.messages[1].content.includes(first.text), '');
    const open = await owner.get('/ai/recommendations?status=open&type=order&pageSize=100');
    const rec = open.items.find((r) => r.id === msg?.recommendationId);
    check('the suggestion is a delivery order with only what’s on the product list', rec?.proposal.action === 'delivery_order' && rec.proposal.source === 'whatsapp' && rec.proposal.lines.length === 1 && rec.proposal.lines[0].productId === tomato.id && Number(rec.proposal.lines[0].quantity) === 20,
      JSON.stringify(rec?.proposal.lines));
    check('what wasn’t on the list is shown, not ordered', rec?.evidence.some((e) => e.fact === 'Not recognised' && e.value.includes('mango')), JSON.stringify(rec?.evidence.map((e) => e.fact)));
    for (let i = 0; i < 20 && seen.graph.length === 0; i++) await sleep(200);
    const reply = seen.graph[0];
    const replyText = reply?.body.text?.body ?? '';
    check('the customer is answered in the client’s words: “Thank you. We understood your order as … Our team will verify and confirm shortly.”',
      reply?.url === `/graph/v23.0/${PHONE_NUMBER_ID}/messages` && reply.body.to === SAGAR_PHONE && reply.headers.authorization === 'Bearer e2e-access-token' &&
        /^Thank you\. We understood your order as 20 \S+ Tomato\. Our team will verify and confirm shortly\.$/.test(replyText),
      replyText);

    // 2. Meta delivers the same message again: it's one message.
    const before = (await owner.get('/ai/whatsapp/messages')).length;
    const again = await deliver([first]);
    check('the same message delivered twice is one message', again.status === 200 && again.body.received === 0 && (await owner.get('/ai/whatsapp/messages')).length === before, JSON.stringify(again.body));

    // 3. An owner's AI run doesn't sweep away a customer's WhatsApp order. The
    // same run works out a customer's usual order — four weeks of it on
    // tomorrow's weekday, written straight to the books — for the calls below;
    // Hotel Sagar gets an invoice fallen due, for a payment reminder.
    const anna = await owner.post('/customers', { name: 'Annapoorna Hotel', contact: { phone: ANNA_PHONE }, creditLimit: 100000, paymentTermsDays: 7, preferredLanguage: 'ml' });
    const db = new Client({ connectionString: DB_URL });
    await db.connect();
    const today = (await owner.get('/accounting/periods')).today;
    const at = (d, n) => {
      const x = new Date(`${d}T00:00:00Z`);
      x.setUTCDate(x.getUTCDate() + n);
      return x.toISOString().slice(0, 10);
    };
    const ownerUser = (await db.query(`SELECT id, tenant_id FROM identity.app_user WHERE email = 'owner@dev.morbeez.local'`)).rows[0];
    const insertOrder = async (customerId, status, deliveryDate, quantity, createdNow) => {
      const id = randomUUID();
      const number = (await db.query('SELECT COALESCE(MAX(number), 0)::int + 1 AS n FROM commerce.customer_order')).rows[0].n;
      await db.query(
        `INSERT INTO commerce.customer_order (id, tenant_id, customer_id, status, created_by, number, delivery_date, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::date, ${createdNow ? 'now()' : "($7::date - 1 + time '10:00') AT TIME ZONE 'Asia/Kolkata'"}, now())`,
        [id, ownerUser.tenant_id, customerId, status, ownerUser.id, number, deliveryDate],
      );
      await db.query('INSERT INTO commerce.customer_order_line (order_id, product_id, quantity, unit_price, delivered_quantity) VALUES ($1, $2, $3, 30, $4)', [id, tomato.id, quantity, status === 'delivered' ? quantity : null]);
      return id;
    };
    for (const n of [7, 14, 21, 28]) await insertOrder(anna.id, 'delivered', at(at(today, 1), -n), 40, false);
    const sagarOrder = await insertOrder(sagar.id, 'delivered', at(today, -10), 25, false);
    const dueDate = at(today, -3);
    await db.query(
      `INSERT INTO money.invoice (tenant_id, invoice_number, kind, customer_id, order_id, issued_at, due_date, amount, created_by)
       VALUES ($1, $2, 'sale', $3, $4, now() - interval '10 days', $5::date, 750, $6)`,
      [ownerUser.tenant_id, `INV-E2E-${randomUUID().slice(0, 6)}`, sagar.id, sagarOrder, dueDate, ownerUser.id],
    );
    await owner.post('/ai/runs');
    const usual = (await owner.get('/ai/recommendations?status=open&type=order&pageSize=100')).items.find((r) => r.subjectId === anna.id && r.proposal.action === 'delivery_order');
    const still = await owner.get(`/ai/recommendations/${rec.id}`);
    check('a fresh AI run leaves the WhatsApp suggestion open', !still.decision, JSON.stringify(still.decision));

    // 4. Sarvam down: simple rules read it, and say so.
    reading = null;
    const second = { from: SAGAR_PHONE, id: `wamid.${randomUUID()}`, text: `${tomato.name} 12 kg\n${onion.name} 5 kg` };
    await deliver([second]);
    msg = await waitFor((await byProvider(second.text))?.id);
    const rec2 = msg && (await owner.get(`/ai/recommendations/${msg.recommendationId}`));
    check('when Sarvam fails, simple rules read it — and the note says so', msg?.status === 'suggested' && msg.reader === 'rules' && /Sarvam AI couldn't read it/.test(msg.note ?? '') && rec2?.proposal.lines.length === 2 && rec2.confidence === 'early_estimate',
      JSON.stringify(msg && { s: msg.status, r: msg.reader, n: msg.note }));

    // 5. A number no customer has; a voice note; a greeting.
    const stranger = { from: '919800000079', id: `wamid.${randomUUID()}`, text: 'Tomato 10 kg' };
    await deliver([stranger]);
    msg = await waitFor((await byProvider(stranger.text))?.id);
    check('a number no customer has is kept, unmatched, for the owner', msg?.status === 'no_customer' && /\+919800000079/.test(msg.note ?? ''), JSON.stringify(msg && { s: msg.status, n: msg.note }));
    const voice = { from: SAGAR_PHONE, id: `wamid.${randomUUID()}`, type: 'audio' };
    await deliver([voice]);
    let voiceMsg = null;
    for (let i = 0; i < 40 && !voiceMsg; i++) {
      voiceMsg = (await owner.get('/ai/whatsapp/messages')).find((m) => m.messageType === 'audio' && m.status !== 'received') ?? null;
      if (!voiceMsg) await sleep(250);
    }
    check('a voice note is kept, for the owner to listen to', voiceMsg?.status === 'not_text', JSON.stringify(voiceMsg && voiceMsg.status));
    reading = { is_order: false, delivery: 'unspecified', lines: [], not_understood: [] };
    const hello = { from: SAGAR_PHONE, id: `wamid.${randomUUID()}`, text: 'Good morning! Payment sent yesterday.' };
    await deliver([hello]);
    msg = await waitFor((await byProvider(hello.text))?.id);
    check('a message that isn’t an order makes no suggestion', msg?.status === 'no_order' && !msg.recommendationId, JSON.stringify(msg && msg.status));
    // Read again once the number is a customer's: the stranger becomes Green Mart.
    const green = await owner.post('/customers', { name: `Green Mart ${randomUUID().slice(0, 4)}`, contact: { phone: '+919800000079' } });
    reading = { is_order: true, delivery: 'today', lines: [{ product_id: tomato.id, quantity: 10, said: 'Tomato 10 kg' }], not_understood: [] };
    const strangerMsg = await byProvider(stranger.text);
    const reread = await owner.raw('POST', `/ai/whatsapp/messages/${strangerMsg.id}/read-again`);
    check('read again once the number is on a customer, it becomes a suggestion for today', reread.status === 200 && reread.body.status === 'suggested' && reread.body.customerName === green.name,
      `${reread.status} ${JSON.stringify(reread.body && { s: reread.body.status, n: reread.body.note })}`);
    // Green Mart's new order, placed just now, for tomorrow: a call can confirm it.
    const greenOrder = await insertOrder(green.id, 'placed', at(today, 1), 25, true);
    await db.end();

    // ---- AI calls: tomorrow's usual order, in Malayalam ----
    let calls = await owner.get('/ai/calls');
    check('AI Calling says AI calls are set up but off for this business', calls.voice === 'off', calls.voice);
    const off = await owner.raw('POST', '/ai/calls/voice', { customerId: anna.id, purpose: 'order_reminder', recommendationId: usual.id });
    check('a call isn’t placed while the business has AI calls off', off.status === 409, `${off.status} ${words(off)}`);
    await owner.put('/integrations/settings', { version: 1, whatsappPhoneNumberId: PHONE_NUMBER_ID, whatsappReply: true, callsEnabled: true });
    calls = await owner.get('/ai/calls');
    check('turned on, AI Calling is ready', calls.voice === 'ready', calls.voice);

    const preview = await owner.post('/ai/calls/voice/preview', { customerId: anna.id, purpose: 'order_reminder', recommendationId: usual.id });
    check('what the agent will be told is shown first: the usual order, and the language it speaks', /40 kg Tomato/.test(preview.text) && /speaks Malayalam/.test(preview.text) && preview.language === 'Malayalam' && preview.toPhone === ANNA_PHONE, preview.text);
    const placed = await owner.post('/ai/calls/voice', { customerId: anna.id, purpose: 'order_reminder', recommendationId: usual.id });
    const sent = outboundFor(placed.id);
    const cfg = sent?.body.app_config;
    check('Sarvam’s agent is asked to ring the customer from the business’s number, in Malayalam, with the usual order as its brief',
      placed.status === 'queued' && sent?.headers['x-api-key'] === 'e2e-sarvam-voice-key' && cfg.app_id === 'e2e-agent' && cfg.app_version === 3 &&
        cfg.connection_config?.connection_id === 'e2e-connection' && cfg.connection_config.agent_phone_number === AGENT_NUMBER && sent.body.user_config?.user_phone_number === ANNA_PHONE &&
        cfg.app_overrides?.initial_language_name === 'Malayalam' && cfg.agent_variables?.call_purpose === 'order_reminder' && cfg.agent_variables.usual_order === '40 kg Tomato' &&
        cfg.agent_variables.customer_name === 'Annapoorna Hotel' && cfg.agent_variables.customer_language === 'Malayalam' && cfg.agent_variables.amount_due === '' && cfg.agent_variables.topic === '',
      JSON.stringify(sent?.body));
    const hookUrl = sent?.body.webhook_config?.url ?? '';
    check('the report comes back to this API, with a token made for this call', hookUrl.startsWith(`${API}/webhooks/sarvam/calls/${placed.id}?token=`) && /^[0-9a-f]{48}$/.test(new URL(hookUrl).searchParams.get('token') ?? ''), hookUrl.replace(/token=\w+/, 'token=…'));
    const twice = await owner.raw('POST', '/ai/calls/voice', { customerId: anna.id, purpose: 'order_reminder', recommendationId: usual.id });
    check('a second call to someone already being called is refused', twice.status === 409, `${twice.status} ${words(twice)}`);

    const transcript = [
      { role: 'agent', en_text: 'Hello, I am calling from your vegetable supplier. Shall we send your usual 40 kg of tomatoes tomorrow?' },
      { role: 'user', en_text: 'Yes, but make it 50 kg tomorrow, we have a function.' },
      { role: 'agent', en_text: 'Noted, 50 kg of tomatoes for tomorrow. Our team will confirm the changed order.' },
      { role: 'user', en_text: 'Okay, thank you.' },
      { role: 'user', en_text: '' },
    ];
    const answer = reportOf(sent, 'connected', {
      call_outcome: 'Change Requested',
      requested_changes: 'Tomato 50 kg instead of 40 kg',
      promised_payment_date: '',
      callback_time: '',
      call_summary: 'They want 50 kg of tomatoes tomorrow instead of the usual 40 kg for a function. Confirm the changed order with them.',
    }, transcript);
    const forgedReport = await report(hookUrl.replace(/token=\w+/, `token=${'f'.repeat(48)}`), answer);
    const noToken = await report(`${API}/webhooks/sarvam/calls/${placed.id}`, answer);
    const unknown = await report(`${API}/webhooks/sarvam/calls/${randomUUID()}?token=${'f'.repeat(48)}`, answer);
    check('a report without this call’s token is refused; a call that doesn’t exist isn’t found', forgedReport.status === 403 && noToken.status === 403 && unknown.status === 404, `${forgedReport.status} ${noToken.status} ${unknown.status}`);
    const reported = await report(hookUrl, answer);
    let history = await owner.get('/ai/calls/voice');
    let call = history.find((c) => c.id === placed.id);
    check('Sarvam’s report is kept: finished, 74 s, wants changes — what, a summary, and the conversation',
      reported.status === 200 && reported.body?.recorded === true && call?.status === 'completed' && call.durationSeconds === 74 && call.outcome === 'change_requested' &&
        call.details?.requested_changes === 'Tomato 50 kg instead of 40 kg' && /^They want 50 kg/.test(call.summary ?? '') &&
        call.transcript?.length === 4 && call.transcript[0].role === 'agent' && call.transcript[1].role === 'user' && call.transcript[1].text.includes('50 kg'),
      JSON.stringify(call && { s: call.status, d: call.durationSeconds, o: call.outcome, t: call.transcript?.length }));
    const late = await report(hookUrl, { ...answer, final_agent_variables: { ...answer.final_agent_variables, call_outcome: 'confirmed' } });
    call = (await owner.get('/ai/calls/voice')).find((c) => c.id === placed.id);
    check('a report sent again doesn’t change a finished call', late.status === 200 && late.body?.recorded === false && call.outcome === 'change_requested', JSON.stringify(late.body));
    const unchanged = await owner.get(`/ai/recommendations/${usual.id}`);
    check('nothing changes in the books — the usual order is still the owner’s to place', !unchanged.decision, JSON.stringify(unchanged.decision));

    // Called again: a report for another attempt is refused; nobody answers.
    const again2 = await owner.post('/ai/calls/voice', { customerId: anna.id, purpose: 'order_reminder', recommendationId: usual.id });
    const sent2 = outboundFor(again2.id);
    const otherAttempt = await report(sent2.body.webhook_config.url, { ...reportOf(sent2, 'no_answer'), attempt_id: 'attempt_999' });
    const noAnswer = await report(sent2.body.webhook_config.url, reportOf(sent2, 'no_answer'));
    call = (await owner.get('/ai/calls/voice')).find((c) => c.id === again2.id);
    check('a report for another attempt is refused; not answered: no answer, no outcome', otherAttempt.status === 400 && noAnswer.status === 200 && call?.status === 'no_answer' && !call.outcome && !call.transcript,
      `${otherAttempt.status} ${JSON.stringify(call && [call.status, call.outcome])}`);

    // ---- A payment reminder ----
    calls = await owner.get('/ai/calls');
    const pay = calls.calls.find((c) => c.kind === 'payment' && c.customerId === sagar.id);
    check('money fallen due is on the call list, with the customer’s phone', Number(pay?.amount) === 750 && pay.phone && pay.recommendationId === null, JSON.stringify(pay));
    const payPreview = await owner.post('/ai/calls/voice/preview', { customerId: sagar.id, purpose: 'payment_reminder' });
    check('a payment reminder tells the agent the amount due and since when', payPreview.text.startsWith(`Payment reminder — 750 rupees due since ${dueDate}`) && payPreview.language === 'English', payPreview.text);
    const payCall = await owner.post('/ai/calls/voice', { customerId: sagar.id, purpose: 'payment_reminder' });
    const paySent = outboundFor(payCall.id);
    const payVars = paySent?.body.app_config.agent_variables;
    check('the agent’s brief: the amount due as it’s said, the date, nothing about orders', payVars?.call_purpose === 'payment_reminder' && payVars.amount_due === '750 rupees' && payVars.due_since === dueDate && payVars.order_lines === '' && paySent.body.app_config.app_overrides.initial_language_name === 'English',
      JSON.stringify(payVars));
    await report(paySent.body.webhook_config.url, reportOf(paySent, 'connected', { call_outcome: 'will_pay', promised_payment_date: at(today, 3), call_summary: 'They will pay the 750 rupees by UPI in three days.' }, [
      { role: 'agent', en_text: 'Hello, this is a reminder that 750 rupees is due. When can you pay?' },
      { role: 'user', en_text: 'I will send it by UPI in three days.' },
    ]));
    call = (await owner.get('/ai/calls/voice')).find((c) => c.id === payCall.id);
    check('the reminder’s outcome: will pay, and when', call?.outcome === 'will_pay' && call.details?.promised_payment_date === at(today, 3), JSON.stringify(call && { o: call.outcome, d: call.details?.promised_payment_date }));

    // ---- A new order to confirm ----
    const fresh = calls.calls.find((c) => c.kind === 'new_order' && c.customerId === green.id);
    check('a new order placed in the last day is on the call list to confirm', fresh?.orderId === greenOrder && Number(fresh.amount) === 750 && (fresh.about ?? '').includes(at(today, 1)), JSON.stringify(fresh));
    const notTheirs = await owner.raw('POST', '/ai/calls/voice/preview', { customerId: anna.id, purpose: 'order_confirm', orderId: greenOrder });
    check('a call about another customer’s order is refused', notTheirs.status === 404, `${notTheirs.status} ${words(notTheirs)}`);
    const orderCall = await owner.post('/ai/calls/voice', { customerId: green.id, purpose: 'order_confirm', orderId: greenOrder });
    const orderVars = outboundFor(orderCall.id)?.body.app_config.agent_variables;
    check('the agent is told the order, its lines with prices, the total and the day', orderVars?.call_purpose === 'order_confirm' && fresh.about.startsWith(orderVars.order_number) && orderVars.order_lines === '25 kg Tomato at 30 rupees per kg' && orderVars.order_total === '750 rupees' && orderVars.delivery_date === at(today, 1),
      JSON.stringify(orderVars));
    await report(outboundFor(orderCall.id).body.webhook_config.url, reportOf(outboundFor(orderCall.id), 'busy'));
    call = (await owner.get('/ai/calls/voice')).find((c) => c.id === orderCall.id);
    check('a busy line is shown as busy', call?.status === 'busy' && !call.outcome, JSON.stringify(call && call.status));

    // ---- A follow-up on whatever the owner types ----
    const vague = await owner.raw('POST', '/ai/calls/voice', { customerId: sagar.id, purpose: 'follow_up', topic: 'hi' });
    check('a follow-up needs something to talk about', vague.status === 400, `${vague.status} ${words(vague)}`);
    const topic = 'Ask how the last delivery of tomatoes was, and whether they want the same next week.';
    const followUp = await owner.post('/ai/calls/voice', { customerId: sagar.id, purpose: 'follow_up', topic });
    const followSent = outboundFor(followUp.id);
    check('the follow-up’s topic is the agent’s brief, and nothing else', followSent?.body.app_config.agent_variables.topic === topic && followSent.body.app_config.agent_variables.call_purpose === 'follow_up' && followSent.body.app_config.agent_variables.amount_due === '' && followUp.topic === topic,
      JSON.stringify(followSent?.body.app_config.agent_variables));
    await report(followSent.body.webhook_config.url, reportOf(followSent, 'connected', { call_outcome: 'call_later', callback_time: 'Tomorrow after 4 pm', call_summary: 'They were busy serving lunch and asked to be called back tomorrow after 4 pm.' }, [
      { role: 'agent', en_text: 'Hello, how was the last delivery of tomatoes?' },
      { role: 'user', en_text: 'I am busy with lunch now, call me tomorrow after 4.' },
    ]));

    // ---- Do Not Call ----
    let annaNow = (await owner.get('/customers?pageSize=100')).items.find((c) => c.id === anna.id);
    annaNow = await owner.patch(`/customers/${anna.id}`, { version: annaNow.version, doNotCall: true });
    check('a customer can be marked Do Not Call', annaNow.doNotCall === true, JSON.stringify({ dnc: annaNow.doNotCall }));
    const dncPreview = await owner.raw('POST', '/ai/calls/voice/preview', { customerId: anna.id, purpose: 'order_reminder', recommendationId: usual.id });
    const dncPlace = await owner.raw('POST', '/ai/calls/voice', { customerId: anna.id, purpose: 'follow_up', topic });
    const outboundCount = seen.outbound.length;
    check('a customer marked Do Not Call is never called', dncPreview.status === 409 && dncPlace.status === 409 && /marked Do Not Call/.test(words(dncPlace)) && seen.outbound.length === outboundCount,
      `${dncPreview.status} ${dncPlace.status} ${words(dncPlace)}`);
    calls = await owner.get('/ai/calls');
    check('the call list shows them marked', calls.calls.some((c) => c.kind === 'order' && c.customerId === anna.id && c.doNotCall === true), JSON.stringify(calls.calls.filter((c) => c.customerId === anna.id)));

    // The old rules still hold.
    const asked = await owner.raw('POST', '/ai/calls/voice', { customerId: sagar.id, purpose: 'order_reminder', recommendationId: rec.id });
    check('no call asks for an order the customer sent on WhatsApp', asked.status === 400 && /WhatsApp already/.test(words(asked)), `${asked.status} ${words(asked)}`);
    check('AI Calling asks only for the usual order that hasn’t come — not the ones sent on WhatsApp', calls.calls.filter((c) => c.kind === 'order').length === 1 && calls.calls.some((c) => c.kind === 'order' && c.customerId === anna.id),
      JSON.stringify(calls.calls.map((c) => [c.kind, c.name])));
    const wrongKind = await owner.raw('POST', '/ai/calls/voice', { customerId: green.id, purpose: 'order_confirm', recommendationId: usual.id });
    check('a call without the order it’s about is refused in words', wrongKind.status === 400 && words(wrongKind).length > 0, `${wrongKind.status} ${words(wrongKind)}`);

    // ---- The owner app ----
    const out = process.env.E2E_SCREENSHOTS;
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
      await page.goto(`${BASE}/login`);
      await page.fill('#login', 'owner@dev.morbeez.local');
      await page.fill('#password', PASSWORD);
      await page.click('button[type=submit]');
      await page.waitForURL((u) => !/\/login/.test(u.toString()));

      await page.goto(`${BASE}/settings?tab=integrations`);
      await page.getByText('What this server is set up for').waitFor();
      const settingsText = (await page.locator('main').textContent()).replace(/\s+/g, ' ');
      check('Settings → Integrations: WhatsApp, Sarvam AI, AI calls, the webhook URL to paste', /Receiving/.test(settingsText) && /Sarvam AI \(sarvam-105b\)/.test(settingsText) && /Can call/.test(settingsText) && settingsText.includes(`${API}/webhooks/whatsapp`),
        settingsText.slice(0, 300));
      if (out) await page.screenshot({ path: path.join(out, 'rt-settings-integrations.png'), fullPage: true });

      await page.goto(`${BASE}/ai/orders`);
      await page.getByRole('button', { name: /^WhatsApp/ }).click();
      await page.locator('.wa-message').first().waitFor();
      const waText = (await page.locator('.wa-list').textContent()).replace(/\s+/g, ' ');
      check('AI Orders → WhatsApp: each message and what came of it', /On AI Orders/.test(waText) && /Not text/.test(waText) && /Not an order/.test(waText) && /Read by Sarvam AI/.test(waText), waText.slice(0, 300));
      if (out) await page.screenshot({ path: path.join(out, 'rt-ai-orders-whatsapp.png'), fullPage: true });
      await page.getByRole('button', { name: /^Expected/ }).click();
      await page.locator('.suggestion', { hasText: 'ordered on WhatsApp' }).first().waitFor();
      if (out) await page.screenshot({ path: path.join(out, 'rt-ai-orders-from-whatsapp.png'), fullPage: true });

      await page.goto(`${BASE}/ai/calling`);
      await page.getByRole('heading', { name: 'AI calls are on' }).waitFor();
      await page.getByText('Tomato 50 kg instead of 40 kg').first().waitFor();
      await page.locator('.call-transcript summary', { hasText: 'Conversation (4 turns)' }).click();
      const callText = (await page.locator('main').textContent()).replace(/\s+/g, ' ');
      check('AI Calling: the calls placed, each with its outcome, summary, what was asked for and the conversation',
        ['Wants changes', 'Changes asked for', 'They want 50 kg of tomatoes', 'Will pay', 'Promised to pay on', 'Call later', 'Tomorrow after 4 pm', 'No answer', 'Busy', 'New orders to confirm', 'Agent:', 'make it 50 kg'].every((w) => callText.includes(w)),
        callText.slice(0, 300));
      const marked = page.locator('.call-row', { hasText: 'Do not call' }).first();
      check('a Do Not Call customer is marked on the list, with no AI call button', (await marked.count()) === 1 && (await marked.getByRole('button', { name: 'Call with AI' }).count()) === 0, '');
      if (out) await page.screenshot({ path: path.join(out, 'rt-ai-calling.png'), fullPage: true });
      await page.getByRole('button', { name: 'Call with AI' }).first().click();
      await page.locator('.call-preview').waitFor();
      if (out) await page.screenshot({ path: path.join(out, 'rt-ai-call-preview.png') });
      await page.keyboard.press('Escape');
      await page.locator('.call-preview').waitFor({ state: 'detached' });

      // A follow-up, from the page.
      await page.getByRole('button', { name: 'Follow-up call…' }).click();
      await page.getByLabel('Customer', { exact: true }).selectOption({ label: green.name });
      await page.getByLabel('What should the agent talk about?').fill('Ask whether they would like onions with tomorrow’s tomatoes.');
      await page.getByRole('button', { name: 'Next' }).click();
      await page.locator('.call-preview').waitFor();
      const previewText = (await page.locator('.call-preview').textContent()).replace(/\s+/g, ' ');
      if (out) await page.screenshot({ path: path.join(out, 'rt-ai-call-follow-up.png') });
      const placedBefore = seen.outbound.length;
      await page.getByRole('button', { name: 'Place the call' }).click();
      await page.locator('.call-preview').waitFor({ state: 'detached' });
      for (let i = 0; i < 20 && seen.outbound.length === placedBefore; i++) await sleep(200);
      const fromPage = seen.outbound[placedBefore];
      check('a follow-up from the page: what the agent is told is shown, then the call is placed',
        /Follow-up — Ask whether they would like onions/.test(previewText) && fromPage?.body.user_config.user_phone_number === '+919800000079' && fromPage.body.app_config.agent_variables.call_purpose === 'follow_up',
        previewText);
      await page.getByText('Calling…').first().waitFor();

      await page.goto(`${BASE}/customers?open=${anna.id}`);
      await page.getByText('Do not call', { exact: true }).first().waitFor();
      if (out) await page.screenshot({ path: path.join(out, 'rt-customer-do-not-call.png'), fullPage: true });
    } finally {
      await browser.close();
    }

    const status2 = await owner.get('/integrations');
    history = await owner.get('/ai/calls/voice');
    check('Integrations counts the week’s messages and calls', status2.whatsapp.messagesLast7Days >= 5 && status2.calls.callsLast7Days === history.length && history.length === seen.outbound.length && history.length === 6,
      JSON.stringify({ m: status2.whatsapp.messagesLast7Days, c: status2.calls.callsLast7Days, h: history.length, sent: seen.outbound.length }));
  } finally {
    server.close();
  }
  finish();
})().catch((e) => {
  console.log(results.join('\n'));
  console.error('FAILED:', e.message);
  process.exit(1);
});

function finish() {
  console.log(results.join('\n'));
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);
  process.exit(0);
}
