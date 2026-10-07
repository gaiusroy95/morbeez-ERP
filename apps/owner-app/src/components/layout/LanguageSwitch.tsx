'use client';

import { LANGS, useI18n, type Lang } from '@/lib/i18n';

/**
 * The language switch in the top bar (client Q&A: the Owner app in English,
 * Malayalam, Kannada and Tamil, chosen per user). Each language is shown in
 * its own script so it can be found by someone who doesn't read the current one.
 */
export function LanguageSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <label className="lang-switch" title={t('Language')}>
      <span className="visually-hidden">{t('Language')}</span>
      <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label={t('Language')}>
        {LANGS.map((l) => (
          <option key={l.code} value={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}
