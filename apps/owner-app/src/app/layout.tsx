import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { cookies } from 'next/headers';
import { Providers } from './providers';
import { isLang, LANG_COOKIE } from '@/lib/i18n/langs';

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
  // The person's language, from the cookie the language switch sets, so the
  // first paint is already in it.
  const chosen = cookies().get(LANG_COOKIE)?.value;
  const lang = isLang(chosen) ? chosen : 'en';
  return (
    <html lang={`${lang}-IN`} className={`${inter.variable} ${display.variable}`}>
      <body>
        <Providers lang={lang}>{children}</Providers>
      </body>
    </html>
  );
}
