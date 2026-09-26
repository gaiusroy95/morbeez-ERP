'use client';

import { useEffect, useRef } from 'react';

/**
 * The right-hand (desktop) or below-the-list (phone) panel showing one
 * selected record. Takes focus when it opens so keyboard and screen-reader
 * users land on what they just chose; Escape closes it. Render it with
 * key={selectedId} so choosing another record remounts (and refocuses) it.
 */
export function DetailPanel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, []);

  return (
    <section
      ref={ref}
      className="panel detail"
      aria-label={title}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="panel-header">
        <h2 className="panel-title">{title}</h2>
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function KeyValues({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="key-values">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
