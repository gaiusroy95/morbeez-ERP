'use client';

import { useState } from 'react';
import { Panel, SkeletonLines } from '@/components/ui/Panel';
import { Field } from '@/components/ui/Form';
import { Icon, type IconName } from '@/components/ui/Icon';
import { initialsOf } from '@/components/redesign/Party';
import { apiSend } from '@/lib/api/client';
import { useSession } from '@/lib/hooks/use-tenant';
import { useTenantProfile } from '@/lib/hooks/use-lookups';
import { useMyActivity, useTeam } from '@/lib/hooks/use-admin';
import { displayLogin } from '@/lib/phone';
import { formatDateTime } from '@/lib/format';
import { Access, useAccess } from '@/lib/hooks/use-access';
import { useI18n, useT, type Translate } from '@/lib/i18n';
import { LanguageSwitch } from '@/components/layout/LanguageSwitch';

const MIN_LENGTH = 12;

type Open = 'activity' | 'password' | 'language' | 'about' | null;

const ENTITY: Record<string, string> = {
  trip: 'a trip',
  trip_stop: 'a stop',
  trip_expense: 'an expense',
  backhaul: 'a backhaul',
  customer_order: 'a delivery order',
  purchase_order: 'a purchase order',
  customer: 'a customer',
  farmer: 'a farmer',
  product: 'a product',
  employee: 'a worker',
  vehicle: 'a vehicle',
  invoice: 'an invoice',
  approval_request: 'an approval',
  user_role: "someone's role",
  spot_sale: 'a spot sale',
};

/** "Updated a trip". */
function activityText(action: string, entityType: string, t: Translate): string {
  const verb = action === 'create' ? 'Added' : action === 'archive' ? 'Archived' : action === 'restore' ? 'Restored' : 'Updated';
  return `${t(verb)} ${t(ENTITY[entityType] ?? entityType.replace(/_/g, ' '))}`;
}

/**
 * My Profile (client design, set 1 screen 20): who you are in the
 * business, your sign-in, what you did lately, your password and language,
 * and the plan. Changing the password ends every session, this one too,
 * so success signs out and asks for the new one.
 */
export default function AccountPage() {
  const { data: session } = useSession();
  const tenant = useTenantProfile().data;
  const t = useT();
  const team = useTeam(!!session?.permissions.includes('users:read'));
  const me = team.data?.find((m) => m.userId === session?.userId);
  const [open, setOpen] = useState<Open>(null);
  const name = me?.workerName ?? (session ? displayLogin(session.login) : '');
  const toggle = (o: Open) => setOpen((x) => (x === o ? null : o));

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <h1 className="page-title visually-hidden">{t('My Profile')}</h1>
      <div className="panel profile-card">
        <span className="party-avatar party-avatar-large" aria-hidden="true">
          {me?.workerName ? initialsOf(me.workerName) : <Icon name="user" size={26} />}
        </span>
        <span className="party-main">
          <span className="profile-name">{name}</span>
          <span className="party-sub">{(session?.roles ?? []).map((r) => t(r)).join(', ')}</span>
          {tenant && <span className="party-sub">{tenant.name}</span>}
        </span>
      </div>
      <div className="panel profile-contact">
        {me?.phone && (
          <span>
            <Icon name="phone" size={18} /> {displayLogin(me.phone)}
          </span>
        )}
        {me?.email && (
          <span>
            <Icon name="chat" size={18} /> {me.email}
          </span>
        )}
        {!me && session && (
          <span>
            <Icon name="user" size={18} /> {displayLogin(session.login)}
          </span>
        )}
      </div>

      <div className="link-list">
        <MenuRow icon="clock" label="View usage & activity" open={open === 'activity'} onClick={() => toggle('activity')} />
        {open === 'activity' && <Activity />}
        <MenuRow icon="key" label="Change password" open={open === 'password'} onClick={() => toggle('password')} />
        {open === 'password' && <ChangePassword />}
        <MenuRow icon="globe" label="Language" open={open === 'language'} onClick={() => toggle('language')} />
        {open === 'language' && (
          <Panel title={t('Language')}>
            <div className="lang-panel">
              <LanguageSwitch />
              <p className="muted" style={{ margin: 0 }}>
                {t('The app speaks to you in this language, on this device and when you sign in elsewhere. Tax invoices stay in English.')}
              </p>
            </div>
          </Panel>
        )}
        <MenuRow icon="leaf" label="About Morbeez" open={open === 'about'} onClick={() => toggle('about')} />
        {open === 'about' && (
          <Panel title={t('About Morbeez')}>
            <p className="muted" style={{ margin: 0 }}>
              {t('Morbeez runs a farm-to-market business: procurement, deliveries, trips, money and people, in one place.')}
            </p>
          </Panel>
        )}
      </div>
      <PlanPanel />
      <p className="brand-line">
        <Icon name="leaf" size={20} /> {t('Grow with Experts')}
      </p>
    </div>
  );
}

function MenuRow({ icon, label, open, onClick }: { icon: IconName; label: string; open: boolean; onClick: () => void }) {
  const t = useT();
  return (
    <button type="button" className="link-row" aria-expanded={open} onClick={onClick}>
      <span className="link-row-icon" aria-hidden="true">
        <Icon name={icon} size={20} />
      </span>
      <span className="link-row-main">
        <span className="link-row-title">{t(label)}</span>
      </span>
      <Icon name="chevron" size={18} />
    </button>
  );
}

const ACTIVITY_SHOWN = 10;

function Activity() {
  const t = useT();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const activity = useMyActivity(true);
  const [all, setAll] = useState(false);
  const rows = activity.data ?? [];
  return (
    <Panel title={t('What you did lately')}>
      {activity.isPending ? (
        <SkeletonLines lines={4} />
      ) : rows.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          {t('Nothing yet.')}
        </p>
      ) : (
        <>
          <ul className="activity-list">
            {(all ? rows : rows.slice(0, ACTIVITY_SHOWN)).map((a, i) => (
              <li key={`${a.entityId}-${i}`}>
                <span>{activityText(a.action, a.entityType, t)}</span>
                <span className="muted">{formatDateTime(a.at, timeZone)}</span>
              </li>
            ))}
          </ul>
          {!all && rows.length > ACTIVITY_SHOWN && (
            <button type="button" className="button" onClick={() => setAll(true)}>
              {t('Show all ({n})', { n: rows.length })}
            </button>
          )}
        </>
      )}
    </Panel>
  );
}

function ChangePassword() {
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
    <Panel title={t('Change password')}>
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
      <Panel title={t('Your plan')}>
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
