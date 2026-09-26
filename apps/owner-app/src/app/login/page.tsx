'use client';

import { FormEvent, Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

// Only same-app paths — `next` comes from the URL, so an absolute or
// protocol-relative value would otherwise be an open redirect.
function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/dashboard';
  return next;
}

function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
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
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(body?.error?.message ?? 'Sign-in failed. Try again.');
        return;
      }
      // A full navigation, so every query starts fresh under the new session.
      window.location.assign(safeNext(searchParams.get('next')));
    } catch {
      setError("Can't reach Morbeez. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="panel login-card" onSubmit={onSubmit} noValidate>
      <div>
        <div className="brand" style={{ padding: 0, marginBottom: 6 }}>
          <span className="brand-mark" aria-hidden="true">M</span>
          Morbeez
        </div>
        <h1 className="page-title">Sign in</h1>
        <p className="page-subtitle">Use the email and password your administrator gave you.</p>
      </div>

      {error && (
        <div className="login-error" role="alert">
          {error}
        </div>
      )}

      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>

      <button className="button button-primary" type="submit" disabled={submitting || !email || !password}>
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="login-page">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
