// Customer onboarding (the client, 20 Nov 2026): a new customer is taken down
// with "Name, Contact person, Phone number, location: GPS coordinates, Land
// mark, Shop photo front". The contact person sits with the phone; the GPS
// position becomes the customer's map pin (route planning and the driver's
// stop read it); the landmark and the shop's front photo tell a driver which
// shop it is. Through the API, then the owner app on a phone standing at the
// shop. Makes its own data, on the seed.
const path = require('path');
const { API, BASE, DB_URL, PASSWORD, launchBrowser } = require('../lib/env');
const { Client } = require('pg');

const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`);

async function login(login) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password: PASSWORD }) });
  const body = await r.json();
  if (!body.accessToken) throw new Error(`login ${login}: ${r.status}`);
  return body.accessToken;
}

function client(token) {
  const call = async (method, p, body) => {
    const r = await fetch(`${API}${p}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  const ok = async (method, p, body) => {
    const res = await call(method, p, body);
    if (res.status >= 300) throw new Error(`${method} ${p} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  };
  const upload = async (p, buffer, type, name) => {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type }), name);
    const r = await fetch(`${API}${p}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  const bytes = async (p) => {
    const r = await fetch(`${API}${p}`, { headers: { authorization: `Bearer ${token}` } });
    return { status: r.status, type: r.headers.get('content-type'), body: Buffer.from(await r.arrayBuffer()) };
  };
  return { raw: call, get: (p) => ok('GET', p), post: (p, b = {}) => ok('POST', p, b), patch: (p, b) => ok('PATCH', p, b), upload, bytes };
}

/** A JPEG's width and height, from its frame header. */
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    const length = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + length;
  }
  return null;
}

