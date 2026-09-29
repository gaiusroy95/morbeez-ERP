import { NextResponse } from 'next/server';

// Server-side only: imported by route handlers under src/app/api, never by
// a client component (it reads Buffer and process.env.API_BASE_URL).

// The browser never holds a JWT. Tokens live in httpOnly cookies that only
// these Next.js route handlers read; every backend call goes through
// /api/backend/*, which attaches the access token server-side. An XSS bug
// in the page can call the proxy while the tab is open, but can't steal a
// token to use elsewhere.
export const ACCESS_COOKIE = 'mz_at';
export const REFRESH_COOKIE = 'mz_rt';

// Matches the backend's TokenService TTLs.
const ACCESS_MAX_AGE_SECONDS = 15 * 60;
const REFRESH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface SessionClaims {
  userId: string;
  tenantId: string;
  email: string;
  roles: string[];
  permissions: string[];
  expiresAt: number; // epoch seconds
}

export function apiBaseUrl(): string {
  const value = process.env.API_BASE_URL;
  if (!value) throw new Error('API_BASE_URL is not set — see apps/owner-app/.env.example');
  return value.replace(/\/+$/, '');
}

export function setSessionCookies(response: NextResponse, tokens: TokenPair): void {
  const secure = process.env.NODE_ENV === 'production';
  response.cookies.set(ACCESS_COOKIE, tokens.accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: ACCESS_MAX_AGE_SECONDS,
  });
  response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: REFRESH_MAX_AGE_SECONDS,
  });
}

export function clearSessionCookies(response: NextResponse): void {
  response.cookies.delete(ACCESS_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
}

// The backend rotates refresh tokens on every use, so two requests racing
// to refresh with the same token would log the user out (the second one
// presents an already-revoked token). A dashboard fires four queries at
// once, so this is the normal case, not an edge case: concurrent refreshes
// for the same token share one backend call. Scope is this server process —
// running several Next.js instances needs sticky sessions or a shared store.
const inFlight = new Map<string, Promise<TokenPair | null>>();
const RECENT_RESULT_MS = 10_000;

/**
 * The browser's address, passed on to the backend so its per-IP sign-in
 * limits count each person separately rather than this server as one
 * caller (Security Audit SA-02). Only the hop in front of this app (a load
 * balancer in production) can be trusted to have set it; the backend's
 * TRUST_PROXY decides how far back it believes the chain.
 */
export function forwardedFor(request: { headers: Headers }): Record<string, string> {
  const chain = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');
  return chain ? { 'x-forwarded-for': chain } : {};
}

export function refreshTokens(refreshToken: string, forwarded: Record<string, string> = {}): Promise<TokenPair | null> {
  const existing = inFlight.get(refreshToken);
  if (existing) return existing;

  const attempt = (async () => {
    const response = await fetch(`${apiBaseUrl()}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...forwarded },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const body = (await response.json()) as TokenPair;
    return { accessToken: body.accessToken, refreshToken: body.refreshToken };
  })().catch(() => null);

  inFlight.set(refreshToken, attempt);
  // Kept briefly after settling so slightly-staggered requests still reuse it.
  attempt.finally(() => setTimeout(() => inFlight.delete(refreshToken), RECENT_RESULT_MS));
  return attempt;
}

/**
 * Reads the claims out of an access token WITHOUT verifying its signature —
 * only ever used to decide what to show (menu items, the profit panel).
 * The backend verifies the token on every request; nothing here is an
 * authorization decision (System Architecture FE.5).
 */
export function decodeAccessToken(token: string): SessionClaims | null {
  const [, payload] = token.split('.');
  if (!payload) return null;
  try {
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sub: string;
      tenantId: string;
      email: string;
      roles?: string[];
      permissions?: string[];
      exp: number;
    };
    return {
      userId: json.sub,
      tenantId: json.tenantId,
      email: json.email,
      roles: json.roles ?? [],
      permissions: json.permissions ?? [],
      expiresAt: json.exp,
    };
  } catch {
    return null;
  }
}

export function isExpired(claims: SessionClaims, skewSeconds = 30): boolean {
  return claims.expiresAt - skewSeconds <= Math.floor(Date.now() / 1000);
}
