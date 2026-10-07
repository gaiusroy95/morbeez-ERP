'use client';

import { FormEvent, Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AuthHero } from '@/components/auth/AuthHero';
import { useT } from '@/lib/i18n';
import { LanguageSwitch } from '@/components/layout/LanguageSwitch';

// Only same-app paths — `next` comes from the URL, so an absolute or
// protocol-relative value would otherwise be an open redirect.
function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/dashboard';
  return next;
}

function LoginForm() {
  const searchParams = useSearchParams();
  const t = useT();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ login: login.trim(), password }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(body?.error?.message ?? t('Sign-in failed. Try again.'));
        return;
      }
      // A full navigation, so every query starts fresh under the new session.
      window.location.assign(safeNext(searchParams.get('next')));
    } catch {
      setError(t("Can't reach Morbeez. Check your connection and try again."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="login-card" onSubmit={onSubmit} noValidate>
      <div>
        <h1 className="page-title">{t('Welcome back')}</h1>
        <p className="page-subtitle">{t('Sign in with your mobile number and password.')}</p>
      </div>

      {!error && searchParams.get('changed') === '1' && (
        <p className="muted" role="status" style={{ margin: 0 }}>
          {t('Password changed. Sign in with your new password.')}
        </p>
      )}
      {error && (
        <div className="login-error" role="alert">
          {error}
        </div>
      )}

      <div className="field">
        <label htmlFor="login">{t('Mobile number')}</label>
        {/* Also takes an email: logins made before phone sign-in. */}
        <div className="phone-input">
          {!login.includes('@') && <span className="phone-prefix">+91</span>}
          <input
            id="login"
            type="text"
            inputMode={login.includes('@') ? 'email' : 'tel'}
            autoComplete="username"
            placeholder="98765 43210"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            required
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="password">{t('Password')}</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>

      <button className="button button-primary" type="submit" disabled={submitting || !login || !password}>
        {submitting ? t('Signing in…') : t('Sign in')}
      </button>
      <p className="login-switch">
        {t('New to Morbeez?')} <Link href="/signup">{t('Start your free month')}</Link>
      </p>
      <p className="login-foot">{t('Forgot your password? Ask the business owner to reset it.')}</p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="login-page">
      <AuthHero />
      <div className="login-side">
        <div className="login-lang">
          <LanguageSwitch />
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
