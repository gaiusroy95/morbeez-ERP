'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { useUiStore } from '@/lib/stores/ui-store';
import { useAccess } from '@/lib/hooks/use-access';
import { displayLogin } from '@/lib/phone';
import { BOTTOM_TABS, NAV, QUICK_CREATE } from './nav';
import { AlertBell } from './AlertBell';
import { LanguageSwitch } from './LanguageSwitch';
import { useI18n, useT } from '@/lib/i18n';

/** Two letters from an email; a person icon for a phone login, which has no name in it. */
function Initials({ login }: { login: string | undefined }) {
  if (!login) return <>·</>;
  if (!login.includes('@')) return <Icon name="user" size={16} />;
  const parts = login.split('@')[0].replace(/[^a-zA-Z]+/g, ' ').trim().split(' ').filter(Boolean);
  return <>{((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || login[0].toUpperCase()}</>;
}

/** Days left on the free trial, or that it has ended and the business is read-only. */
function TrialBanner() {
  const { data: access } = useAccess();
  const t = useT();
  if (!access) return null;
  if (access.state === 'ended') {
    return (
      <div className="trial-banner" data-tone="ended" role="status">
        <strong>{t('Your free trial has ended.')}</strong>{' '}
        {t('Everything is still here to see; subscribe to add or change anything again.')}
        <Link className="trial-cta" href="/account#plan">
          {t('Subscribe')}
        </Link>
      </div>
    );
  }
  if (access.state !== 'trial' || access.trialDaysLeft === null) return null;
  const days = access.trialDaysLeft;
  return (
    <div className="trial-banner" data-tone={days <= 5 ? 'soon' : 'trial'} role="status">
      <strong>{t('Free trial:')}</strong> {days <= 1 ? t('last day today') : t('{days} days left', { days })}.
      <Link className="trial-cta" href="/account#plan">
        {t('Subscribe')}
      </Link>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const navOpen = useUiStore((s) => s.navOpen);
  const setNavOpen = useUiStore((s) => s.setNavOpen);
  const [creating, setCreating] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const t = useT();
  const { lang } = useI18n();
  const allowed = (permission?: string) => !permission || !session || hasPermission(session, permission);

  // Close the drawer and the create sheet whenever the route changes.
  useEffect(() => {
    setNavOpen(false);
    setCreating(false);
  }, [pathname, setNavOpen]);

  async function signOut() {
    setSigningOut(true);
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.assign('/login');
  }

  // The page's name, for the top bar.
  const here = NAV.flatMap((g) => g.items.map((item) => ({ group: g.label, item }))).find(({ item }) =>
    pathname.startsWith(item.href),
  );
  const isHome = pathname.startsWith('/dashboard');
  const quick = QUICK_CREATE.filter((item) => allowed(item.permission));

  return (
    <div className="shell">
      <nav className="sidebar" data-open={navOpen} aria-label="Main">
        <div className="sidebar-head">
          <Link href="/dashboard" className="brand">
            <span className="brand-mark" aria-hidden="true">
              <Icon name="leaf" size={18} />
            </span>
            <span>
              MORBEEZ
              <span className="brand-sub">{session ? displayLogin(session.login) : t('Control tower')}</span>
            </span>
          </Link>
          <button type="button" className="icon-button sidebar-close" onClick={() => setNavOpen(false)} aria-label={t('Close')}>
            <Icon name="close" />
          </button>
        </div>

        <div className="nav-scroll">
          {NAV.map((group) => {
            // Until the session loads, show everything rather than flash an empty menu.
            const items = group.items.filter((item) => allowed(item.permission));
            if (items.length === 0) return null;
            return (
              <div key={group.label} className="nav-group">
                <div className="nav-group-label">{t(group.label)}</div>
                {items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="nav-link"
                    aria-current={pathname.startsWith(item.href) ? 'page' : undefined}
                  >
                    <Icon name={item.icon} className="nav-icon" />
                    {t(item.label)}
                  </Link>
                ))}
              </div>
            );
          })}
        </div>

        <div className="sidebar-foot">
          <Link href="/account" className="foot-link">
            <Icon name="user" size={16} />
            {t('Profile')}
          </Link>
          <span className="foot-link foot-lang">
            <Icon name="globe" size={16} />
            <LanguageSwitch />
          </span>
          <button type="button" className="foot-link foot-logout" onClick={signOut} disabled={signingOut}>
            <Icon name="logout" size={16} />
            {signingOut ? t('Signing out…') : t('Logout')}
          </button>
        </div>
      </nav>
      <div className="scrim" data-open={navOpen} onClick={() => setNavOpen(false)} aria-hidden="true" />

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="icon-button menu-button"
            onClick={() => setNavOpen(!navOpen)}
            aria-expanded={navOpen}
            aria-label={t('Menu')}
          >
            <Icon name="menu" />
          </button>
          {isHome ? (
            <Link href="/dashboard" className="topbar-brand">
              <span className="brand-mark" aria-hidden="true">
                <Icon name="leaf" size={16} />
              </span>
              <span>
                MORBEEZ
                <span className="topbar-brand-sub">{t('Owner')}</span>
              </span>
            </Link>
          ) : (
            here && <h2 className="topbar-title">{t(here.item.label)}</h2>
          )}
          <div className="topbar-spacer" />
          <span className="topbar-date">
            {new Date().toLocaleDateString(`${lang}-IN`, { weekday: 'short', day: 'numeric', month: 'short' })}
          </span>
          <span className="topbar-lang">
            <LanguageSwitch />
          </span>
          {hasPermission(session, 'dashboard:read') && <AlertBell />}
          {session && (
            // topbar-email: present once the session has loaded (the e2e suites wait on it).
            <Link href="/account" className="avatar avatar-link topbar-email" title={displayLogin(session.login)}>
              <Initials login={session.login} />
            </Link>
          )}
          <button type="button" className="button button-ghost topbar-signout" onClick={signOut} disabled={signingOut}>
            {signingOut ? t('Signing out…') : t('Sign out')}
          </button>
        </header>
        <main className="content">
          <TrialBanner />
          {children}
        </main>
      </div>

      {/* Phones only (CSS): Home · Operations · (+) · Finance · More. */}
      <nav className="bottom-nav" aria-label={t('Quick links')}>
        {BOTTOM_TABS.map((tab) => {
          if (tab.kind === 'create') {
            if (quick.length === 0) return null;
            return (
              <button
                key="create"
                type="button"
                className="bottom-nav-fab"
                aria-label={t('Create')}
                aria-expanded={creating}
                onClick={() => setCreating(!creating)}
              >
                <Icon name="plus" size={26} />
              </button>
            );
          }
          if (tab.kind === 'more') {
            return (
              <button key="more" type="button" className="bottom-nav-link" aria-expanded={navOpen} onClick={() => setNavOpen(true)}>
                <Icon name="menu" size={22} />
                <span>{t('More')}</span>
              </button>
            );
          }
          if (!allowed(tab.permission)) return null;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="bottom-nav-link"
              aria-current={pathname.startsWith(tab.href) ? 'page' : undefined}
            >
              <Icon name={tab.icon} size={22} />
              <span>{t(tab.label)}</span>
            </Link>
          );
        })}
      </nav>

      {creating && (
        <>
          <div className="sheet-scrim" onClick={() => setCreating(false)} aria-hidden="true" />
          <div className="create-sheet" role="dialog" aria-label={t('Create')}>
            <div className="create-sheet-title">{t('Create')}</div>
            {quick.map((item) => (
              <Link key={item.href} href={item.href} className="create-sheet-item" onClick={() => setCreating(false)}>
                <span className="create-sheet-icon" aria-hidden="true">
                  <Icon name={item.icon} size={20} />
                </span>
                {t(item.label)}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
