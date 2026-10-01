import { NextRequest, NextResponse } from 'next/server';

// Mirrors REFRESH_COOKIE in src/lib/server/session.ts — middleware runs on
// the edge runtime, so it can't import that Node-only module.
const REFRESH_COOKIE = 'mz_rt';

// A page request with no session at all goes to sign-in. Whether the
// session is still *valid* is the proxy's and the backend's call — this
// only saves a signed-out visitor from loading an app shell full of 401s.
export function middleware(request: NextRequest) {
  if (request.cookies.has(REFRESH_COOKIE)) return NextResponse.next();

  const login = new URL('/login', request.url);
  const next = request.nextUrl.pathname + request.nextUrl.search;
  if (next !== '/') login.searchParams.set('next', next);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/((?!api/|_next/|login|signup|favicon.ico).*)'],
};
