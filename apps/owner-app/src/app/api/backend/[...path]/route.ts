import { NextRequest, NextResponse } from 'next/server';
import {
  ACCESS_COOKIE,
  apiBaseUrl,
  clearSessionCookies,
  REFRESH_COOKIE,
  refreshTokens,
  setSessionCookies,
  TokenPair,
} from '@/lib/server/session';

export const dynamic = 'force-dynamic';

const BODYLESS = new Set(['GET', 'HEAD']);

function unauthorized(): NextResponse {
  const response = NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Your session has ended. Sign in again.' } }, { status: 401 });
  clearSessionCookies(response);
  return response;
}

/**
 * The only path from the browser to the backend. Attaches the access
 * token from its httpOnly cookie, refreshes it transparently when it has
 * expired, and passes the backend's status and body straight through —
 * authorization stays entirely the backend's decision.
 */
async function proxy(request: NextRequest, { params }: { params: { path: string[] } }) {
  if (params.path.some((segment) => segment === '.' || segment === '..' || segment === '')) {
    return NextResponse.json({ error: { message: 'Invalid path.' } }, { status: 400 });
  }

  // SameSite=Lax cookies already aren't sent on cross-site POSTs; this is
  // the second layer for anything that changes state.
  if (!BODYLESS.has(request.method)) {
    const origin = request.headers.get('origin');
    if (origin && new URL(origin).host !== request.nextUrl.host) {
      return NextResponse.json({ error: { message: 'Cross-origin request refused.' } }, { status: 403 });
    }
  }

  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  let access = request.cookies.get(ACCESS_COOKIE)?.value;
  let rotated: TokenPair | null = null;

  if (!access && refresh) {
    rotated = await refreshTokens(refresh);
    access = rotated?.accessToken;
  }
  if (!access) return unauthorized();

  const url = `${apiBaseUrl()}/${params.path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`;
  const body = BODYLESS.has(request.method) ? undefined : await request.arrayBuffer();
  const send = (token: string) =>
    fetch(url, {
      method: request.method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(request.headers.get('content-type') ? { 'content-type': request.headers.get('content-type') as string } : {}),
      },
      body,
      cache: 'no-store',
    });

  let upstream: Response;
  try {
    upstream = await send(access);
    if (upstream.status === 401 && refresh && !rotated) {
      rotated = await refreshTokens(refresh);
      if (rotated) upstream = await send(rotated.accessToken);
    }
  } catch {
    return NextResponse.json(
      { error: { code: 'UPSTREAM_UNAVAILABLE', message: "Can't reach the Morbeez server right now." } },
      { status: 502 },
    );
  }

  if (upstream.status === 401) return unauthorized();

  const response = new NextResponse(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
  if (rotated) setSessionCookies(response, rotated);
  return response;
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
