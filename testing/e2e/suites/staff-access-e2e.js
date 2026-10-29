// Adding a worker properly (client feedback, Oct 2026): phone and address
// when adding, ID documents kept with them, and an app login given by a
// one-time password set-up link instead of a password the owner invents.
// Two businesses sign themselves up; the second checks it can see none of
// the first's documents. The superuser connection only backdates a link.
const { API, BASE, DB_URL, launchBrowser } = require('../lib/env');
const { Client } = require('pg');

const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`);
const phoneNumber = () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
const OWNER_PASSWORD = 'a-long-owner-password-1';
const DRIVER_PASSWORD = 'drivers-own-password-1';

// A 1×1 PNG and a tiny PDF.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

async function api(method, path, token, body) {
  const r = await fetch(`${API}/${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: r.status, body: json, type: r.headers.get('content-type'), raw: text };
}

async function upload(path, token, fields, file, name, type) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('file', new Blob([file], { type }), name);
  const r = await fetch(`${API}/${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function signUp(name) {
  const phone = phoneNumber();
  const r = await api('POST', 'tenants', null, { businessName: name, ownerPhone: phone, ownerPassword: OWNER_PASSWORD });
  if (r.status !== 201) throw new Error(`signup ${r.status} ${JSON.stringify(r.body)}`);
  return { phone, token: r.body.accessToken };
}

const tokenOf = (link) => new URL(link).searchParams.get('token');

(async () => {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const browser = await launchBrowser();
  try {
    const owner = await signUp('Staff Test Traders');

    // ---- Adding a worker with details ----
    const driverPhone = phoneNumber();
    const added = await api('POST', 'workforce/workers', owner.token, {
      name: 'Ravi Kumar',
      roleType: 'driver',
      phone: `${driverPhone.slice(0, 5)} ${driverPhone.slice(5)}`,
      address: '12, Market Road, Kolar',
    });
    check('a worker is added with phone and address in one step', added.status === 201 && added.body.phone && added.body.address === '12, Market Road, Kolar', added.status);
    const ravi = added.body;
    check('a new driver has no login yet', ravi.hasLogin === false && ravi.login === null);

    // ---- Login by link ----
    const first = await api('POST', `workforce/workers/${ravi.employeeId}/login-link`, owner.token, {});
    check('a login link is made from the number on their profile', first.status === 200 && first.body.created === true && first.body.login === `+91${driverPhone}`, `${first.status} ${first.body?.login}`);
    check('the link points at the owner app\'s set-password page', /\/set-password\?token=[A-Za-z0-9_-]{40,}$/.test(first.body.link), first.body.link);
    const worker = (await api('GET', `workforce/workers/${ravi.employeeId}`, owner.token)).body;
    check('the worker now shows their app login', worker.hasLogin === true && worker.login === `+91${driverPhone}`);

    const before = await api('POST', 'auth/login', null, { login: driverPhone, password: 'guess-the-password-1' });
    check('nobody can sign in before a password is chosen', before.status === 401, before.status);

    const second = await api('POST', `workforce/workers/${ravi.employeeId}/login-link`, owner.token, {});
    check('asking again gives a new link for the same login', second.status === 200 && second.body.created === false && second.body.link !== first.body.link);
    const old = await api('GET', `auth/password-setup/${tokenOf(first.body.link)}`);
    check('the earlier link stops working', old.status === 200 && old.body.state === 'used', old.body?.state);
    const info = await api('GET', `auth/password-setup/${tokenOf(second.body.link)}`);
    check('the link names the business and the worker, and hides most of the number', info.body.state === 'valid' && info.body.business === 'Staff Test Traders' && info.body.name === 'Ravi Kumar' && /^\+91 \d{2}•+\d{3}$/.test(info.body.login), JSON.stringify(info.body));
    const unknown = await api('GET', `auth/password-setup/${'x'.repeat(43)}`);
    check('a made-up link is refused', unknown.status === 404, unknown.status);

    const short = await api('POST', 'auth/password-setup', null, { token: tokenOf(second.body.link), password: 'short' });
    check('a short password is refused', short.status === 400, short.status);

    // ---- The set-password page in the browser ----
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage();
    await page.goto(second.body.link.replace(/^https?:\/\/[^/]+/, BASE));
    await page.getByRole('heading', { name: 'Hello Ravi Kumar' }).waitFor({ timeout: 15000 });
    check('the set-password page opens without signing in, and greets the worker', true);
    await page.fill('#password', DRIVER_PASSWORD);
    await page.fill('#again', 'something-else-entirely');
    await page.getByRole('button', { name: 'Set password' }).click();
    check('mismatched passwords are caught on the page', await page.getByText("The new passwords don't match.").isVisible());
    await page.fill('#again', DRIVER_PASSWORD);
    await page.getByRole('button', { name: 'Set password' }).click();
    await page.getByRole('heading', { name: 'Your password is set' }).waitFor({ timeout: 15000 });
    check('the page confirms and says how to sign in', await page.getByText(/tap Driver, and sign in with/).isVisible());

    const reuse = await api('POST', 'auth/password-setup', null, { token: tokenOf(second.body.link), password: 'another-password-12' });
    check('a used link can\'t set the password again', reuse.status === 410, reuse.status);

    const login = await api('POST', 'auth/login', null, { login: driverPhone, password: DRIVER_PASSWORD });
    check('the worker signs in with their number and chosen password', login.status === 200 && !!login.body.accessToken, login.status);
    const driver = login.body.accessToken;
    const mine = await api('GET', 'logistics/trips/mine', driver);
    check("they see the Driver app's route list", mine.status === 200, mine.status);
    const finance = await api('GET', 'finance/receivables', driver);
    check("they can't see the business's money", finance.status === 403, finance.status);
    const workers = await api('GET', 'workforce/workers', driver);
    check("they can't see other workers", workers.status === 403, workers.status);

    // An expired link.
    const third = await api('POST', `workforce/workers/${ravi.employeeId}/login-link`, owner.token, {});
    await db.query("UPDATE identity.password_setup SET expires_at = now() - interval '1 minute' WHERE used_at IS NULL");
    const expired = await api('POST', 'auth/password-setup', null, { token: tokenOf(third.body.link), password: 'too-late-password-1' });
    check('an expired link is refused', expired.status === 410 && /expired/.test(expired.body?.error?.message), expired.body?.error?.message);
    const stillWorks = await api('POST', 'auth/login', null, { login: driverPhone, password: DRIVER_PASSWORD });
    check('their password still works after an unused new link', stillWorks.status === 200);

    // ---- Refusals ----
    const helper = (await api('POST', 'workforce/workers', owner.token, { name: 'Shop Helper', roleType: 'warehouse' })).body;
    const helperLink = await api('POST', `workforce/workers/${helper.employeeId}/login-link`, owner.token, { phone: phoneNumber() });
    check('app logins are for drivers for now', helperLink.status === 400, helperLink.body?.error?.message);
    const noPhone = (await api('POST', 'workforce/workers', owner.token, { name: 'No Phone Driver', roleType: 'driver' })).body;
    const missing = await api('POST', `workforce/workers/${noPhone.employeeId}/login-link`, owner.token, {});
    check('a login needs a mobile number', missing.status === 400, missing.body?.error?.message);
    const taken = await api('POST', `workforce/workers/${noPhone.employeeId}/login-link`, owner.token, { phone: driverPhone });
    check('a number that already has a login is refused, and nothing half-made stays', taken.status === 409, taken.body?.error?.message);
    const after = (await api('GET', `workforce/workers/${noPhone.employeeId}`, owner.token)).body;
    check('…the worker still has no login', after.hasLogin === false);

    // ---- Documents ----
    const aadhaar = await upload(`workforce/workers/${ravi.employeeId}/documents`, owner.token, { kind: 'aadhaar', label: 'XXXX XXXX 1234' }, PNG, 'aadhaar.png', 'image/png');
    check('a photo of the Aadhaar card is attached', aadhaar.status === 201 && aadhaar.body.kind === 'aadhaar', aadhaar.status);
    const licence = await upload(`workforce/workers/${ravi.employeeId}/documents`, owner.token, { kind: 'driving_licence' }, PDF, 'licence.pdf', 'application/pdf');
    check('a PDF of the licence is attached', licence.status === 201);
    const wrong = await upload(`workforce/workers/${ravi.employeeId}/documents`, owner.token, { kind: 'other' }, Buffer.from('hello'), 'note.txt', 'text/plain');
    check('other file types are refused', wrong.status === 400, wrong.body?.error?.message);
    const badKind = await upload(`workforce/workers/${ravi.employeeId}/documents`, owner.token, { kind: 'passport' }, PNG, 'p.png', 'image/png');
    check('an unknown document kind is refused', badKind.status === 400);
    const listed = (await api('GET', `workforce/workers/${ravi.employeeId}`, owner.token)).body.documents;
    check('both documents are listed on the worker', listed.length === 2, listed.length);
    const file = await fetch(`${API}/workforce/workers/${ravi.employeeId}/documents/${aadhaar.body.id}/file`, { headers: { authorization: `Bearer ${owner.token}` } });
    const bytes = Buffer.from(await file.arrayBuffer());
    check('the document opens as the same file', file.status === 200 && file.headers.get('content-type') === 'image/png' && bytes.equals(PNG), file.status);
    const asDriver = await api('GET', `workforce/workers/${ravi.employeeId}/documents/${aadhaar.body.id}/file`, driver);
    check("a driver can't open workers' documents", asDriver.status === 403, asDriver.status);

    const other = await signUp('Another Business');
    const peek = await api('GET', `workforce/workers/${ravi.employeeId}/documents/${aadhaar.body.id}/file`, other.token);
    check("another business can't open them", peek.status === 404, peek.status);
    const peekLink = await api('POST', `workforce/workers/${ravi.employeeId}/login-link`, other.token, {});
    check("…nor make links for this business's workers", peekLink.status === 404, peekLink.status);

    const removed = await api('POST', `workforce/workers/${ravi.employeeId}/documents/${licence.body.id}/remove`, owner.token);
    check('a document is removed from the worker', removed.status === 200 && removed.body.documents.length === 1);
    const gone = await api('GET', `workforce/workers/${ravi.employeeId}/documents/${licence.body.id}/file`, owner.token);
    check('…and no longer opens', gone.status === 404);
    const record = await db.query('SELECT removed_at IS NOT NULL AS removed FROM workforce.worker_document WHERE id = $1', [licence.body.id]);
    check('…but the record of it stays', record.rows[0]?.removed === true);

    // ---- The owner app: add a worker with a login ----
    const ownerPage = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage();
    await ownerPage.goto(`${BASE}/login`);
    await ownerPage.fill('#login', owner.phone);
    await ownerPage.fill('#password', OWNER_PASSWORD);
    await ownerPage.click('button[type=submit]');
    await ownerPage.waitForURL((u) => !/\/login/.test(u.toString()));
    await ownerPage.goto(`${BASE}/workforce`);
    await ownerPage.getByRole('button', { name: /Add a worker/ }).click();
    const dialog = ownerPage.locator('dialog[open]');
    await dialog.getByLabel('Name').fill('Mohan Das');
    const mohanPhone = phoneNumber();
    await dialog.getByLabel('Mobile number').fill(mohanPhone);
    await dialog.getByLabel('Address (optional)').fill('Near bus stand, Mulbagal');
    await dialog.getByRole('button', { name: 'Add and get login link' }).click();
    await ownerPage.getByRole('heading', { name: 'Login made for Mohan Das' }).waitFor({ timeout: 15000 });
    const shown = await ownerPage.locator('dialog[open] .link-input').inputValue();
    const wa = await ownerPage.getByRole('link', { name: 'Share on WhatsApp' }).getAttribute('href');
    check('owner app: adding a driver gives a link to send', /set-password\?token=/.test(shown), shown);
    check('owner app: Share on WhatsApp goes to their number with the link', wa.startsWith(`https://wa.me/91${mohanPhone}?text=`) && decodeURIComponent(wa).includes(shown));
  } catch (e) {
    check('flow', false, e.message.split('\n')[0]);
  } finally {
    await browser.close();
    await db.end();
  }
  console.log(results.join('\n'));
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);
})();
