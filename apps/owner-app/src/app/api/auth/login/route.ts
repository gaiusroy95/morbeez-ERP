import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, setSessionCookies, TokenPair } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let credentials: { email?: unknown; password?: unknown };
  try {
    credentials = await request.json();
  } catch {
    return NextResponse.json({ error: { message: 'Send an email and password.' } }, { status: 400 });
  }
  if (typeof credentials.email !== 'string' || typeof credentials.password !== 'string') {
    return NextResponse.json({ error: { message: 'Send an email and password.' } }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${apiBaseUrl()}/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': request.headers.get('user-agent') ?? 'morbeez-owner-app',
      },
      body: JSON.stringify({ email: credentials.email, password: credentials.password }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { error: { message: "Can't reach the Morbeez server. Check your connection and try again." } },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    // The backend deliberately returns the same message for an unknown
    // email and a wrong password; pass that through unchanged.
    const body = await upstream.json().catch(() => null);
    return NextResponse.json(body ?? { error: { message: 'Login failed.' } }, { status: upstream.status });
  }

  const tokens = (await upstream.json()) as TokenPair;
  const response = NextResponse.json({ ok: true });
  setSessionCookies(response, tokens);
  return response;
}
