// Security headers on every page and API route (Security Audit SA-10). The
// backend sets its own through helmet, but this app is what the browser
// actually loads: without frame-ancestors, another site could frame it and
// steer a signed-in owner's clicks onto "Approve" or "Record payment".
// Next's hydration uses inline scripts, hence 'unsafe-inline'; the dev
// server additionally needs eval for fast refresh.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A self-contained server for the container image (apps/owner-app/Dockerfile
  // sets NEXT_OUTPUT), traced from the repository root so the workspace
  // packages come along. Off for local builds: it links files, which Windows
  // refuses without developer mode.
  ...(process.env.NEXT_OUTPUT === 'standalone' && {
    output: 'standalone',
    experimental: { outputFileTracingRoot: require('path').join(__dirname, '../../') },
  }),
  poweredByHeader: false,
  // Workspace packages ship TypeScript source, not built JS.
  transpilePackages: ['@morbeez/shared-types', '@morbeez/ui-kit'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

module.exports = nextConfig;
