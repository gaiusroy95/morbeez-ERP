import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { Providers } from './providers';

// Inter and Bricolage Grotesque (SIL OFL 1.1), variable weight, latin
// subset, kept in the repo: builds and dev servers need no network, and
// the browser loads them from this app, so the CSP's font-src 'self' holds.
const inter = localFont({
  src: './fonts/inter-latin-wght.woff2',
  weight: '100 900',
  variable: '--font-inter',
  display: 'swap',
});
const display = localFont({
  src: './fonts/bricolage-latin-wght.woff2',
  weight: '200 800',
  variable: '--font-display-face',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Morbeez',
  description: 'Morbeez ERP for vegetable wholesalers',
};

export const viewport: Viewport = {
  themeColor: '#0c1210',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${inter.variable} ${display.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
