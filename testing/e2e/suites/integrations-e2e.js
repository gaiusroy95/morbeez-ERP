// The AI's channels to customers, end to end through the real API: WhatsApp
// order messages (Meta's webhook, verified and signed), read by Claude — or,
// when Claude fails, by simple rules — into an order suggestion on AI Orders,
// with a reply to the customer; and automated calls (Twilio) placed from AI
// Calling, answered, a key pressed, the call finished. Meta, Anthropic and
// Twilio are stand-ins this suite runs on E2E_STANDIN_URL (run.js's
// integrations chain points the API at them); nothing leaves the machine.
// Without that chain's settings it only checks that everything says it's
// not set up.
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
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const PHONE_NUMBER_ID = '1098765432';
const SAGAR_PHONE = '919800000071'; // dev placeholder numbers
const ANNA_PHONE = '+919800000072';

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

const seen = { anthropic: [], graph: [], twilio: [] };
let reading = null; // what "Claude" answers next; null → a 500
function standIn(port) {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const json = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.url.startsWith('/anthropic/v1/messages')) {
        seen.anthropic.push({ headers: req.headers, body: JSON.parse(raw || '{}') });
        if (!reading) return json(500, { type: 'error', error: { type: 'api_error', message: 'stand-in down' } });
        return json(200, {
          id: `msg_${seen.anthropic.length}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5',
          content: [{ type: 'text', text: JSON.stringify(reading) }], stop_reason: 'end_turn', stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 40 },
        });
      }
      if (req.url.startsWith('/graph/')) {
        seen.graph.push({ url: req.url, headers: req.headers, body: JSON.parse(raw || '{}') });
        return json(200, { messaging_product: 'whatsapp', messages: [{ id: `wamid.reply${seen.graph.length}` }] });
      }
      if (req.url.startsWith('/twilio/')) {
        const form = Object.fromEntries(new URLSearchParams(raw));
        form.StatusCallbackEvent = new URLSearchParams(raw).getAll('StatusCallbackEvent');
        seen.twilio.push({ url: req.url, headers: req.headers, form });
        return json(201, { sid: `CA${String(seen.twilio.length).padStart(32, '0')}`, status: 'queued' });
      }
      json(404, {});
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

// ---- Meta's and Twilio's side ----

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
async function twilio(path, params, token = TWILIO_TOKEN) {
  const url = `${API}${path}`;
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  const signature = createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signature }, body: new URLSearchParams(params) });
  return { status: r.status, text: await r.text() };
}

(async () => {
  const owner = client(await login('owner@dev.morbeez.local'));
  const status = await owner.get('/integrations');

  if (!STANDIN || !APP_SECRET || !TWILIO_TOKEN) {
    // Not the integrations chain: nothing is set up, and each part says so.
    check('nothing is set up without keys', !status.whatsapp.receives && !status.calls.ready, JSON.stringify(status.whatsapp));
    const hook = await fetch(`${API}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1`);
    check('the WhatsApp webhook answers 404 when it isn’t set up', hook.status === 404, String(hook.status));
    const calls = await owner.get('/ai/calls');
    check('AI Calling says calls aren’t set up', calls.voice === 'not_set_up', calls.voice);
    return finish();
  }

  const server = await standIn(Number(new URL(STANDIN).port));
  try {
    // ---- Settings → Integrations ----
    check('the server reports WhatsApp, Claude and calls set up', status.whatsapp.receives && status.whatsapp.replies && status.reader.claude && status.calls.ready,
      JSON.stringify({ wa: status.whatsapp.receives, reply: status.whatsapp.replies, claude: status.reader.claude, calls: status.calls.ready }));
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

    // The customer whose number it is.
    const customers = (await owner.get('/customers?pageSize=100')).items;
    let sagar = customers.find((c) => c.name === 'Hotel Sagar');
    sagar = await owner.patch(`/customers/${sagar.id}`, { version: sagar.version, contact: { ...(sagar.contact ?? {}), phone: `+${SAGAR_PHONE}` } });
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

    // 1. Read by Claude: what it says is checked against the product list.
    reading = { is_order: true, delivery: 'tomorrow', lines: [{ product_id: tomato.id, quantity: 20, said: 'thakkali 20 kilo' }, { product_id: randomUUID(), quantity: 3, said: 'mango 3' }], not_understood: [] };
    const first = { from: SAGAR_PHONE, id: `wamid.${randomUUID()}`, text: 'Naale thakkali 20 kilo venam, mango 3', name: 'Sagar' };
    const delivered = await deliver([first]);
    check('a signed delivery is taken at once', delivered.status === 200 && delivered.body?.received === 1, JSON.stringify(delivered.body));
    let msg = await byProvider(first.text);
    msg = msg && (await waitFor(msg.id));
    check('Claude’s reading becomes a suggestion for Hotel Sagar', msg?.status === 'suggested' && msg.reader === 'claude' && msg.customerName === 'Hotel Sagar', JSON.stringify(msg && { s: msg.status, r: msg.reader, n: msg.note }));
    const ask = seen.anthropic[0];
    check('Claude is asked with structured output, low effort and the server-side fallback',
      ask?.body.model === 'claude-opus-5-5' && ask.body.output_config?.effort === 'low' && ask.body.output_config?.format?.type === 'json_schema' &&
        ask.body.fallbacks === 'default' && String(ask.headers['anthropic-beta']).includes('server-side-fallback-2026-07-01') &&
        (ask.headers['x-api-key'] === 'e2e-anthropic-key' || ask.headers.authorization === 'Bearer e2e-anthropic-key'),
      JSON.stringify(ask && { model: ask.body.model, effort: ask.body.output_config?.effort, fb: ask.body.fallbacks, beta: ask.headers['anthropic-beta'] }));
    check('the product list goes in the instructions; the message is the customer’s words', ask?.body.system.includes(tomato.id) && ask.body.messages[0].content.includes(first.text), '');
    const open = await owner.get('/ai/recommendations?status=open&type=order&pageSize=100');
    const rec = open.items.find((r) => r.id === msg?.recommendationId);
    check('the suggestion is a delivery order with only what’s on the product list', rec?.proposal.action === 'delivery_order' && rec.proposal.source === 'whatsapp' && rec.proposal.lines.length === 1 && rec.proposal.lines[0].productId === tomato.id && Number(rec.proposal.lines[0].quantity) === 20,
      JSON.stringify(rec?.proposal.lines));
    check('what wasn’t on the list is shown, not ordered', rec?.evidence.some((e) => e.fact === 'Not recognised' && e.value.includes('mango')), JSON.stringify(rec?.evidence.map((e) => e.fact)));
    for (let i = 0; i < 20 && seen.graph.length === 0; i++) await sleep(200);
    const reply = seen.graph[0];
    check('the customer is told on WhatsApp what was understood', reply?.url === `/graph/v23.0/${PHONE_NUMBER_ID}/messages` && reply.body.to === SAGAR_PHONE && reply.body.text.body.includes('Tomato') && reply.headers.authorization === 'Bearer e2e-access-token',
      JSON.stringify(reply && { url: reply.url, to: reply.body.to, text: reply.body.text?.body }));

    // 2. Meta delivers the same message again: it's one message.
    const before = (await owner.get('/ai/whatsapp/messages')).length;
    const again = await deliver([first]);
    check('the same message delivered twice is one message', again.status === 200 && again.body.received === 0 && (await owner.get('/ai/whatsapp/messages')).length === before, JSON.stringify(again.body));

    // 3. An owner's AI run doesn't sweep away a customer's WhatsApp order. The
    // same run works out a customer's usual order — four weeks of it on
    // tomorrow's weekday, written straight to the books — for the calls below.
    const anna = await owner.post('/customers', { name: 'Annapoorna Hotel', contact: { phone: ANNA_PHONE }, creditLimit: 100000, paymentTermsDays: 7 });
    const db = new Client({ connectionString: DB_URL });
    await db.connect();
    try {
      const today = (await owner.get('/accounting/periods')).today;
      const at = (d, n) => {
        const x = new Date(`${d}T00:00:00Z`);
        x.setUTCDate(x.getUTCDate() + n);
        return x.toISOString().slice(0, 10);
      };
      const ownerUser = (await db.query(`SELECT id, tenant_id FROM identity.app_user WHERE email = 'owner@dev.morbeez.local'`)).rows[0];
      let number = (await db.query('SELECT COALESCE(MAX(number), 0)::int AS n FROM commerce.customer_order')).rows[0].n + 1000;
      for (const n of [7, 14, 21, 28]) {
        const id = randomUUID();
        await db.query(
          `INSERT INTO commerce.customer_order (id, tenant_id, customer_id, status, created_by, number, delivery_date, created_at, updated_at)
           VALUES ($1, $2, $3, 'delivered', $4, $5, $6::date, ($6::date - 1 + time '10:00') AT TIME ZONE 'Asia/Kolkata', now())`,
          [id, ownerUser.tenant_id, anna.id, ownerUser.id, number++, at(at(today, 1), -n)],
        );
        await db.query('INSERT INTO commerce.customer_order_line (order_id, product_id, quantity, unit_price, delivered_quantity) VALUES ($1, $2, 40, 30, 40)', [id, tomato.id]);
      }
    } finally {
      await db.end();
    }
    await owner.post('/ai/runs');
    const usual = (await owner.get('/ai/recommendations?status=open&type=order&pageSize=100')).items.find((r) => r.subjectId === anna.id && r.proposal.action === 'delivery_order');
    const still = await owner.get(`/ai/recommendations/${rec.id}`);
    check('a fresh AI run leaves the WhatsApp suggestion open', !still.decision, JSON.stringify(still.decision));

    // 4. Claude down: simple rules read it, and say so.
    reading = null;
    const second = { from: SAGAR_PHONE, id: `wamid.${randomUUID()}`, text: `${tomato.name} 12 kg\n${onion.name} 5 kg` };
    await deliver([second]);
    msg = await waitFor((await byProvider(second.text))?.id);
    const rec2 = msg && (await owner.get(`/ai/recommendations/${msg.recommendationId}`));
    check('when Claude fails, simple rules read it — and the note says so', msg?.status === 'suggested' && msg.reader === 'rules' && /Claude couldn't read it/.test(msg.note ?? '') && rec2?.proposal.lines.length === 2 && rec2.confidence === 'early_estimate',
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

    // ---- Automated calls ----
    let calls = await owner.get('/ai/calls');
    check('AI Calling says calls are set up but off for this business', calls.voice === 'off', calls.voice);
    const off = await owner.raw('POST', '/ai/calls/voice', { customerId: anna.id, purpose: 'order_reminder', recommendationId: usual.id });
    check('a call isn’t placed while the business has calls off', off.status === 409, `${off.status} ${words(off)}`);
    await owner.put('/integrations/settings', { version: 1, whatsappPhoneNumberId: PHONE_NUMBER_ID, whatsappReply: true, callsEnabled: true });
    calls = await owner.get('/ai/calls');
    check('turned on, AI Calling is ready', calls.voice === 'ready', calls.voice);

    const preview = await owner.post('/ai/calls/voice/preview', { customerId: anna.id, purpose: 'order_reminder', recommendationId: usual.id });
    check('the call’s words are shown first, with the usual order in them', /40 kilos Tomato/.test(preview.text) && preview.toPhone === ANNA_PHONE && !preview.text.includes('Co..'), preview.text);
    const placed = await owner.post('/ai/calls/voice', { customerId: anna.id, purpose: 'order_reminder', recommendationId: usual.id });
    const sent = seen.twilio[0];
    check('Twilio is asked to ring the customer, calling back into this API',
      placed.status === 'queued' && sent?.url === `/twilio/2010-04-01/Accounts/AC${'0'.repeat(32)}/Calls.json` && sent.form.To === ANNA_PHONE && sent.form.From === '+10000000000' &&
        sent.form.Url === `${API}/webhooks/twilio/voice/${placed.id}` && sent.form.StatusCallbackEvent.includes('completed') &&
        sent.headers.authorization === `Basic ${Buffer.from(`AC${'0'.repeat(32)}:e2e-twilio-token`).toString('base64')}`,
      JSON.stringify(sent?.form));
    const twice = await owner.raw('POST', '/ai/calls/voice', { customerId: anna.id, purpose: 'order_reminder', recommendationId: usual.id });
    check('a second call to someone already being called is refused', twice.status === 409, `${twice.status} ${words(twice)}`);

    const base = `/webhooks/twilio/voice/${placed.id}`;
    const forgedCall = await twilio(base, { CallSid: 'CA1', CallStatus: 'in-progress' }, 'not-the-token');
    check('a callback not signed with the auth token is refused', forgedCall.status === 403, String(forgedCall.status));
    const answered = await twilio(base, { CallSid: 'CA1', CallStatus: 'in-progress' });
    check('answered, the call speaks and asks for one key', answered.status === 200 && answered.text.includes('<Gather input="dtmf" numDigits="1"') && answered.text.includes(`action="${API}${base}/keypress"`) && answered.text.includes('Tomato'),
      `${answered.status} ${answered.text.slice(0, 400)}`);
    const pressed = await twilio(`${base}/keypress`, { CallSid: 'CA1', Digits: '1' });
    check('the key is thanked for', pressed.status === 200 && pressed.text.includes('<Hangup/>'), `${pressed.status} ${pressed.text.slice(0, 120)}`);
    const done = await twilio(`${base}/status`, { CallSid: 'CA1', CallStatus: 'completed', CallDuration: '27' });
    const history = await owner.get('/ai/calls/voice');
    const call = history.find((c) => c.id === placed.id);
    check('AI Calling shows the call finished, 27 s, and that they pressed 1', done.status === 204 && call?.status === 'completed' && call.durationSeconds === 27 && call.outcome === 'confirmed' && call.digits === '1',
      JSON.stringify(call && { s: call.status, d: call.durationSeconds, o: call.outcome }));
    const late = await twilio(`${base}/status`, { CallSid: 'CA1', CallStatus: 'ringing' });
    check('a late callback doesn’t move a finished call back', late.status === 204 && (await owner.get('/ai/calls/voice')).find((c) => c.id === placed.id).status === 'completed', '');

    // A call that's answered and hung up without a key; one nobody answers.
    const second2 = await owner.post('/ai/calls/voice', { customerId: anna.id, purpose: 'order_reminder', recommendationId: usual.id });
    await twilio(`/webhooks/twilio/voice/${second2.id}`, { CallSid: 'CA2', CallStatus: 'in-progress' });
    await twilio(`/webhooks/twilio/voice/${second2.id}/status`, { CallSid: 'CA2', CallStatus: 'completed', CallDuration: '9' });
    const third = await owner.post('/ai/calls/voice', { customerId: anna.id, purpose: 'order_reminder', recommendationId: usual.id });
    await twilio(`/webhooks/twilio/voice/${third.id}/status`, { CallSid: 'CA3', CallStatus: 'no-answer' });
    const after = await owner.get('/ai/calls/voice');
    check('answered without a key: no answer to the question; not answered: no answer', after.find((c) => c.id === second2.id)?.outcome === 'no_response' && after.find((c) => c.id === third.id)?.status === 'no_answer' && !after.find((c) => c.id === third.id)?.outcome,
      JSON.stringify(after.slice(0, 3).map((c) => [c.status, c.outcome])));

    const asked = await owner.raw('POST', '/ai/calls/voice', { customerId: sagar.id, purpose: 'order_reminder', recommendationId: rec.id });
    check('no call asks for an order the customer sent on WhatsApp', asked.status === 400 && /WhatsApp already/.test(words(asked)), `${asked.status} ${words(asked)}`);
    calls = await owner.get('/ai/calls');
    check('AI Calling asks only for the usual order that hasn’t come — not the ones sent on WhatsApp', calls.calls.filter((c) => c.kind === 'order').length === 1 && calls.calls.some((c) => c.kind === 'order' && c.customerId === anna.id),
      JSON.stringify(calls.calls.map((c) => [c.kind, c.name])));
    const wrongKind = await owner.raw('POST', '/ai/calls/voice', { customerId: anna.id, purpose: 'order_confirm', recommendationId: usual.id });
    check('a call about the wrong kind of suggestion is refused in words', wrongKind.status === 400 && words(wrongKind).length > 0, `${wrongKind.status} ${words(wrongKind)}`);
    const status2 = await owner.get('/integrations');
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
      check('Settings → Integrations: each service set up, the webhook URL to paste', /Receiving/.test(settingsText) && /Claude \(claude-opus-5-5\)/.test(settingsText) && /Can call/.test(settingsText) && settingsText.includes(`${API}/webhooks/whatsapp`),
        settingsText.slice(0, 300));
      if (out) await page.screenshot({ path: path.join(out, 'rt-settings-integrations.png'), fullPage: true });

      await page.goto(`${BASE}/ai/orders`);
      await page.getByRole('button', { name: /^WhatsApp/ }).click();
      await page.locator('.wa-message').first().waitFor();
      const waText = (await page.locator('.wa-list').textContent()).replace(/\s+/g, ' ');
      check('AI Orders → WhatsApp: each message and what came of it', /On AI Orders/.test(waText) && /Not text/.test(waText) && /Not an order/.test(waText) && /Read by Claude/.test(waText), waText.slice(0, 300));
      if (out) await page.screenshot({ path: path.join(out, 'rt-ai-orders-whatsapp.png'), fullPage: true });
      await page.getByRole('button', { name: /^Expected/ }).click();
      await page.locator('.suggestion', { hasText: 'ordered on WhatsApp' }).first().waitFor();
      if (out) await page.screenshot({ path: path.join(out, 'rt-ai-orders-from-whatsapp.png'), fullPage: true });

      await page.goto(`${BASE}/ai/calling`);
      await page.getByRole('heading', { name: 'Automated calls are on' }).waitFor();
      await page.getByText('Pressed 1 — send the usual order').first().waitFor();
      const callText = (await page.locator('main').textContent()).replace(/\s+/g, ' ');
      check('AI Calling: calls on; the calls placed, with what was pressed', /Call automatically/.test(callText) && /Answered, pressed nothing/.test(callText) && /No answer/.test(callText), callText.slice(0, 300));
      if (out) await page.screenshot({ path: path.join(out, 'rt-ai-calling.png'), fullPage: true });
      await page.getByRole('button', { name: 'Call automatically' }).first().click();
      await page.locator('.call-preview').waitFor();
      if (out) await page.screenshot({ path: path.join(out, 'rt-ai-call-preview.png') });
    } finally {
      await browser.close();
    }

    check('Integrations counts the week’s messages and calls', status2.whatsapp.messagesLast7Days >= 5 && status2.calls.callsLast7Days === 3, JSON.stringify({ m: status2.whatsapp.messagesLast7Days, c: status2.calls.callsLast7Days }));
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
