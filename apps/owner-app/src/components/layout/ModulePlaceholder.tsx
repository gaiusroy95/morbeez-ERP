import Link from 'next/link';

export function ModulePlaceholder({
  title,
  description,
  backendReady = true,
}: {
  title: string;
  description: string;
  backendReady?: boolean;
}) {
  if (!backendReady) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">{title}</h1>
            <p className="page-subtitle">{description}</p>
          </div>
        </div>
        <div className="panel placeholder">
          <strong>Not built yet.</strong>
          <p>
            Neither the backend nor these screens exist yet. Until they do, the dashboard&apos;s profit figures are an
            operating estimate rather than ledger numbers.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle">{description}</p>
        </div>
      </div>
      <div className="panel placeholder">
        <strong>These screens are next on the build list.</strong>
        <p>
          The backend for this area is already in place; the owner-app screens for it haven&apos;t been built yet. The{' '}
          <Link href="/dashboard">dashboard</Link> already reflects its activity.
        </p>
      </div>
    </div>
  );
}
