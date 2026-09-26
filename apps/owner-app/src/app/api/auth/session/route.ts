import { NextRequest, NextResponse } from 'next/server';
import {
  ACCESS_COOKIE,
  clearSessionCookies,
  decodeAccessToken,
  isExpired,
  REFRESH_COOKIE,
  refreshTokens,
  setSessionCookies,
  TokenPair,
} from '@/lib/server/session';

export const dynamic = 'force-dynamic';

// Who's signed in and what they may see — for UI decisions only (hide a
// menu item, skip the profit panel). The backend re-checks every request.
export async function GET(request: NextRequest) {
  const access = request.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;

  let claims = access ? decodeAccessToken(access) : null;
  let rotated: TokenPair | null = null;

  if ((!claims || isExpired(claims)) && refresh) {
    rotated = await refreshTokens(refresh);
    claims = rotated ? decodeAccessToken(rotated.accessToken) : null;
  }

  if (!claims) {
    const response = NextResponse.json({ error: { message: 'Not signed in.' } }, { status: 401 });
    clearSessionCookies(response);
    return response;
  }

  const response = NextResponse.json({
    email: claims.email,
    roles: claims.roles,
    permissions: claims.permissions,
  });
  if (rotated) setSessionCookies(response, rotated);
  return response;
}
