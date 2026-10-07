'use client';

import { Icon } from '@/components/ui/Icon';
import { useT } from '@/lib/i18n';

/** The carbon brand panel beside the sign-in and signup forms. */
export function AuthHero() {
  const t = useT();
  return (
  <section className="login-hero" aria-label="Morbeez">
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        <Icon name="leaf" size={16} />
      </span>
      <span>
        Morbeez
        <span className="brand-sub">{t('Control tower')}</span>
      </span>
    </div>
    <div>
      <h2 className="login-headline">
        {t('Fresh produce,')} <em>{t('run to the paisa.')}</em>
      </h2>
      <p className="login-lede">
        {t('Buying, trips, sales, cash and the books for your vegetable business, in one place and always up to date.')}
      </p>
    </div>
    <ul className="login-chips">
      <li>{t('Farm to customer')}</li>
      <li>{t('Live trips')}</li>
      <li>{t('GST-ready books')}</li>
    </ul>
  </section>
  );
}
