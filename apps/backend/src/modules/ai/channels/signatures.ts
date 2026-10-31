import { createHmac, timingSafeEqual } from 'crypto';

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Meta signs each webhook with the app secret: X-Hub-Signature-256 is
 * "sha256=" and the HMAC-SHA256 of the body exactly as sent.
 */
export function validWhatsAppSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return sameText(header.slice('sha256='.length), expected);
}

/**
 * Twilio signs each request with the account's auth token: the HMAC-SHA1 of
 * the full URL it called, then each POST parameter's name and value in name
 * order, in base64 (X-Twilio-Signature).
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
}

export function validTwilioSignature(authToken: string, url: string, params: Record<string, string>, header: string | undefined): boolean {
  if (!header) return false;
  return sameText(header, twilioSignature(authToken, url, params));
}
