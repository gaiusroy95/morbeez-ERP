'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { ml } from './ml';
import { kn } from './kn';
import { ta } from './ta';

/**
 * The languages Morbeez speaks (client Q&A, pilot baseline): English,
 * Malayalam, Kannada and Tamil, chosen per user. English text is the key —
 * `t('Place order')` — so a phrase not yet translated simply shows in
 * English, and the dictionaries read as English → language pairs that a
 * native speaker can review line by line (the client's process: draft →
 * native-speaker review → pilot → final terminology).
 *
 * Tax invoices and accounting statements keep English as their official
 * text; this is the app around them.
 */
import { isLang, LANG_COOKIE, type Lang } from './langs';

export { isLang, LANG_COOKIE, type Lang };

export const LANGS: { code: Lang; name: string; english: string }[] = [
  { code: 'en', name: 'English', english: 'English' },
  { code: 'ml', name: 'മലയാളം', english: 'Malayalam' },
  { code: 'kn', name: 'ಕನ್ನಡ', english: 'Kannada' },
  { code: 'ta', name: 'தமிழ்', english: 'Tamil' },
];

const DICTS: Record<Exclude<Lang, 'en'>, Record<string, string>> = { ml, kn, ta };

/** `{name}` placeholders filled from [vars]. */
export type Translate = (text: string, vars?: Record<string, string | number>) => string;

function translate(lang: Lang, text: string, vars?: Record<string, string | number>): string {
  const found = lang === 'en' ? text : DICTS[lang][text] ?? text;
  return vars ? found.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole)) : found;
}

interface I18n {
  lang: Lang;
  t: Translate;
  setLang: (lang: Lang) => void;
}

const I18nContext = createContext<I18n>({
  lang: 'en',
  t: (text, vars) => translate('en', text, vars),
  setLang: () => undefined,
});

/** Remembers the choice on this device (cookie, read by the server for the first paint) and for the person (their account). */
function remember(lang: Lang) {
  document.cookie = `${LANG_COOKIE}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`;
  document.documentElement.lang = lang === 'en' ? 'en-IN' : `${lang}-IN`;
  // Best effort: the account keeps it too, so it follows the person to another device.
  void fetch('/api/backend/users/me/preferences', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ language: lang }),
  }).catch(() => undefined);
}

export function I18nProvider({ initial, children }: { initial: Lang; children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);
  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    remember(next);
  }, []);
  const value = useMemo<I18n>(() => ({ lang, setLang, t: (text, vars) => translate(lang, text, vars) }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}

/** The translate function alone — what most components need. */
export function useT(): Translate {
  return useContext(I18nContext).t;
}
