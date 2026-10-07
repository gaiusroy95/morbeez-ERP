'use client';

import { ApiError } from '@/lib/api/client';
import { useT } from '@/lib/i18n';

export function Panel({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <section className="panel" aria-label={t(title)}>
      <div className="panel-header">
        <h2 className="panel-title">{t(title)}</h2>
        {meta && <span className="panel-meta">{typeof meta === 'string' ? t(meta) : meta}</span>}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function SkeletonLines({ lines = 3, height = 18 }: { lines?: number; height?: number }) {
  const t = useT();
  return (
    <div style={{ display: 'grid', gap: 10 }} aria-busy="true" aria-label={t('Loading')}>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton" style={{ height, width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useT();
  const message =
    error instanceof ApiError && error.status === 403
      ? t("You don't have access to this.")
      : error instanceof Error
        ? error.message
        : t('Something went wrong.');
  return (
    <div className="state state-error" role="alert">
      <span>{message}</span>
      <button type="button" className="button" onClick={onRetry}>
        {t('Try again')}
      </button>
    </div>
  );
}
