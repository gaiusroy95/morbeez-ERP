import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, forwardedFor, setSessionCookies, TokenPair } from '@/lib/server/session';
import { isLang, LANG_COOKIE } from '@/lib/i18n/langs';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let credentials: { login?: unknown; email?: unknown; password?: unknown };
  try {
    credentials = await request.json();
  } catch {
    return NextResponse.json({ error: { message: 'Send a mobile number and password.' } }, { status: 400 });
  }
  // `email`: older pages, until every open tab has reloaded.
  const login = credentials.login ?? credentials.email;
  if (typeof login !== 'string' || typeof credentials.password !== 'string') {
    return NextResponse.json({ error: { message: 'Send a mobile number and password.' } }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${apiBaseUrl()}/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': request.headers.get('user-agent') ?? 'morbeez-owner-app',
        ...forwardedFor(request),
      },
      body: JSON.stringify({ login, password: credentials.password }),
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
    // login and a wrong password; pass that through unchanged.
    const body = await upstream.json().catch(() => null);
    return NextResponse.json(body ?? { error: { message: 'Login failed.' } }, { status: upstream.status });
  }

  const tokens = (await upstream.json()) as TokenPair;
  // The person's language (client Q&A: chosen per user): a choice already
  // made on this device goes to their account; with none, the one they
  // chose before — on any device — is used here too.
  const chosenHere = request.cookies.get(LANG_COOKIE)?.value;
  let language: string | null = null;
  try {
    const prefs = await fetch(`${apiBaseUrl()}/users/me/preferences`, {
      method: isLang(chosenHere) ? 'PATCH' : 'GET',
      headers: { authorization: `Bearer ${tokens.accessToken}`, 'content-type': 'application/json' },
      body: isLang(chosenHere) ? JSON.stringify({ language: chosenHere }) : undefined,
      cache: 'no-store',
    });
    if (prefs.ok) language = ((await prefs.json()) as { language?: string }).language ?? null;
  } catch {
    // Signing in never fails over a display preference.
  }
  const response = NextResponse.json({ ok: true, language });
  setSessionCookies(response, tokens);
  if (!isLang(chosenHere) && isLang(language)) {
    response.cookies.set(LANG_COOKIE, language, { path: '/', maxAge: 31_536_000, sameSite: 'lax' });
  }
  return response;
}
