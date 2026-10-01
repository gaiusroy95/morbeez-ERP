'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { useUiStore } from '@/lib/stores/ui-store';
import { useAccess } from '@/lib/hooks/use-access';
import { displayLogin } from '@/lib/phone';
import { NAV } from './nav';

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
  if (!access) return null;
  if (access.state === 'ended') {
    return (
      <div className="trial-banner" data-tone="ended" role="status">
        <strong>Your free trial has ended.</strong> Everything is still here to see; subscribe to add or change anything
        again.
        <Link className="trial-cta" href="/account#plan">
          Subscribe
        </Link>
      </div>
    );
  }
  if (access.state !== 'trial' || access.trialDaysLeft === null) return null;
  const days = access.trialDaysLeft;
  return (
    <div className="trial-banner" data-tone={days <= 5 ? 'soon' : 'trial'} role="status">
      <strong>Free trial:</strong> {days <= 1 ? 'last day today' : `${days} days left`}.
      <Link className="trial-cta" href="/account#plan">
        Subscribe
      </Link>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const navOpen = useUiStore((s) => s.navOpen);
  const setNavOpen = useUiStore((s) => s.setNavOpen);
  const [signingOut, setSigningOut] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setNavOpen(false), [pathname, setNavOpen]);

  async function signOut() {
    setSigningOut(true);
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.assign('/login');
  }

  // Where you are, for the top bar: "Trading / Orders".
  const here = NAV.flatMap((g) => g.items.map((item) => ({ group: g.label, item }))).find(({ item }) =>
    pathname.startsWith(item.href),
  );

  return (
    <div className="shell">
      <nav className="sidebar" data-open={navOpen} aria-label="Main">
        <div className="sidebar-head">
          <Link href="/dashboard" className="brand">
            <span className="brand-mark" aria-hidden="true">
              <Icon name="leaf" size={16} />
            </span>
            <span>
              Morbeez
              <span className="brand-sub">Control tower</span>
            </span>
          </Link>
          <button type="button" className="icon-button sidebar-close" onClick={() => setNavOpen(false)} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        <div className="nav-scroll">
          {NAV.map((group) => {
            // Until the session loads, show everything rather than flash an empty menu.
            const items = group.items.filter(
              (item) => !item.permission || !session || hasPermission(session, item.permission),
            );
            if (items.length === 0) return null;
            return (
              <div key={group.label} className="nav-group">
                <div className="nav-group-label">{group.label}</div>
                {items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="nav-link"
                    aria-current={pathname.startsWith(item.href) ? 'page' : undefined}
                  >
                    <Icon name={item.icon} className="nav-icon" />
                    {item.label}
                  </Link>
                ))}
              </div>
            );
          })}
        </div>

        <div className="sidebar-foot">
          <Link href="/account" className="me" title="Your account">
            <span className="avatar" aria-hidden="true">
              <Initials login={session?.login} />
            </span>
            <span className="me-text">
              <span className="me-name">{session ? displayLogin(session.login) : 'Your account'}</span>
              <span className="me-role">Signed in</span>
            </span>
          </Link>
          <button type="button" className="icon-button" onClick={signOut} disabled={signingOut} aria-label="Sign out" title="Sign out">
            <Icon name="logout" />
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
            aria-label="Menu"
          >
            <Icon name="menu" />
          </button>
          {here && (
            <div className="crumbs">
              <span className="crumb-group">{here.group}</span>
              <Icon name="chevron" size={14} className="crumb-sep" />
              <span className="crumb-page">{here.item.label}</span>
            </div>
          )}
          <div className="topbar-spacer" />
          <span className="topbar-date">
            {new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
          </span>
          {session && (
            // topbar-email: present once the session has loaded (the e2e suites wait on it).
            <Link href="/account" className="avatar avatar-link topbar-email" title={displayLogin(session.login)}>
              <Initials login={session.login} />
            </Link>
          )}
          <button type="button" className="button button-ghost topbar-signout" onClick={signOut} disabled={signingOut}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </header>
        <main className="content">
          <TrialBanner />
          {children}
        </main>
      </div>
    </div>
  );
}
