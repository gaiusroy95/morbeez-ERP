'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { AuthHero } from '@/components/auth/AuthHero';
import { normalizeIndianMobile } from '@/lib/phone';
import { useT } from '@/lib/i18n';
import { LanguageSwitch } from '@/components/layout/LanguageSwitch';

const MIN_PASSWORD = 12;

/**
 * A business signs itself up: its name, the owner's mobile number and a
 * password. It starts on a free month straight away, already signed in.
 */
export default function SignupPage() {
  const t = useT();
  const [business, setBusiness] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const ownerPhone = normalizeIndianMobile(phone);
    if (business.trim().length < 2) return setError('Enter your business name.');
    if (!ownerPhone) return setError('Enter a 10-digit mobile number.');
    if (password.length < MIN_PASSWORD) return setError(`The password needs at least ${MIN_PASSWORD} characters.`);

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ businessName: business.trim(), ownerPhone, ownerPassword: password }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(body?.error?.message ?? 'Could not create your account. Try again.');
        return;
      }
      window.location.assign('/dashboard');
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
          <div>
            <span className="trial-chip">{t('1 month free · no card needed')}</span>
            <h1 className="page-title" style={{ marginTop: 12 }}>
              {t('Start your free month')}
            </h1>
            <p className="page-subtitle">{t('Set up your business in a minute. You sign in with your mobile number.')}</p>
          </div>

          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}

          <div className="field">
            <label htmlFor="business">{t('Business name')}</label>
            <input
              id="business"
              autoComplete="organization"
              placeholder="Sharma Vegetables"
              value={business}
              onChange={(e) => setBusiness(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="phone">{t('Your mobile number')}</label>
            <div className="phone-input">
              <span className="phone-prefix">+91</span>
              <input
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="98765 43210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="password">{t('Choose a password')}</label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <span className="field-hint">{t('At least {n} characters', { n: MIN_PASSWORD })}</span>
          </div>

          <button className="button button-primary" type="submit" disabled={submitting}>
            {submitting ? t('Creating your account…') : t('Create account')}
          </button>
          <p className="login-switch">
            {t('Already use Morbeez?')} <Link href="/login">{t('Sign in')}</Link>
          </p>
        </form>
      </div>
    </main>
  );
}
