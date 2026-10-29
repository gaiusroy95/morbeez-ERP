'use client';

import Link from 'next/link';
import { useState } from 'react';
import { OPERATIONS } from '@/components/layout/nav';
import { Icon } from '@/components/ui/Icon';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { useT } from '@/lib/i18n';

/** The Operations hub (client design V1.1, screen 2): every core operation, one tap away. */
export default function OperationsPage() {
  const t = useT();
  const { data: session } = useSession();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const tiles = OPERATIONS.filter((o) => !o.permission || !session || hasPermission(session, o.permission)).filter(
    (o) => !q || t(o.label).toLowerCase().includes(q) || t(o.description).toLowerCase().includes(q) || o.label.toLowerCase().includes(q),
  );
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <h1 className="page-title visually-hidden">{t('Operations')}</h1>
      <label className="search-box">
        <Icon name="search" size={18} />
        <span className="visually-hidden">{t('Search operations')}</span>
        <input type="search" placeholder={t('Search operations…')} value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="tile-grid">
        {tiles.map((o) => (
          <Link key={o.href + o.label} href={o.href} className="op-tile">
            <span className="op-tile-icon" data-tone={o.icon === 'alert' ? 'bad' : undefined} aria-hidden="true">
              <Icon name={o.icon} size={28} />
            </span>
            <span className="op-tile-name">{t(o.label)}</span>
            <span className="op-tile-sub">{t(o.description)}</span>
          </Link>
        ))}
        {tiles.length === 0 && <p className="muted">{t('No match.')}</p>}
      </div>
    </div>
  );
}