(async () => {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const owner = client(await login('owner@dev.morbeez.local'));
  const accountant = client(await login('accountant@dev.morbeez.local'));
  const driver = client(await login('driver@dev.morbeez.local'));
  const s = Date.now().toString(36);
  const shots = process.env.E2E_SCREENSHOTS;
  const browser = await launchBrowser();

  try {
    // A real JPEG, drawn in the browser: a shop front of any size.
    const painter = await (await browser.newContext()).newPage();
    const jpeg = async (width, height, label) =>
      Buffer.from(
        (
          await painter.evaluate(
            ({ width, height, label }) => {
              const c = document.createElement('canvas');
              c.width = width;
              c.height = height;
              const g = c.getContext('2d');
              g.fillStyle = '#e8d9b5';
              g.fillRect(0, 0, width, height);
              g.fillStyle = '#1f6f3f';
              g.fillRect(0, 0, width, height * 0.22);
              g.fillStyle = '#ffffff';
              g.font = `bold ${Math.round(height * 0.12)}px sans-serif`;
              g.fillText(label, width * 0.05, height * 0.16);
              g.fillStyle = '#6b4f2a';
              g.fillRect(width * 0.3, height * 0.45, width * 0.4, height * 0.55);
              return c.toDataURL('image/jpeg', 0.9);
            },
            { width, height, label },
          )
        ).split(',')[1],
        'base64',
      );

    // ---- Through the API ----
    const c = await owner.post('/customers', {
      name: `Hotel Sagar ${s}`,
      contact: { person: '  Ravi (manager) ', phone: '+919800000081' },
      landmark: ' Opposite the bus stand ',
      latitude: 12.31081234,
      longitude: 76.6402,
    });
    check('the contact person is kept with the phone, trimmed', c.contact.person === 'Ravi (manager)' && c.contact.phone === '+919800000081', JSON.stringify(c.contact));
    check('the landmark, trimmed', c.landmark === 'Opposite the bus stand', c.landmark);
    let profile = await owner.get(`/customers/${c.id}/profile`);
    check('the GPS position is the customer’s map pin, to 6 places', profile.pin?.latitude === '12.310812' && profile.pin?.longitude === '76.640200', JSON.stringify(profile.pin));
    const pins = await owner.get('/logistics/pins');
    const pinned = pins.find((p) => p.kind === 'customer' && p.refId === c.id);
    check('…the one route planning uses', pinned?.latitude === '12.310812', JSON.stringify(pinned));

    const half = await owner.raw('POST', '/customers', { name: `Half ${s}`, latitude: 12.3 });
    check('half a location is refused', half.status === 400 && /both the latitude and the longitude/.test(half.body?.error?.message ?? ''), half.body?.error?.message);
    const zero = await owner.raw('POST', '/customers', { name: `Zero ${s}`, latitude: 0, longitude: 0 });
    check('0, 0 — a phone with no fix — is refused', zero.status === 400, String(zero.status));
    const noneMade = await db.query('SELECT count(*)::int AS n FROM trading_partners.customer WHERE name IN ($1, $2)', [`Half ${s}`, `Zero ${s}`]);
    check('…and neither customer was made', noneMade.rows[0].n === 0);

    check('no shop photo yet', c.shopPhoto === null && (await owner.bytes(`/customers/${c.id}/shop-photo`)).status === 404);
    const pdf = await owner.upload(`/customers/${c.id}/shop-photo`, Buffer.from('%PDF-1.7 not a photo'), 'image/jpeg', 'shop.jpg');
    check('a file called .jpg that is not a picture is refused', pdf.status === 400, `${pdf.status} ${pdf.body?.error?.message}`);
    const front = await jpeg(800, 600, 'HOTEL SAGAR');
    const notAllowed = await accountant.upload(`/customers/${c.id}/shop-photo`, front, 'image/jpeg', 'shop.jpg');
    check('only someone who can change customers adds the photo', notAllowed.status === 403, String(notAllowed.status));
    const withPhoto = await owner.upload(`/customers/${c.id}/shop-photo`, front, 'image/jpeg', 'shop.jpg');
    check('the shop’s front photo is taken', withPhoto.status === 201 && !!withPhoto.body.shopPhoto?.uploadedAt, `${withPhoto.status} ${JSON.stringify(withPhoto.body?.shopPhoto)}`);
    check('…and where it is kept never leaves the server', !JSON.stringify(withPhoto.body).includes('/customers/'));
    const served = await accountant.bytes(`/customers/${c.id}/shop-photo`);
    check('anyone who can see the customer sees the photo, byte for byte', served.status === 200 && served.type === 'image/jpeg' && served.body.equals(front), `${served.status} ${served.type} ${served.body.length}/${front.length}`);
    check('a driver doesn’t browse customers', (await driver.bytes(`/customers/${c.id}/shop-photo`)).status === 403);
    const kept = (await db.query('SELECT tenant_id::text, shop_photo_key FROM trading_partners.customer WHERE id = $1', [c.id])).rows[0];
    check('the photo is kept under the business and the customer', kept.shop_photo_key.startsWith(`${kept.tenant_id}/customers/${c.id}/shop-`), kept.shop_photo_key);
    const newer = await jpeg(640, 480, 'SAGAR VEG');
    await owner.upload(`/customers/${c.id}/shop-photo`, newer, 'image/jpeg', 'shop2.jpg');
    check('a new photo replaces it', (await owner.bytes(`/customers/${c.id}/shop-photo`)).body.equals(newer));

    let rec = await owner.get(`/customers/${c.id}`);
    rec = await owner.patch(`/customers/${c.id}`, { version: rec.version, latitude: 12.3125, longitude: 76.6511, landmark: '' });
    profile = await owner.get(`/customers/${c.id}/profile`);
    check('editing moves the pin and a blank landmark clears it', profile.pin?.latitude === '12.312500' && profile.pin?.longitude === '76.651100' && rec.landmark === null, `${JSON.stringify(profile.pin)} ${rec.landmark}`);
    rec = await owner.patch(`/customers/${c.id}`, { version: rec.version, name: rec.name });
    check('…an edit that leaves the location out keeps the pin', (await owner.get(`/customers/${c.id}/profile`)).pin?.latitude === '12.312500');
    rec = await owner.patch(`/customers/${c.id}`, { version: rec.version, latitude: null, longitude: null });
    check('…and both null take it away', (await owner.get(`/customers/${c.id}/profile`)).pin === null);
    // Created, two photos, three edits.
    const audit = await db.query(`SELECT count(*)::int AS n FROM infra.audit_log WHERE entity_type = 'customer' AND entity_id = $1`, [c.id]);
    check('every change is in the audit trail', audit.rows[0].n >= 6, String(audit.rows[0].n));

    // ---- The owner app, on a phone standing at the shop ----
    const ctx = await browser.newContext({
      viewport: { width: 400, height: 860 },
      isMobile: true,
      hasTouch: true,
      geolocation: { latitude: 12.2958, longitude: 76.6394, accuracy: 9 },
      permissions: ['geolocation'],
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/login`);
    await page.fill('#login', 'owner@dev.morbeez.local');
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL((u) => !/\/login/.test(u.toString()));

    await page.goto(`${BASE}/customers?new=1`);
    const dialog = page.locator('dialog[open]');
    await dialog.getByRole('heading', { name: 'New customer' }).waitFor();
    const labels = (await dialog.locator('.field > label').allInnerTexts()).map((l) => l.trim());
    const asked = ['Name', 'Contact person (optional)', 'Phone (optional)', 'Location — GPS (optional)', 'Landmark (optional)', 'Shop photo — front (optional)'];
    check('the form asks in the client’s order: name, contact person, phone, GPS location, landmark, shop photo', asked.every((l, i) => labels[i] === l), labels.slice(0, 6).join(' | '));
    await dialog.getByLabel('Name', { exact: true }).fill(`Udupi Grand ${s}`);
    await dialog.getByLabel('Contact person (optional)').fill('Manjunath');
    await dialog.getByLabel('Phone (optional)').fill('+919800000082');
    await dialog.getByRole('button', { name: 'Use my location' }).click();
    const where = dialog.getByLabel('Location — GPS (optional)');
    await page.waitForFunction(() => /12\.295800, 76\.639400/.test(document.querySelector('dialog[open] .location-input input')?.value ?? ''));
    const note = (await dialog.locator('.location-field').innerText()).replace(/\s+/g, ' ');
    check('“Use my location” fills in where the phone is, and how exact', (await where.inputValue()) === '12.295800, 76.639400' && /to within 9 m/.test(note) && /Check it on Google Maps/.test(note), `${await where.inputValue()} | ${note}`);
    await dialog.getByLabel('Landmark (optional)').fill('Next to Canara Bank');
    const big = await jpeg(3000, 2000, 'UDUPI GRAND');
    await dialog.getByLabel('Shop photo — front (optional)').setInputFiles({ name: 'IMG_20261120.jpg', mimeType: 'image/jpeg', buffer: big });
    await dialog.locator('img.shop-photo').waitFor();
    check('the photo shows before it is sent', await dialog.locator('img.shop-photo').evaluate((img) => img.naturalWidth === 3000));
    check('the form fits the phone', await page.evaluate(() => window.innerWidth === 400 && document.documentElement.scrollWidth <= 401));
    // The coordinates show whole: the box is wide enough for them.
    const shown = await where.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    check('the coordinates show whole on a phone', shown);
    if (shots) {
      await dialog.locator('.dialog-form').evaluate((el) => el.scrollTo?.(0, 0));
      await page.screenshot({ path: path.join(shots, 'onboarding-form.png') });
      await dialog.locator('img.shop-photo').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(shots, 'onboarding-form-photo.png') });
    }
    await dialog.getByRole('button', { name: 'Add customer' }).click();
    await page.locator('.detail').getByText(`Udupi Grand ${s}`).first().waitFor({ timeout: 20000 });

    const made = (await db.query(`SELECT id, contact, landmark, shop_photo_type FROM trading_partners.customer WHERE name = $1`, [`Udupi Grand ${s}`])).rows[0];
    const madePin = (await db.query(`SELECT latitude::text, longitude::text FROM fulfilment.place_pin WHERE kind = 'customer' AND ref_id = $1`, [made.id])).rows[0];
    check(
      'saved: the contact person, the landmark, the phone’s position as the pin, the photo',
      made.contact.person === 'Manjunath' && made.landmark === 'Next to Canara Bank' && madePin?.latitude === '12.295800' && madePin?.longitude === '76.639400' && made.shop_photo_type === 'image/jpeg',
      JSON.stringify({ person: made.contact.person, landmark: made.landmark, pin: madePin, photo: made.shop_photo_type }),
    );
    const sent = await owner.bytes(`/customers/${made.id}/shop-photo`);
    const size = jpegSize(sent.body);
    check('a phone-size photo is shrunk before sending: at most 1600 px, far fewer bytes', size && size.width <= 1600 && size.height <= 1600 && sent.body.length < big.length, JSON.stringify({ ...size, bytes: sent.body.length, from: big.length }));

    const panel = page.locator('.detail');
    await panel.locator('img.shop-photo').waitFor();
    await page.waitForFunction(() => (document.querySelector('.detail img.shop-photo')?.naturalWidth ?? 0) > 0);
    const details = (await panel.innerText()).replace(/\s+/g, ' ');
    check('the profile shows the shop, who to ask for, the landmark and the location', /Manjunath/.test(details) && /Next to Canara Bank/.test(details) && /12\.2958, 76\.6394/.test(details), details.slice(0, 300));
    check('…the location opens Google Maps', (await panel.getByRole('link', { name: '12.2958, 76.6394' }).getAttribute('href')).includes('12.2958'));
    if (shots) await page.screenshot({ path: path.join(shots, 'onboarding-profile.png'), fullPage: true });

    // Moved, from a Google Maps link pasted in Edit details.
    await panel.getByRole('button', { name: 'Edit details' }).click();
    const edit = page.locator('dialog[open]');
    await edit.getByLabel('Location — GPS (optional)').fill('https://www.google.com/maps/place/Udupi+Grand/@12.2961,76.6398,18z/data=!4m6!3m5!8m2!3d12.296123!4d76.639876');
    await edit.getByRole('button', { name: 'Save' }).click();
    await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 0, null, { timeout: 15000 });
    const movedPin = (await db.query(`SELECT latitude::text, longitude::text FROM fulfilment.place_pin WHERE kind = 'customer' AND ref_id = $1`, [made.id])).rows[0];
    check('a pasted Google Maps link moves the pin to the place it shows', movedPin.latitude === '12.296123' && movedPin.longitude === '76.639876', JSON.stringify(movedPin));
    check('no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();

    // The same form in Malayalam (the aliases table's words).
    const ml = await browser.newContext({ viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true });
    const mlPage = await ml.newPage();
    await owner.raw('PATCH', '/users/me/preferences', { language: 'ml' });
    try {
      await mlPage.goto(`${BASE}/login`);
      await mlPage.fill('#login', 'owner@dev.morbeez.local');
      await mlPage.fill('#password', PASSWORD);
      await mlPage.click('button[type=submit]');
      await mlPage.waitForURL((u) => !/\/login/.test(u.toString()));
      await mlPage.goto(`${BASE}/customers?new=1`);
      await mlPage.locator('dialog[open] .field > label').first().waitFor();
      const mlLabels = (await mlPage.locator('dialog[open] .field > label').allInnerTexts()).slice(0, 6).join(' | ');
      check('in Malayalam: കോൺടാക്ട് പേഴ്സൺ, ലൊക്കേഷൻ, ലാൻഡ്മാർക്ക്, ഫോട്ടോ', /കോൺടാക്ട് പേഴ്സൺ/.test(mlLabels) && /ലൊക്കേഷൻ/.test(mlLabels) && /ലാൻഡ്മാർക്ക്/.test(mlLabels) && /ഫോട്ടോ/.test(mlLabels), mlLabels);
      if (shots) await mlPage.screenshot({ path: path.join(shots, 'onboarding-form-ml.png') });
    } finally {
      await owner.raw('PATCH', '/users/me/preferences', { language: 'en' });
      await ml.close();
    }
  } finally {
    await browser.close();
    await db.end();
  }
  console.log(results.join('\n'));
  console.log(`\n${results.filter((x) => x.startsWith('PASS')).length}/${results.length} passed`);
  if (results.some((x) => x.startsWith('FAIL'))) process.exit(1);
})().catch((e) => {
  console.log(results.join('\n'));
  console.error('FAILED:', e.message);
  process.exit(1);
});
