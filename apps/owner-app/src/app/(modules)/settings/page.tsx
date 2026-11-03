'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { RoleSummary, TeamMember } from '@morbeez/shared-types';
import { AlertSettingsForm, type AlertSettings } from '@/components/delegation/Delegation';
import { initialsOf } from '@/components/redesign/Party';
import { DriverIncentivesPanel } from '@/components/people/DriverIncentives';
import { Integrations } from '@/components/settings/Integrations';
import { Field } from '@/components/ui/Form';
import { Icon, type IconName } from '@/components/ui/Icon';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { apiGet, apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useRoles, useTeam } from '@/lib/hooks/use-admin';
import { useCurrency, useTenantProfile } from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { displayLogin } from '@/lib/phone';
import { useT } from '@/lib/i18n';

type View = 'company' | 'users' | 'rules' | 'notifications' | 'integrations';

interface Row {
  label: string;
  description: string;
  icon: IconName;
  view?: View;
  href?: string;
  permission?: string;
}

const ROWS: Row[] = [
  { label: 'Company profile', description: 'Name, GSTIN, time zone', icon: 'badge', view: 'company' },
  { label: 'Users & permissions', description: 'Manage team access', icon: 'users', view: 'users', permission: 'users:read' },
  { label: 'Rates & rules', description: 'Approvals, tolerances, pricing, incentives', icon: 'rupee', view: 'rules' },
  { label: 'Products & categories', description: 'Manage products', icon: 'leaf', href: '/products', permission: 'products:read' },
  { label: 'Routes', description: 'Manage delivery routes', icon: 'pin', href: '/routes' },
  { label: 'Vehicle costing', description: 'Document reminders, KM costs', icon: 'steering', href: '/vehicles#settings', permission: 'vehicles:read' },
  { label: 'Leave policy', description: 'Pay rules, weekly off', icon: 'calendar', href: '/workforce#rules', permission: 'payroll:read' },
  { label: 'Notifications', description: 'Alerts and reminders', icon: 'bell', view: 'notifications' },
  { label: 'Integrations', description: 'WhatsApp orders, AI reading, AI calls', icon: 'phone', view: 'integrations', permission: 'ai:read' },
  { label: 'Data & backup', description: 'Download your data', icon: 'download', href: '/reports' },
  { label: 'App preferences', description: 'Language', icon: 'globe', href: '/account' },
];

const TITLES: Record<View, string> = {
  company: 'Company profile',
  users: 'Users & permissions',
  rules: 'Rates & rules',
  notifications: 'Notifications',
  integrations: 'Integrations',
};

/**
 * Settings (client design, set 1 screen 19): one door to everything the
 * owner configures. Company profile, users and permissions, rates and
 * rules and notifications are edited here; the rest open their own screens.
 */
