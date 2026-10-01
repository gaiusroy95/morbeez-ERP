// Phone signup, phone sign-in and the free trial, end to end: a business
// signs itself up in the browser with a mobile number and lands on a
// 30-day trial; its owner signs in again however the number is typed; a
// number can't sign up twice; and once a trial is over the business can
// still read everything but change nothing. The superuser connection only
// moves a trial's end into the past.
const { API, BASE, DB_URL, launchBrowser } = require('../lib/env');
const { Client } = require('pg');

const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);

// A fresh mobile number each run: 9 then nine random digits.
const phoneNumber = () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
const PASSWORD = 'a-long-signup-password-1';

async function api(method, path, token, body) {
  const r = await fetch(`${API}/${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

(async () => {
  const browser = await launchBrowser();
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  try {
    // ---- Signup in the browser ----
    const phone = phoneNumber();
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage();
    await page.goto(`${BASE}/login`);
    await page.getByRole('link', { name: 'Start your free month' }).click();
    await page.waitForURL(/\/signup/);
    await page.fill('#business', 'Trial Greens');
    await page.fill('#phone', `${phone.slice(0, 5)} ${phone.slice(5)}`);
    await page.fill('#password', PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL(/\/dashboard/);
    check('a business signs up with a mobile number and lands signed in', true);
    const banner = await page.waitForSelector('.trial-banner', { timeout: 15000 }).then((el) => el.innerText());
    check('it starts on a 30-day free trial', /30 days left/.test(banner), banner);

    // ---- Phone sign-in, typed any common way ----
    for (const typed of [`+91 ${phone}`, `0${phone}`, `${phone.slice(0, 5)}-${phone.slice(5)}`]) {
      const r = await api('POST', 'auth/login', null, { login: typed, password: PASSWORD });
      check(`signs in as "${typed}"`, r.status === 200 && !!r.body.accessToken, String(r.status));
    }
    const wrong = await api('POST', 'auth/login', null, { login: phone, password: 'not-the-password-0' });
    check('a wrong password is a plain 401', wrong.status === 401 && /mobile number or password/.test(wrong.body?.error?.message), wrong.body?.error?.message);

    // ---- The same number can't sign up twice ----
    const again = await api('POST', 'tenants', null, { businessName: 'Copycat', ownerPhone: phone, ownerPassword: PASSWORD });
    check('a number with a login can not sign up again', again.status === 409 && /mobile number already has/.test(again.body?.error?.message), again.body?.error?.message);
    const bad = await api('POST', 'tenants', null, { businessName: 'Bad Number', ownerPhone: '12345', ownerPassword: PASSWORD });
    check('a number that is not an Indian mobile is refused', bad.status === 400, String(bad.status));

    // ---- Trial over: read-only ----
    // A second business, expired before anything has asked about its trial
    // (the API caches that answer for a minute).
    const late = phoneNumber();
    const made = await api('POST', 'tenants', null, { businessName: 'Late Payers', ownerPhone: late, ownerPassword: PASSWORD });
    const token = made.body?.accessToken;
    const tenantId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).tenantId;
    await db.query(`UPDATE tenant.tenant SET trial_ends_at = now() - interval '1 day' WHERE id = $1`, [tenantId]);

    const access = await api('GET', 'tenants/me/access', token);
    check('an unpaid trial that is over reads as ended', access.body?.state === 'ended', JSON.stringify(access.body));
    const read = await api('GET', 'customers', token);
    check('reads still work', read.status === 200, String(read.status));
    const write = await api('POST', 'customers', token, { name: 'Hotel Blocked', creditLimit: 0, paymentTermsDays: 0 });
    check('writes get a 402 that says why', write.status === 402 && /free trial has ended/.test(write.body?.error?.message), `${write.status} ${write.body?.error?.message}`);

    const late2 = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    await late2.goto(`${BASE}/login`);
    await late2.fill('#login', late);
    await late2.fill('#password', PASSWORD);
    await late2.click('button[type=submit]');
    await late2.waitForURL(/\/dashboard/);
    const ended = await late2.waitForSelector('.trial-banner[data-tone="ended"]', { timeout: 15000 }).then((el) => el.innerText());
    check('the owner app says the trial has ended', /free trial has ended/.test(ended), ended);
    await late2.getByRole('link', { name: 'Subscribe' }).click();
    await late2.waitForSelector('#plan');
    check('Subscribe leads to the plan on "Your account"', /ended on/.test(await late2.locator('#plan').innerText()));

  } finally {
    await db.end();
    await browser.close();
  }
  console.log(results.join('\n'));
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
})().catch((e) => {
  console.log(results.join('\n'));
  console.error('FAILED:', e.message);
  process.exit(1);
});
