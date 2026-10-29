'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';

export interface PickOption {
  value: string;
  label: string;
  /** A second line that search also matches, e.g. a phone number. */
  sub?: string | null;
}

/**
 * A pick-list you can search, with a "create new" button inside it (client
 * feedback: farmer, customer and product lists grow long, and the phone's
 * own dropdown can't search or add). Opens in place under the box — not as
 * an overlay, so nothing is cut off inside a dialog on a small screen.
 *
 * The trigger is a button carrying the field's id, so the field's <label>
 * still names it.
 */
export function SearchSelect({
  value,
  options,
  onChange,
  placeholder,
  searchPlaceholder,
  createLabel,
  onCreate,
  loading,
  id,
  className,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
}: {
  value: string;
  options: PickOption[];
  onChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder?: string;
  /** "Create new farmer": shown as a button at the top of the open list. */
  createLabel?: string;
  /** Called with whatever was typed in the search box, to prefill the new record's name. */
  onCreate?: (typed: string) => void;
  loading?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q) || (o.sub ?? '').toLowerCase().includes(q));
  }, [options, query]);

  // Close on a tap outside.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(Math.max(0, options.findIndex((o) => o.value === value)));
      search.current?.focus();
    }
    // Only when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const pick = (v: string) => {
    onChange(v);
    close();
  };
  const create = () => {
    const typed = query.trim();
    setOpen(false);
    onCreate?.(typed);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      // Close the list only — not the dialog it sits in.
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      // Never submit the surrounding form from the search box.
      e.preventDefault();
      if (matches[active]) pick(matches[active].value);
      else if (onCreate && query.trim()) create();
    }
  };

  return (
    <div className={`picker${className ? ` ${className}` : ''}`} ref={root} data-open={open}>
      <button
        ref={trigger}
        type="button"
        id={id}
        className="picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        onClick={() => setOpen(!open)}
      >
        <span className={selected ? 'picker-value' : 'picker-placeholder'}>
          {loading && !selected ? t('Loading…') : selected?.label ?? placeholder}
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className="picker-chevron">
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="picker-panel" onKeyDown={onKeyDown}>
          <input
            ref={search}
            type="search"
            className="picker-search"
            placeholder={searchPlaceholder ?? t('Search…')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={matches[active] ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
          />
          {onCreate && createLabel && (
            <button type="button" className="picker-create" onClick={create}>
              <span aria-hidden="true">＋</span> {query.trim() ? `${createLabel}: “${query.trim()}”` : createLabel}
            </button>
          )}
          <ul className="picker-list" role="listbox" id={listId} aria-label={placeholder}>
            {matches.length === 0 && <li className="picker-empty">{loading ? t('Loading…') : t('No match.')}</li>}
            {matches.map((o, i) => (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={o.value === value}
                data-active={i === active}
                className="picker-option"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => pick(o.value)}
                onPointerEnter={() => setActive(i)}
              >
                <span>{o.label}</span>
                {o.sub && <span className="picker-sub">{o.sub}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
