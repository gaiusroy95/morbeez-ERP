// Driver app V1, Phase D9 — driver–owner chat (docs/redesign/driver-app-v1-plan.md;
// the client's answer 9). One conversation per driver with the business: the
// driver writes from the phone — perhaps offline, sent later with its own id
// and the time it was written, once however often it's sent — perhaps about a
// trip, perhaps with a photo that follows the message. Whoever plans trips
// reads every driver's conversation and replies; what's unread is counted per
// reader, in both apps. The owner app shows the drivers, one conversation, a
// reply with a photo, and the menu's unread count. Runs after the D7 suite
// (the dev driver's trips) in the redesign chain.
const { API, BASE, DB_URL, PASSWORD, launchBrowser } = require('../lib/env');
const { Client } = require('pg');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { randomUUID } = require('crypto');

const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`);

const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');

async function login(login) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password: PASSWORD }) });
  return (await r.json()).accessToken;
}
function client(token) {
  const call = async (method, path, body) => {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: r.status, body: parsed, type: r.headers.get('content-type') };
  };
  const ok = async (method, path, body) => {
    const r = await call(method, path, body);
    if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const upload = async (path, bytes = JPEG, type = 'image/jpeg') => {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type }), type === 'image/jpeg' ? 'photo.jpg' : 'file.pdf');
    const r = await fetch(`${API}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const bytes = async (path) => {
    const r = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
    return { status: r.status, type: r.headers.get('content-type'), size: (await r.arrayBuffer()).byteLength };
  };
  return { raw: call, get: (p) => ok('GET', p), post: (p, b = {}) => ok('POST', p, b), upload, bytes };
}
const message = (r) => r.body?.error?.message ?? '';
const minutesAgo = (n) => new Date(Date.now() - n * 60_000).toISOString();

