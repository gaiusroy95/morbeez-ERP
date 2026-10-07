// Languages (client Q&A: English, Malayalam, Kannada, Tamil, chosen per
// user; each customer's own language for statements and messages; tax
// invoices stay English). The user's choice through the API, a customer's
// preferred language, and the owner app following the choice from the
// sign-in screen through to another browser.
const { API, BASE, PASSWORD, launchBrowser } = require('../lib/env');

const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`);
const OWNER = '+919800000001';

async function login(login) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password: PASSWORD }) });
  return (await r.json()).accessToken;
}

function client(token) {
  return async (method, path, body) => {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
}

async function signIn(browser, cookieLang) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  if (cookieLang) await ctx.addCookies([{ name: 'mz_lang', value: cookieLang, url: BASE }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  const heading = (await page.locator('h1, h2').filter({ hasText: /\S/ }).allInnerTexts()).join(' | ');
  await page.fill('#login', OWNER);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !/\/login/.test(u.toString()));
  await page.waitForSelector('.page-title');
  return { ctx, page, heading };
}

(async () => {
  const call = client(await login(OWNER));
  const stamp = Date.now().toString(36);

  // ---- The user's own language ----
  const set = await call('PATCH', '/users/me/preferences', { language: 'kn' });
  const got = await call('GET', '/users/me/preferences');
  check('the owner chooses Kannada and it sticks', set.status === 200 && got.body.language === 'kn', JSON.stringify(got.body));
  const bad = await call('PATCH', '/users/me/preferences', { language: 'fr' });
  check('a language outside en/ml/kn/ta is refused', bad.status === 400, String(bad.status));

  // ---- A customer's preferred language ----
  const created = await call('POST', '/customers', { name: `Lang ${stamp}`, preferredLanguage: 'ml' });
  check('a new customer keeps Malayalam', created.status === 201 && created.body.preferredLanguage === 'ml', `${created.status} ${created.body?.preferredLanguage}`);
  const plain = await call('POST', '/customers', { name: `Plain ${stamp}` });
  check('without a choice a customer is English', plain.body?.preferredLanguage === 'en', plain.body?.preferredLanguage);
  const updated = await call('PATCH', `/customers/${created.body.id}`, { version: created.body.version, preferredLanguage: 'ta' });
  check('the owner changes it to Tamil', updated.status === 200 && updated.body.preferredLanguage === 'ta', `${updated.status} ${updated.body?.preferredLanguage}`);
  const wrong = await call('PATCH', `/customers/${created.body.id}`, { version: updated.body.version, preferredLanguage: 'hi' });
  check('an unsupported customer language is refused', wrong.status === 400, String(wrong.status));
  const read = await call('GET', `/customers/${created.body.id}`);
  check('reading the customer back shows Tamil', read.body.preferredLanguage === 'ta', read.body.preferredLanguage);

  // ---- The owner app ----
  const browser = await launchBrowser();
  try {
    // Chosen on the sign-in screen (cookie), it becomes the account's choice.
    const ml = await signIn(browser, 'ml');
    check('the sign-in screen speaks Malayalam', /വീണ്ടും സ്വാഗതം/.test(ml.heading), ml.heading);
    check('…and so does the app after signing in', (await ml.page.evaluate(() => document.documentElement.lang)) === 'ml-IN');
    check('the dashboard title is translated', (await ml.page.locator('.page-title').innerText()).includes('ഡാഷ്ബോർഡ്'));
    const after = await call('GET', '/users/me/preferences');
    check('signing in in Malayalam saved it to the account', after.body.language === 'ml', after.body.language);
    await ml.ctx.close();

    // Another browser with no choice of its own follows the account.
    const fresh = await signIn(browser, null);
    check('a new browser shows English before sign-in', /Welcome back/.test(fresh.heading), fresh.heading);
    check('…and the account\'s Malayalam once signed in', (await fresh.page.evaluate(() => document.documentElement.lang)) === 'ml-IN');

    // Switching from the top bar.
    await fresh.page.selectOption('.lang-switch select, select.lang-switch', 'ta');
    await fresh.page.waitForFunction(() => document.documentElement.lang === 'ta-IN');
    await fresh.page.waitForTimeout(500);
    const switched = await call('GET', '/users/me/preferences');
    check('switching to Tamil in the top bar saves it', switched.body.language === 'ta', switched.body.language);
    await fresh.page.goto(`${BASE}/customers`);
    await fresh.page.waitForSelector('.page-title');
    check('…and the next page is Tamil', (await fresh.page.locator('.page-title').innerText()).includes('வாடிக்கையாளர்கள்'));
    await fresh.ctx.close();
  } finally {
    await browser.close();
    // Leave the seeded owner in English for the other suites.
    await call('PATCH', '/users/me/preferences', { language: 'en' });
  }

  console.log(results.join('\n'));
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
})().catch((e) => {
  console.log(results.join('\n'));
  console.error('FAILED:', e.message);
  process.exit(1);
});
