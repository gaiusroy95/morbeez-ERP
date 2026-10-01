/**
 * Indian mobile numbers, as people type them — "98220 11111",
 * "+91-98220-11111", "09822011111" — to the one stored form, +919822011111
 * (E.164; identity.app_user_phone_format checks the same). Null when it
 * isn't a mobile number.
 */
export function normalizeIndianMobile(input: string): string | null {
  let digits = input.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+91')) digits = digits.slice(3);
  else if (digits.startsWith('0091')) digits = digits.slice(4);
  else if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

/** "+919822011111" → "98220 11111", how the number is written back to people. */
export function formatIndianMobile(e164: string): string {
  const d = e164.replace(/^\+91/, '');
  return `${d.slice(0, 5)} ${d.slice(5)}`;
}
