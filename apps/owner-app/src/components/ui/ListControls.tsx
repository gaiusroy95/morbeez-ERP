'use client';

import { useT } from '@/lib/i18n';

export interface FilterOption<T extends string> {
  value: T | 'all';
  label: string;
}

export function FilterTabs<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: FilterOption<T>[];
  value: T | 'all';
  onChange: (value: T | 'all') => void;
}) {
  const t = useT();
  return (
    <div className="segmented segmented-scroll" role="group" aria-label={t(label)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {t(option.label)}
        </button>
      ))}
    </div>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const t = useT();
  if (total <= pageSize) return null;
  const pages = Math.ceil(total / pageSize);
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <div className="pager">
      <span className="pager-range">
        {t('{first}–{last} of {total}', { first, last, total })}
      </span>
      <button type="button" className="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {t('Previous')}
      </button>
      <button type="button" className="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {t('Next')}
      </button>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
}) {
  const t = useT();
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">{t(title)}</h1>
        <p className="page-subtitle">{t(subtitle)}</p>
      </div>
      {actions}
    </div>
  );
}

/** A row of headline figures above a list. */
export function Figures({ items }: { items: { label: string; value: string; tone?: 'bad' | 'attention' }[] }) {
  const t = useT();
  return (
    <dl className="figures">
      {items.map((item) => (
        <div key={item.label} className="figure">
          <dt>{t(item.label)}</dt>
          <dd data-tone={item.tone}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Clickable table row: keyboard-reachable and announces its selected state. */
export function SelectableRow({
  selected,
  onSelect,
  label,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <tr
      className="row-selectable"
      aria-selected={selected}
      tabIndex={0}
      aria-label={label}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      {children}
    </tr>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  const t = useT();
  return (
    <tr>
      <td colSpan={colSpan} className="empty-cell">
        {typeof children === 'string' ? t(children) : children}
      </td>
    </tr>
  );
}
