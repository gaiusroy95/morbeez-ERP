import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, forwardedFor, setSessionCookies, TokenPair } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

// Creates the business (POST /tenants) and signs its owner in, the way
// /api/auth/login does: the tokens go into httpOnly cookies, never to the
// page.
export async function POST(request: NextRequest) {
  let form: { businessName?: unknown; ownerPhone?: unknown; ownerPassword?: unknown };
  try {
    form = await request.json();
  } catch {
    return NextResponse.json({ error: { message: 'Send a business name, mobile number and password.' } }, { status: 400 });
  }
  if (typeof form.businessName !== 'string' || typeof form.ownerPhone !== 'string' || typeof form.ownerPassword !== 'string') {
    return NextResponse.json({ error: { message: 'Send a business name, mobile number and password.' } }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${apiBaseUrl()}/tenants`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': request.headers.get('user-agent') ?? 'morbeez-owner-app',
        ...forwardedFor(request),
      },
      body: JSON.stringify({ businessName: form.businessName, ownerPhone: form.ownerPhone, ownerPassword: form.ownerPassword }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { error: { message: "Can't reach the Morbeez server. Check your connection and try again." } },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    const body = await upstream.json().catch(() => null);
    return NextResponse.json(body ?? { error: { message: 'Could not create the account.' } }, { status: upstream.status });
  }

  const tokens = (await upstream.json()) as TokenPair;
  const response = NextResponse.json({ ok: true });
  setSessionCookies(response, tokens);
  return response;
}
