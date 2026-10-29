'use client';

import type { DashboardRange, RangeName } from '@morbeez/shared-types';
import type { Range } from '@/lib/hooks/use-money-stock';
import { DayTabs } from './ListCards';
import { useI18n, useT } from '@/lib/i18n';

export const RANGE_OPTIONS: { value: RangeName; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'custom', label: 'Custom' },
];

/** "01 Oct – 28 Oct 2026", in the app's language. */
export function useRangeText() {
  const { lang } = useI18n();
  return (range: DashboardRange | undefined) => {
    if (!range) return '';
    const day = (iso: string, year: boolean) =>
      new Date(`${iso}T00:00:00Z`).toLocaleDateString(`${lang}-IN`, { timeZone: 'UTC', day: '2-digit', month: 'short', ...(year ? { year: 'numeric' } : {}) });
    return range.from === range.to ? day(range.to, true) : `${day(range.from, false)} – ${day(range.to, true)}`;
  };
}

/** From and to, for a custom period. */
export function CustomDates({ range, onChange }: { range: Range; onChange: (range: Range) => void }) {
  const t = useT();
  if (range.name !== 'custom') return null;
  return (
    <div className="custom-dates">
      <label>
        <span>{t('From')}</span>
        <input type="date" value={range.from ?? ''} onChange={(e) => onChange({ ...range, from: e.target.value })} />
      </label>
      <label>
        <span>{t('To')}</span>
        <input type="date" value={range.to ?? ''} onChange={(e) => onChange({ ...range, to: e.target.value })} />
      </label>
    </div>
  );
}

/** Finance's period (design: "This Month ▾  01 Sep – 30 Sep 2025"). */
export function RangeSelect({ range, onChange, shown }: { range: Range; onChange: (range: Range) => void; shown?: DashboardRange }) {
  const t = useT();
  const text = useRangeText();
  const labels: Record<RangeName, string> = { today: 'Today', week: 'Last 7 days', month: 'This Month', custom: 'Custom' };
  return (
    <>
      <div className="range-select">
        <select aria-label={t('Period')} value={range.name} onChange={(e) => onChange({ name: e.target.value as RangeName, from: range.from, to: range.to })}>
          {RANGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(labels[o.value])}
            </option>
          ))}
        </select>
        <span className="range-text">{text(shown)}</span>
      </div>
      <CustomDates range={range} onChange={onChange} />
    </>
  );
}

/** Profit & Insights' period (design: Today · Week · Month · Custom). */
export function RangeTabs({ range, onChange }: { range: Range; onChange: (range: Range) => void }) {
  return (
    <>
      <DayTabs label="Period" value={range.name} onChange={(name) => onChange({ ...range, name })} options={RANGE_OPTIONS} />
      <CustomDates range={range} onChange={onChange} />
    </>
  );
}
