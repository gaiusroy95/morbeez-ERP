import { ApiError } from '@/lib/api/client';

export function Panel({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel" aria-label={title}>
      <div className="panel-header">
        <h2 className="panel-title">{title}</h2>
        {meta && <span className="panel-meta">{meta}</span>}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function SkeletonLines({ lines = 3, height = 18 }: { lines?: number; height?: number }) {
  return (
    <div style={{ display: 'grid', gap: 10 }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton" style={{ height, width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message =
    error instanceof ApiError && error.status === 403
      ? "You don't have access to this."
      : error instanceof Error
        ? error.message
        : 'Something went wrong.';
  return (
    <div className="state state-error" role="alert">
      <span>{message}</span>
      <button type="button" className="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