export default function SettingsPage() {
  const t = useT();
  const { data: session } = useSession();
  const tenant = useTenantProfile().data;
  // ?tab=integrations — from AI Calling's "Turn them on".
  const params = useSearchParams();
  const [view, setView] = useState<View | null>(params.get('tab') === 'integrations' ? 'integrations' : null);
  const [signingOut, setSigningOut] = useState(false);

  if (view) {
    return (
      <div className="stack" style={{ maxWidth: 820 }}>
        <div className="report-head">
          <button type="button" className="icon-button" onClick={() => setView(null)} aria-label={t('Back to settings')}>
            <Icon name="back" size={20} />
          </button>
          <h1 className="page-title">{t(TITLES[view])}</h1>
        </div>
        {view === 'company' && <CompanyProfile />}
        {view === 'users' && <UsersAndPermissions />}
        {view === 'rules' && <RatesAndRules onAlerts={() => setView('notifications')} />}
        {view === 'notifications' && <Notifications />}
        {view === 'integrations' && <Integrations />}
      </div>
    );
  }

  return (
    <div className="list-screen" style={{ maxWidth: 760 }}>
      <h1 className="page-title visually-hidden">{t('Settings')}</h1>
      <div className="link-list">
        {ROWS.filter((r) => !r.permission || hasPermission(session, r.permission)).map((r) => {
          const body = (
            <>
              <span className="link-row-icon" aria-hidden="true">
                <Icon name={r.icon} size={20} />
              </span>
              <span className="link-row-main">
                <span className="link-row-title">{t(r.label)}</span>
                <span className="link-row-sub">{r.view === 'company' && tenant ? tenant.name : t(r.description)}</span>
              </span>
              <Icon name="chevron" size={18} />
            </>
          );
          return r.view ? (
            <button key={r.label} type="button" className="link-row" onClick={() => setView(r.view as View)}>
              {body}
            </button>
          ) : (
            <Link key={r.label} className="link-row" href={r.href ?? '#'}>
              {body}
            </Link>
          );
        })}
      </div>
      <Panel title={t('Help & support')}>
        <p className="muted" style={{ margin: 0 }}>
          {t('For help with the app or your account, contact the Morbeez team.')}
        </p>
      </Panel>
      <button
        type="button"
        className="button button-danger logout-wide"
        disabled={signingOut}
        onClick={async () => {
          setSigningOut(true);
          await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
          window.location.assign('/login');
        }}
      >
        <Icon name="logout" size={18} /> {t('Logout')}
      </button>
    </div>
  );
}

// ---- Company profile ----

function CompanyProfile() {
  const t = useT();
  const { data: session } = useSession();
  const profile = useTenantProfile();
  const canEdit = hasPermission(session, 'tenant:manage');
  if (profile.isPending) return <SkeletonLines lines={4} />;
  if (profile.error || !profile.data) return <ErrorState error={profile.error} onRetry={() => profile.refetch()} />;
  return (
    <Panel title={t('Your business')}>
      <CompanyForm key={profile.data.name} profile={profile.data} canEdit={canEdit} />
    </Panel>
  );
}

