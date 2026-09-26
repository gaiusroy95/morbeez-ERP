/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source, not built JS.
  transpilePackages: ['@morbeez/shared-types', '@morbeez/ui-kit'],
};

module.exports = nextConfig;
