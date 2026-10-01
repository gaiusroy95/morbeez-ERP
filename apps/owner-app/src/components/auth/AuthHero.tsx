import { Icon } from '@/components/ui/Icon';

/** The carbon brand panel beside the sign-in and signup forms. */
export function AuthHero() {
  return (
  <section className="login-hero" aria-label="Morbeez">
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        <Icon name="leaf" size={16} />
      </span>
      <span>
        Morbeez
        <span className="brand-sub">Control tower</span>
      </span>
    </div>
    <div>
      <h2 className="login-headline">
        Fresh produce, <em>run to the paisa.</em>
      </h2>
      <p className="login-lede">
        Buying, trips, sales, cash and the books for your vegetable business, in one place and always up to date.
      </p>
    </div>
    <ul className="login-chips">
      <li>Farm to customer</li>
      <li>Live trips</li>
      <li>GST-ready books</li>
    </ul>
  </section>
  );
}
