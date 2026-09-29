import { NextRequest, NextResponse } from 'next/server';
import {
  ACCESS_COOKIE,
  apiBaseUrl,
  clearSessionCookies,
  REFRESH_COOKIE,
  forwardedFor,
  refreshTokens,
} from '@/lib/server/session';

export const dynamic = 'force-dynamic';

// Revokes the server-side session (identity.auth_session), not just the
// cookies — a copied refresh token stops working too. Cookies are cleared
// whether or not the backend call succeeds.
export async function POST(request: NextRequest) {
  let access = request.cookies.get(ACCESS_COOKIE)?.value;
  let refresh = request.cookies.get(REFRESH_COOKIE)?.value;

  if (refresh) {
    if (!access) {
      const rotated = await refreshTokens(refresh, forwardedFor(request));
      access = rotated?.accessToken;
      refresh = rotated?.refreshToken ?? refresh;
    }
    if (access) {
      await fetch(`${apiBaseUrl()}/auth/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${access}` },
        body: JSON.stringify({ refreshToken: refresh }),
        cache: 'no-store',
      }).catch(() => undefined);
    }
  }

  const response = NextResponse.json({ ok: true });
  clearSessionCookies(response);
  return response;
}
