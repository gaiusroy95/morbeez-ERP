'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AuthHero } from '@/components/auth/AuthHero';
import { LanguageSwitch } from '@/components/layout/LanguageSwitch';
import { useT } from '@/lib/i18n';

const MIN_PASSWORD = 12;

interface SetupInfo {
  state: 'valid' | 'used' | 'expired';
  business: string;
  name: string | null;
  login: string;
}

/**
 * Opened from the link the owner sends a new staff member: they choose
 * their own password here, then sign in to the Morbeez app (Driver) with
 * their mobile number. Public — they aren't signed in.
 */
export default function SetPasswordPage() {
  const t = useT();
  const [token, setToken] = useState<string | null>(null);
  const [info, setInfo] = useState<SetupInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('token') ?? '';
    setToken(value);
    fetch(`/api/auth/password-setup?token=${encodeURIComponent(value)}`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) setLoadError(body?.error?.message ?? 'This link is not valid. Ask for a new one.');
        else setInfo(body as SetupInfo);
      })
      .catch(() => setLoadError("Can't reach Morbeez. Check your connection and try again."));
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (password.length < MIN_PASSWORD) return setError(t('The new password needs at least {n} characters.', { n: MIN_PASSWORD }));
    if (password !== again) return setError(t("The new passwords don't match."));
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/password-setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(body?.error?.message ?? t('Something went wrong.'));
        return;
      }
      setDone(true);
    } catch {
      setError(t("Can't reach Morbeez. Check your connection and try again."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <AuthHero />
      <div className="login-side">
        <div className="login-lang">
          <LanguageSwitch />
        </div>
        <form className="login-card" onSubmit={onSubmit} noValidate>
          {!info && !loadError && <p className="muted">{t('Loading…')}</p>}

          {loadError && (
            <>
              <h1 className="page-title">{t('This link does not work')}</h1>
              <div className="login-error" role="alert">
                {loadError}
              </div>
            </>
          )}

          {info && info.state !== 'valid' && !done && (
            <>
              <h1 className="page-title">{info.state === 'used' ? t('This link was already used') : t('This link has expired')}</h1>
              <p className="page-subtitle">
                {t('Ask {business} for a new link, or sign in to the Morbeez app if you already set your password.', { business: info.business })}
              </p>
            </>
          )}

          {info && info.state === 'valid' && !done && (
            <>
              <div>
                <h1 className="page-title">{info.name ? t('Hello {name}', { name: info.name }) : t('Set your password')}</h1>
                <p className="page-subtitle">
                  {t('Choose a password for your Morbeez login at {business}. You sign in with {login}.', {
                    business: info.business,
                    login: info.login,
                  })}
                </p>
              </div>
              {error && (
                <div className="login-error" role="alert">
                  {error}
                </div>
              )}
              <div className="field">
                <label htmlFor="password">{t('New password')}</label>
                <input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                <span className="field-hint">{t('At least {n} characters', { n: MIN_PASSWORD })}</span>
              </div>
              <div className="field">
                <label htmlFor="again">{t('New password again')}</label>
                <input id="again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
              </div>
              <button className="button button-primary" type="submit" disabled={submitting}>
                {submitting ? t('Saving…') : t('Set password')}
              </button>
            </>
          )}

          {done && info && (
            <>
              <h1 className="page-title">{t('Your password is set')}</h1>
              <p className="page-subtitle">
                {t('Open the Morbeez app, tap Driver, and sign in with {login} and your new password.', { login: info.login })}
              </p>
            </>
          )}
        </form>
      </div>
    </main>
  );
}
