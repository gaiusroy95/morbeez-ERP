'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { useUiStore } from '@/lib/stores/ui-store';
import { NAV } from './nav';

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

  return (
    <div className="shell">
      <nav className="sidebar" data-open={navOpen} aria-label="Main">
        <Link href="/dashboard" className="brand">
          <span className="brand-mark" aria-hidden="true">M</span>
          Morbeez
        </Link>
        {NAV.map((group) => {
          // Until the session loads, show everything rather than flash an empty menu.
          const items = group.items.filter(
            (item) => !item.permission || !session || hasPermission(session, item.permission),
          );
          if (items.length === 0) return null;
          return (
            <div key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="nav-link"
                  aria-current={pathname.startsWith(item.href) ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          );
        })}
      </nav>
      <div className="scrim" data-open={navOpen} onClick={() => setNavOpen(false)} aria-hidden="true" />

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="button menu-button"
            onClick={() => setNavOpen(!navOpen)}
            aria-expanded={navOpen}
          >
            Menu
          </button>
          <div className="topbar-spacer" />
          <div className="topbar-user">
            {session && (
              <Link href="/account" className="topbar-email" title="Your account">
                {session.email}
              </Link>
            )}
            <button type="button" className="button" onClick={signOut} disabled={signingOut}>
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
