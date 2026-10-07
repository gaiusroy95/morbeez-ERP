// Plain values shared by server route handlers and the client provider
// (lib/i18n/index.tsx is a client module).
export type Lang = 'en' | 'ml' | 'kn' | 'ta';
export const LANG_COOKIE = 'mz_lang';

export function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'ml' || value === 'kn' || value === 'ta';
}