function CompanyForm({ profile, canEdit }: { profile: NonNullable<ReturnType<typeof useTenantProfile>['data']>; canEdit: boolean }) {
  const t = useT();
  const [name, setName] = useState(profile.name);
  const [gstin, setGstin] = useState(profile.taxRegistration ?? '');
  const [timezone, setTimezone] = useState(profile.timezone);
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: Record<string, unknown>) => apiSend('PATCH', 'tenants/me', body), [['tenant'], KEYS.dashboard]);
  return (
    <form
      className="form-grid settings-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim().length < 2) return setProblem(t('Enter the business name.'));
        setProblem(null);
        save.mutate({ name: name.trim(), taxRegistration: gstin.trim() || undefined, timezone });
      }}
    >
      <Field label={t('Business name')}>{(p) => <input {...p} value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label={t('GSTIN')} hint={t('Printed on your tax invoices.')}>
        {(p) => <input {...p} value={gstin} disabled={!canEdit} maxLength={15} onChange={(e) => setGstin(e.target.value.toUpperCase())} />}
      </Field>
      <Field label={t('Time zone')} hint={t('Days and reports follow it.')}>
        {(p) => (
          <select {...p} value={timezone} disabled={!canEdit} onChange={(e) => setTimezone(e.target.value)}>
            {Array.from(new Set(['Asia/Kolkata', profile.timezone])).map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t('Currency')}>{(p) => <input {...p} value={profile.currency} disabled />}</Field>
      {canEdit && (
        <div className="settings-actions" data-wide="true">
          {(problem ?? save.error) ? <p className="form-error">{problem ?? (save.error as Error).message}</p> : null}
          {save.isSuccess && !save.isPending && <span className="muted">{t('Saved.')}</span>}
          <button type="submit" className="button button-primary" disabled={save.isPending}>
            {save.isPending ? t('Saving…') : t('Save')}
          </button>
        </div>
      )}
    </form>
  );
}

// ---- Users & permissions ----

function UsersAndPermissions() {
  const t = useT();
  const { data: session } = useSession();
  const team = useTeam();
  const roles = useRoles();
  const canWrite = hasPermission(session, 'users:write');
  const canAssign = hasPermission(session, 'roles:assign');
  const effects = [['users'], KEYS.workforce];
  const setStatus = useAction((input: { id: string; active: boolean }) => apiSend('POST', `users/${input.id}/${input.active ? 'reactivate' : 'deactivate'}`), effects);
  const addRole = useAction((input: { id: string; roleId: string }) => apiSend('POST', `users/${input.id}/roles`, { roleId: input.roleId }), effects);
  const removeRole = useAction((input: { id: string; roleId: string }) => apiSend('POST', `users/${input.id}/roles/${input.roleId}/remove`), effects);
  const error = setStatus.error ?? addRole.error ?? removeRole.error;

  if (team.isPending || roles.isPending) return <SkeletonLines lines={6} />;
  if (team.error || !team.data) return <ErrorState error={team.error} onRetry={() => team.refetch()} />;
  const allRoles: RoleSummary[] = roles.data ?? [];

  return (
    <>
      <p className="muted">
        {t('Everyone who can sign in to your business. A worker gets a login from their page in')} <Link href="/workforce">{t('Workforce')}</Link>.
      </p>
      {error ? (
        <p className="form-error" role="alert">
          {(error as Error).message}
        </p>
      ) : null}
      <div className="card-list">
        {team.data.map((m: TeamMember) => {
          const self = m.userId === session?.userId;
          const missing = allRoles.filter((r) => !m.roles.some((x) => x.id === r.id));
          return (
            <div key={m.userId} className="team-card" data-status={m.status}>
              {/* A login with no worker record has no name to take initials from. */}
              <span className="party-avatar" aria-hidden="true">
                {m.workerName ? initialsOf(m.workerName) : <Icon name="user" size={20} />}
              </span>
              <span className="party-main">
                <span className="party-name">
                  {m.workerName ?? displayLogin(m.login)}
                  {self && <span className="muted"> · {t('You')}</span>}
                </span>
                {m.workerName && <span className="party-sub">{displayLogin(m.login)}</span>}
                <span className="role-chips">
                  {m.roles.length === 0 && <span className="muted">{t('No role — can sign in but sees nothing')}</span>}
                  {m.roles.map((r) => (
                    <span key={r.id} className="role-chip">
                      {t(r.name)}
                      {canAssign && !self && (
                        <button
                          type="button"
                          className="role-chip-remove"
                          aria-label={t('Take {role} off {who}', { role: r.name, who: m.workerName ?? m.login })}
                          onClick={() => removeRole.mutate({ id: m.userId, roleId: r.id })}
                        >
                          <Icon name="close" size={12} />
                        </button>
                      )}
                    </span>
                  ))}
                  {canAssign && !self && missing.length > 0 && (
                    <select
                      className="role-add"
                      aria-label={t('Give {who} a role', { who: m.workerName ?? m.login })}
                      value=""
                      onChange={(e) => e.target.value && addRole.mutate({ id: m.userId, roleId: e.target.value })}
                    >
                      <option value="">{t('+ Role')}</option>
                      {missing.map((r) => (
                        <option key={r.id} value={r.id}>
                          {t(r.name)}
                        </option>
                      ))}
                    </select>
                  )}
                </span>
              </span>
              <span className="party-side">
                <span className="list-card-status" data-tone={m.status === 'active' ? 'done' : 'muted'}>
                  {t(m.status === 'active' ? 'Active' : 'Deactivated')}
                </span>
                {canWrite && !self && (
                  <button type="button" className="button button-small" onClick={() => setStatus.mutate({ id: m.userId, active: m.status !== 'active' })}>
                    {t(m.status === 'active' ? 'Deactivate' : 'Reactivate')}
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <Panel title={t('Roles')}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('Role')}</th>
                <th className="num">{t('People')}</th>
                <th>{t('What it allows')}</th>
              </tr>
            </thead>
            <tbody>
              {allRoles.map((r) => (
                <tr key={r.id}>
                  <td>{t(r.name)}</td>
                  <td className="num">{r.members}</td>
                  <td className="muted">{t('{n} permissions', { n: r.permissions.length })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

// ---- Rates & rules ----

interface ApprovalRule {
  id: string;
  actionType: string;
  thresholdAmount: string;
  isActive: boolean;
}

const RULES: { actionType: string; label: string; hint: string }[] = [
  { actionType: 'purchase_order', label: 'Purchase orders over', hint: 'Bigger ones wait for your approval before they are confirmed.' },
  { actionType: 'customer_order', label: 'Delivery orders over', hint: 'Bigger ones wait for your approval before they are confirmed.' },
];

function RatesAndRules({ onAlerts }: { onAlerts: () => void }) {
  const t = useT();
  const { data: session } = useSession();
  const currency = useCurrency();
  const profile = useTenantProfile();
  const rules = useQuery({ queryKey: ['approvals', 'rules'], queryFn: () => apiGet<ApprovalRule[]>('approval-rules'), enabled: hasPermission(session, 'approvals:read') });
  const canManage = hasPermission(session, 'approvals:manage');
  return (
    <>
      {hasPermission(session, 'approvals:read') && (
        <Panel title={t('Approval limits')}>
          {rules.isPending ? (
            <SkeletonLines lines={2} />
          ) : rules.error ? (
            <ErrorState error={rules.error} onRetry={() => rules.refetch()} />
          ) : (
            <div className="form-grid settings-form">
              {RULES.map((r) => (
                <ApprovalRuleField key={r.actionType} rule={rules.data?.find((x) => x.actionType === r.actionType) ?? null} def={r} currency={currency} canManage={canManage} />
              ))}
            </div>
          )}
          <p className="footnote">
            {t('A spot sale priced outside its band always waits for you — set the bands in')} <Link href="/spot-sales">{t('Spot sales')}</Link>.
          </p>
        </Panel>
      )}
      <button type="button" className="link-row" onClick={onAlerts}>
        <span className="link-row-icon" aria-hidden="true">
          <Icon name="bell" size={20} />
        </span>
        <span className="link-row-main">
          <span className="link-row-title">{t('Loss tolerances and alerts')}</span>
          <span className="link-row-sub">
            {profile.data
              ? t('Shrinkage {s}%, breakage {b}%', { s: Number(profile.data.defaultShrinkageTolerancePct ?? 0), b: Number(profile.data.defaultBreakageTolerancePct ?? 0) })
              : '—'}
          </span>
        </span>
        <Icon name="chevron" size={18} />
      </button>
      <Panel title={t('Pay and incentives')}>
        <div className="link-list">
          <Link className="link-row" href="/workforce#rules">
            <span className="link-row-icon" aria-hidden="true">
              <Icon name="badge" size={20} />
            </span>
            <span className="link-row-main">
              <span className="link-row-title">{t('Wage rules and incentives')}</span>
              <span className="link-row-sub">{t('Pay rates, minimum wages, per-trip and per-kg incentives')}</span>
            </span>
            <Icon name="chevron" size={18} />
          </Link>
          <Link className="link-row" href="/delegation">
            <span className="link-row-icon" aria-hidden="true">
              <Icon name="key" size={20} />
            </span>
            <span className="link-row-main">
              <span className="link-row-title">{t('Delegation')}</span>
              <span className="link-row-sub">{t('What each driver may do on the road')}</span>
            </span>
            <Icon name="chevron" size={18} />
          </Link>
        </div>
      </Panel>
      {hasPermission(session, 'payroll:read') && <DriverIncentivesPanel canConfigure={hasPermission(session, 'payroll:configure')} />}
    </>
  );
}

function alertSettingsOf(p: NonNullable<ReturnType<typeof useTenantProfile>['data']>): AlertSettings {
  return {
    operatingDayEnd: p.operatingDayEnd ?? '22:00',
    alertCashThreshold: p.alertCashThreshold ?? '0',
    alertCollectionThreshold: p.alertCollectionThreshold ?? '0',
    defaultShrinkageTolerancePct: p.defaultShrinkageTolerancePct ?? '0',
    defaultBreakageTolerancePct: p.defaultBreakageTolerancePct ?? '0',
    weighmentPhoto: p.weighmentPhoto ?? 'optional',
  };
}

function ApprovalRuleField({ rule, def, currency, canManage }: { rule: ApprovalRule | null; def: (typeof RULES)[number]; currency: string; canManage: boolean }) {
  const t = useT();
  const [amount, setAmount] = useState(rule ? String(Number(rule.thresholdAmount)) : '');
  const [active, setActive] = useState(rule?.isActive ?? false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction(
    (body: { actionType: string; thresholdAmount: number; isActive: boolean }) => apiSend('POST', 'approval-rules', body),
    [KEYS.approvals],
  );
  return (
    <Field label={`${t(def.label)} (${currency})`} hint={t(def.hint)} wide>
      {(p) => (
        <span className="rule-field">
          <label className="checkbox-row">
            <input type="checkbox" checked={active} disabled={!canManage} onChange={(e) => setActive(e.target.checked)} /> {t('Needs my approval')}
          </label>
          <input {...p} inputMode="decimal" value={amount} disabled={!canManage || !active} onChange={(e) => setAmount(e.target.value)} />
          {canManage && (
            <button
              type="button"
              className="button button-small"
              disabled={save.isPending}
              onClick={() => {
                const n = Number(amount || 0);
                if (!Number.isFinite(n) || n < 0) return setProblem(t('Enter an amount.'));
                setProblem(null);
                save.mutate({ actionType: def.actionType, thresholdAmount: n, isActive: active });
              }}
            >
              {t('Save')}
            </button>
          )}
          {(problem ?? save.error) ? <span className="form-error">{problem ?? (save.error as Error).message}</span> : null}
          {save.isSuccess && !save.isPending && <span className="muted">{t('Saved.')}</span>}
        </span>
      )}
    </Field>
  );
}

// ---- Notifications ----

function Notifications() {
  const t = useT();
  const { data: session } = useSession();
  const currency = useCurrency();
  const profile = useTenantProfile();
  return (
    <>
      <Panel title={t('Alerts, tolerances and photos')}>
        {profile.data ? (
          <AlertSettingsForm settings={alertSettingsOf(profile.data)} currency={currency} canEdit={hasPermission(session, 'tenant:manage')} />
        ) : (
          <SkeletonLines lines={4} />
        )}
      </Panel>
      <div className="link-list">
        <Link className="link-row" href="/vehicles#settings">
          <span className="link-row-icon" aria-hidden="true">
            <Icon name="steering" size={20} />
          </span>
          <span className="link-row-main">
            <span className="link-row-title">{t('Vehicle document reminders')}</span>
            <span className="link-row-sub">{t('How many days before insurance, permits and the rest run out')}</span>
          </span>
          <Icon name="chevron" size={18} />
        </Link>
        <Link className="link-row" href="/alerts">
          <span className="link-row-icon" aria-hidden="true">
            <Icon name="bell" size={20} />
          </span>
          <span className="link-row-main">
            <span className="link-row-title">{t('Alerts & summary')}</span>
            <span className="link-row-sub">{t('Every alert raised, and the day summary')}</span>
          </span>
          <Icon name="chevron" size={18} />
        </Link>
      </div>
    </>
  );
}
