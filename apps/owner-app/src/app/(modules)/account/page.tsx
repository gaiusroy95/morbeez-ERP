'use client';

import { useState } from 'react';
import { Panel } from '@/components/ui/Panel';
import { PageHeader } from '@/components/ui/ListControls';
import { Field } from '@/components/ui/Form';
import { apiSend } from '@/lib/api/client';
import { useSession } from '@/lib/hooks/use-tenant';
import { displayLogin } from '@/lib/phone';
import { Access, useAccess } from '@/lib/hooks/use-access';
import { useI18n, useT, type Translate } from '@/lib/i18n';
import { LanguageSwitch } from '@/components/layout/LanguageSwitch';

const MIN_LENGTH = 12;

/**
 * The signed-in person's own account. Changing the password ends every
 * session (the backend revokes them all), including this one, so success
 * signs out and asks for the new password — which is also how a business set
 * up by the Morbeez team replaces the one-time password it was given.
 */
export default function AccountPage() {
  const { data: session } = useSession();
  const t = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!current) return setProblem(t('Enter your current password.'));
    if (next.length < MIN_LENGTH) return setProblem(t('The new password needs at least {n} characters.', { n: MIN_LENGTH }));
    if (next !== again) return setProblem(t("The new passwords don't match."));
    if (next === current) return setProblem(t('The new password must be different from the current one.'));
    setProblem(null);
    setSaving(true);
    try {
      await apiSend('POST', 'users/me/change-password', { currentPassword: current, newPassword: next });
      await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
      window.location.assign('/login?changed=1');
    } catch (err) {
      setProblem((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="stack">
      <PageHeader title="Your account" subtitle={displayLogin(session?.login)} />
      <PlanPanel />
      <Panel title="Language">
        <div className="lang-panel">
          <LanguageSwitch />
          <p className="muted" style={{ margin: 0 }}>
            {t('The app speaks to you in this language, on this device and when you sign in elsewhere. Tax invoices stay in English.')}
          </p>
        </div>
      </Panel>
      <Panel title="Change password">
        <form className="form-grid" onSubmit={submit}>
          <Field label="Current password">
            {(p) => <input {...p} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}
          </Field>
          <Field label="New password" hint={t('At least {n} characters', { n: MIN_LENGTH })}>
            {(p) => <input {...p} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}
          </Field>
          <Field label="New password again">
            {(p) => <input {...p} type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />}
          </Field>
          <div className="form-wide action-bar" style={{ marginTop: 0 }}>
            <button type="submit" className="button button-primary" disabled={saving}>
              {saving ? t('Changing…') : t('Change password')}
            </button>
            {problem && (
              <span className="form-error" role="alert">
                {problem}
              </span>
            )}
          </div>
          <p className="muted form-wide" style={{ margin: 0 }}>
            {t("You'll be signed out everywhere, on this device and any other, and sign in again with the new password.")}
          </p>
        </form>
      </Panel>
    </div>
  );
}

function planLine(access: Access, t: Translate, lang: string): string {
  const dateFmt = new Intl.DateTimeFormat(`${lang}-IN`, { day: 'numeric', month: 'long', year: 'numeric' });
  const on = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : '');
  switch (access.state) {
    case 'trial':
      return t('Free trial until {date}. Everything works until then.', { date: on(access.trialEndsAt) });
    case 'ended':
      return t('The free trial ended on {date}. You can still see everything, but nothing can be added or changed until you subscribe.', {
        date: on(access.trialEndsAt),
      });
    case 'active':
      return t('Subscribed until {date}.', { date: on(access.subscribedUntil) });
    default:
      return t('No time limit on this account.');
  }
}

/** The free trial or subscription, and how to subscribe. */
function PlanPanel() {
  const { data: access } = useAccess();
  const { t, lang } = useI18n();
  if (!access) return null;
  return (
    <section id="plan">
      <Panel title="Your plan">
        <p style={{ margin: 0 }}>{planLine(access, t, lang)}</p>
        {(access.state === 'trial' || access.state === 'ended') && (
          <p className="muted" style={{ margin: '8px 0 0' }}>
            {t('To subscribe, contact the Morbeez team. Your data stays exactly as it is.')}
          </p>
        )}
      </Panel>
    </section>
  );
}
