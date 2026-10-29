'use client';

import type { ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useT } from '@/lib/i18n';

/**
 * The list pieces of the client's design (V1.1): Today / Tomorrow / All
 * tabs with counts, a search box with a filter, and one card per record —
 * number, name and place, what and how much, time, person, vehicle,
 * status. Used by Procurement, Delivery Orders and Trips.
 */

export function DayTabs<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (value: T) => void;
  label: string;
}) {
  const t = useT();
  return (
    <div className="day-tabs" role="group" aria-label={t(label)}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {t(o.label)}
          {o.count !== undefined && ` (${o.count})`}
        </button>
      ))}
    </div>
  );
}

export function SearchFilter({
  value,
  onChange,
  placeholder,
  filter,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** A small select for status, beside the search box. */
  filter?: { value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; label: string };
}) {
  const t = useT();
  return (
    <div className="search-filter">
      <label className="search-box">
        <Icon name="search" size={18} />
        <span className="visually-hidden">{t(placeholder)}</span>
        <input type="search" placeholder={t(placeholder)} value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
      {filter && (
        <label className="filter-select" title={t(filter.label)}>
          <Icon name="filter" size={18} />
          <span className="visually-hidden">{t(filter.label)}</span>
          <select value={filter.value} onChange={(e) => filter.onChange(e.target.value)}>
            {filter.options.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.label)}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

export type CardTone = 'pending' | 'progress' | 'done' | 'bad' | 'muted';

export function ListCard({
  number,
  title,
  place,
  detail,
  time,
  status,
  tone,
  person,
  vehicle,
  initial,
  selected,
  onOpen,
}: {
  number: string;
  title: string;
  place?: string | null;
  detail?: ReactNode;
  time?: string | null;
  status: string;
  tone: CardTone;
  person?: string | null;
  vehicle?: string | null;
  /** The letter in the round badge on the left (the product's first letter). */
  initial: string;
  selected?: boolean;
  onOpen: () => void;
}) {
  const t = useT();
  return (
    <button type="button" className="list-card" data-tone={tone} aria-current={selected || undefined} onClick={onOpen}>
      <span className="list-card-badge" aria-hidden="true">
        {initial.slice(0, 1).toUpperCase()}
      </span>
      <span className="list-card-main">
        <span className="list-card-number">{number}</span>
        <span className="list-card-title">{title}</span>
        {place && <span className="list-card-place">{place}</span>}
        {detail && <span className="list-card-detail">{detail}</span>}
      </span>
      <span className="list-card-side">
        <span className="list-card-time">{time ?? '—'}</span>
        <span className="list-card-status" data-tone={tone}>
          {t(status)}
        </span>
      </span>
      {(person || vehicle) && (
        <span className="list-card-foot">
          <span>
            <Icon name="user" size={14} /> {person ?? t('Not assigned')}
          </span>
          <span>
            <Icon name="truck" size={14} /> {vehicle ?? t('No vehicle')}
          </span>
        </span>
      )}
    </button>
  );
}

/** The wide green button at the end of a list ("+ Create Procurement"). */
export function CreateBar({ label, onClick }: { label: string; onClick: () => void }) {
  const t = useT();
  return (
    <button type="button" className="create-bar" onClick={onClick}>
      <Icon name="plus" size={20} /> {t(label)}
    </button>
  );
}
