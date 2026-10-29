import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, forwardedFor } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

// A staff member's one-time password set-up link (sent by the owner). They
// aren't signed in, so this goes to the backend's public endpoints
// directly, never through the session proxy — and signs nobody in: after
// choosing a password they sign in to the app as usual.

async function forward(request: NextRequest, init: RequestInit & { path: string }): Promise<NextResponse> {
  let upstream: Response;
  try {
    upstream = await fetch(`${apiBaseUrl()}/${init.path}`, {
      method: init.method,
      headers: { accept: 'application/json', 'content-type': 'application/json', ...forwardedFor(request) },
      body: init.body,
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ error: { message: "Can't reach Morbeez. Check your connection and try again." } }, { status: 502 });
  }
  const body = await upstream.json().catch(() => null);
  return NextResponse.json(body ?? {}, { status: upstream.status });
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? '';
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) {
    return NextResponse.json({ error: { message: 'This link is not valid. Ask for a new one.' } }, { status: 404 });
  }
  return forward(request, { method: 'GET', path: `auth/password-setup/${token}` });
}

export async function POST(request: NextRequest) {
  let form: { token?: unknown; password?: unknown };
  try {
    form = await request.json();
  } catch {
    return NextResponse.json({ error: { message: 'Send the link and a password.' } }, { status: 400 });
  }
  if (typeof form.token !== 'string' || typeof form.password !== 'string') {
    return NextResponse.json({ error: { message: 'Send the link and a password.' } }, { status: 400 });
  }
  return forward(request, { method: 'POST', path: 'auth/password-setup', body: JSON.stringify({ token: form.token, password: form.password }) });
}
