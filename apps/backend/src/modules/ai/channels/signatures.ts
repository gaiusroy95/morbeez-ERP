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