(async () => {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  try {
    const owner = client(await login('owner@dev.morbeez.local'));
    const driver = client(await login('driver@dev.morbeez.local'));
    const raju = (await owner.get('/workforce?pageSize=100')).items.find((w) => w.name === 'Raju Driver');
    if (!raju) throw new Error('run the driver-app suites first (the dev driver)');
    const rajuId = raju.employeeId ?? raju.id;
    const trip = (await db.query('SELECT id, number FROM fulfilment.trip WHERE driver_employee_id = $1 ORDER BY created_at DESC LIMIT 1', [rajuId])).rows[0];
    if (!trip) throw new Error('run the driver-app suites first (the dev driver’s trips)');

    // ---- The driver writes ----
    const empty = await driver.get('/chat/mine');
    check('the driver has one conversation with the office — nothing in it yet', empty.driver.employeeId === rajuId && empty.messages.length === 0 && empty.unread === 0, JSON.stringify({ n: empty.messages.length, unread: empty.unread }));

    const m1 = randomUUID();
    const writtenAt = minutesAgo(12);
    const first = await driver.post('/chat/mine', { id: m1, body: '  Reached the depot.  ', writtenAt });
    check(
      'written offline, it arrives later with its own id and when it was written',
      first.id === m1 && first.side === 'driver' && first.body === 'Reached the depot.' && new Date(first.writtenAt).getTime() === new Date(writtenAt).getTime() && first.photo === 'none' && first.senderName === 'Raju Driver',
      JSON.stringify(first),
    );
    check('never where its photo is kept, or who sent it by id', !('photoKey' in first) && !('senderUserId' in first), Object.keys(first).join(','));
    const resent = await driver.raw('POST', '/chat/mine', { id: m1, body: 'Reached the depot.', writtenAt });
    const copies = (await db.query('SELECT count(*)::int AS n FROM chat.message WHERE id = $1', [m1])).rows[0].n;
    check('sent again from a phone that wasn’t sure it went: the same message, once', resent.status < 300 && resent.body.id === m1 && copies === 1, `${resent.status} ${copies}`);
    const clash = await driver.raw('POST', '/chat/mine', { id: m1, body: 'Something else' });
    check('the same id saying something else is refused', clash.status === 409, `${clash.status} ${message(clash)}`);

    const ahead = await driver.post('/chat/mine', { id: randomUUID(), body: 'Phone clock ahead', writtenAt: '2099-01-01T00:00:00Z' });
    check('a phone clock ahead never dates a message in the future', new Date(ahead.writtenAt).getTime() <= Date.now() + 1000, ahead.writtenAt);
    const blank = await driver.raw('POST', '/chat/mine', { id: randomUUID(), body: '   ' });
    const long = await driver.raw('POST', '/chat/mine', { id: randomUUID(), body: 'x'.repeat(2001) });
    check('something to say (up to 2,000 characters), or a photo', blank.status === 400 && long.status === 400, `${blank.status} ${long.status}`);

    const about = await driver.post('/chat/mine', { id: randomUUID(), body: 'Loading at the farm now.', tripId: trip.id });
    const notTheirs = await driver.raw('POST', '/chat/mine', { id: randomUUID(), body: 'Wrong trip', tripId: randomUUID() });
    check('about one of the driver’s trips — named by its number; no other trip', about.tripId === trip.id && about.tripNumber === trip.number && notTheirs.status === 400, `${about.tripNumber} ${notTheirs.status} ${message(notTheirs)}`);

    // ---- A photo follows its message ----
    const m3 = randomUUID();
    const withPhoto = await driver.post('/chat/mine', { id: m3, body: 'Crates — 3 broken.', tripId: trip.id, photo: true });
    check('a photo message is there before its photo — "on its way"', withPhoto.photo === 'pending', withPhoto.photo);
    const byOwner = await owner.upload(`/chat/messages/${m3}/photo`);
    check('only who sent the message sends its photo', byOwner.status === 403, String(byOwner.status));
    const pdf = await driver.upload(`/chat/messages/${m3}/photo`, Buffer.from('%PDF-1.4'), 'application/pdf');
    check('a photo — not a document', pdf.status === 400, String(pdf.status));
    const attached = await driver.upload(`/chat/messages/${m3}/photo`);
    const twice = await driver.upload(`/chat/messages/${m3}/photo`);
    const keys = (await db.query('SELECT photo_key FROM chat.message WHERE id = $1', [m3])).rows[0].photo_key;
    check('sent, it’s ready; sent again, it’s the same photo', attached.status < 300 && attached.body.photo === 'ready' && twice.status < 300 && !!keys, `${attached.status} ${attached.body?.photo} ${twice.status}`);
    const none = await driver.upload(`/chat/messages/${m1}/photo`);
    check('a message that said no photo takes none', none.status === 409, String(none.status));
    const seen = await owner.bytes(`/chat/messages/${m3}/photo`);
    check('the office sees the photo', seen.status === 200 && seen.type === 'image/jpeg' && seen.size === JPEG.length, `${seen.status} ${seen.type} ${seen.size}`);

    // ---- The office reads every driver's ----
    const officeOnly = await driver.raw('GET', '/chat/conversations');
    check('a driver reads only their own conversation', officeOnly.status === 403, String(officeOnly.status));
    const unreadBefore = (await owner.get('/chat/unread')).unread;
    const list = await owner.get('/chat/conversations');
    const row = list.find((c) => c.employeeId === rajuId);
    check(
      'the drivers, the last word first — what this owner hasn’t read, and the trip a driver is on',
      row && row.unread === 4 && unreadBefore >= 4 && row.last?.side === 'driver' && row.last?.photo === true && list[0].employeeId === rajuId,
      JSON.stringify({ unread: row?.unread, total: unreadBefore, last: row?.last }),
    );
    const thread = await owner.get(`/chat/conversations/${rajuId}`);
    const order = thread.messages.map((m) => m.id);
    check('in the order they were written — the offline one first', order[0] === m1 && thread.messages.length === 4 && thread.unread === 4, `${order.length} ${thread.unread}`);
    const latest = thread.messages.map((m) => m.createdAt).sort().at(-1);
    await owner.post(`/chat/conversations/${rajuId}/read`, { upTo: latest });
    const afterRead = await owner.get('/chat/unread');
    const back = await owner.post(`/chat/conversations/${rajuId}/read`, { upTo: minutesAgo(600) });
    check('opened, it’s read — and a read mark never goes back', afterRead.unread === unreadBefore - 4 && new Date(back.readAt).getTime() >= new Date(latest).getTime(), `${afterRead.unread} ${back.readAt}`);

    // ---- The office replies ----
    const reply = await owner.post(`/chat/conversations/${rajuId}`, { id: randomUUID(), body: 'Note it on the delivery, please.', tripId: trip.id });
    // The dev owner has no worker record: signed with the business's name, never a login.
    check('the office replies — about the trip, signed by who wrote it', reply.side === 'office' && reply.tripNumber === trip.number && reply.senderName === 'Dev Wholesaler Co.', `${reply.side} ${reply.senderName}`);
    const mine = await driver.get('/chat/mine');
    check('the driver sees it unread', mine.unread === 1 && mine.messages.at(-1).side === 'office', String(mine.unread));
    await driver.post('/chat/mine/read', { upTo: mine.messages.at(-1).createdAt });
    check('…and reads it', (await driver.get('/chat/mine')).unread === 0);
    const officeAfterReply = (await owner.get('/chat/conversations')).find((c) => c.employeeId === rajuId);
    check('writing is reading: the office’s own reply leaves nothing unread', officeAfterReply.unread === 0, String(officeAfterReply.unread));

    // A new word from the road, for the menu's count.
    await driver.post('/chat/mine', { id: randomUUID(), body: 'Hotel Sagar is closed — leave the eggs next door?', tripId: trip.id });

    // ---- The owner app ----
    const out = process.env.E2E_SCREENSHOTS;
    const photoFile = path.join(os.tmpdir(), `d9-slip-${Date.now()}.jpg`);
    fs.writeFileSync(photoFile, JPEG);
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
      await page.goto(`${BASE}/login`);
      await page.fill('#login', 'owner@dev.morbeez.local');
      await page.fill('#password', PASSWORD);
      await page.click('button[type=submit]');
      await page.waitForURL((u) => !/\/login/.test(u.toString()));
      const navChat = page.locator('a.nav-link[href="/chat"]');
      await navChat.locator('.nav-badge').waitFor();
      check('the menu counts what the drivers wrote that this owner hasn’t read', (await navChat.locator('.nav-badge').textContent()).trim() === '1', await navChat.textContent());

      await page.goto(`${BASE}/logistics?open=${trip.id}`);
      const link = page.getByRole('link', { name: 'Message the driver' });
      await link.waitFor();
      check('a trip opens its driver’s conversation, about it', (await link.getAttribute('href')) === `/chat?driver=${rajuId}&trip=${trip.id}`, await link.getAttribute('href'));
      await link.click();
      await page.waitForURL(/\/chat\?driver=/);
      await page.locator('.chat-bubble').first().waitFor();
      const bubbles = await page.locator('.chat-bubble').count();
      const ownSide = await page.locator('.chat-bubble[data-side="office"]').count();
      await page.waitForFunction(() => document.querySelectorAll('.chat-photo').length > 0 && [...document.querySelectorAll('.chat-photo')].every((i) => i.complete && i.naturalWidth > 0));
      check('one conversation: the driver’s on the left, the office’s on the right, the photo shown', bubbles === 6 && ownSide === 1, `${bubbles} ${ownSide}`);
      await page.waitForFunction(() => !document.querySelector('a.nav-link[href="/chat"] .nav-badge'));
      check('opened, the menu’s count clears', (await navChat.locator('.nav-badge').count()) === 0);
      const aboutValue = await page.locator('.chat-about select').inputValue();
      check('a reply from a trip is about that trip', aboutValue === trip.id, aboutValue);
      if (out) await page.screenshot({ path: path.join(out, 'd9-owner-chat.png') });

      await page.getByRole('textbox', { name: 'Message' }).fill('Yes, leave them with the shop next door. Here’s the slip.');
      await page.locator('.chat-photo-button input[type=file]').setInputFiles(photoFile);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll('.chat-bubble[data-side="office"]').length === 2 && document.querySelectorAll('.chat-photo').length === 2);
      const sent = await driver.get('/chat/mine');
      const last = sent.messages.at(-1);
      check('the owner app replies with a photo — the driver has both', last.side === 'office' && last.body.startsWith('Yes, leave them') && last.photo === 'ready' && last.tripId === trip.id && sent.unread === 1, `${last.photo} ${last.tripNumber} ${sent.unread}`);
      if (out) await page.screenshot({ path: path.join(out, 'd9-owner-chat-reply.png') });

      await page.goto(`${BASE}/chat`);
      await page.locator('.chat-row').first().waitFor();
      const rowText = (await page.locator('.chat-row').first().textContent()).replace(/\s+/g, ' ');
      check('the drivers’ list: who, the trip they’re on, the last word', /Raju Driver/.test(rowText) && /You: Yes, leave them/.test(rowText), rowText);

      const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
      await phone.goto(`${BASE}/login`);
      await phone.fill('#login', 'owner@dev.morbeez.local');
      await phone.fill('#password', PASSWORD);
      await phone.click('button[type=submit]');
      await phone.waitForURL((u) => !/\/login/.test(u.toString()));
      await phone.goto(`${BASE}/chat?driver=${rajuId}`);
      await phone.locator('.chat-bubble').first().waitFor();
      const listHidden = !(await phone.locator('.chat-list').isVisible());
      check('on a phone, one conversation at a time — with a way back to the drivers', listHidden && (await phone.locator('.chat-back').isVisible()));
      if (out) await phone.screenshot({ path: path.join(out, 'd9-owner-chat-phone.png') });
    } finally {
      await browser.close();
      fs.rmSync(photoFile, { force: true });
    }
  } finally {
    await db.end();
  }
  console.log(results.join('\n'));
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);
})().catch((e) => {
  console.log(results.join('\n'));
  console.error('FAILED:', e.message);
  process.exit(1);
});
