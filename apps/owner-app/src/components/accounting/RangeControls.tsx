'use client';

import { useId } from 'react';
import type { DateRange } from '@/lib/hooks/use-accounting';

// Presets are computed from the tenant's own "today" (from the server, in
// the tenant's timezone), never the browser's clock. The financial year is
// India's: 1 April to 31 March.

type Preset = 'month' | 'last_month' | 'quarter' | 'fy' | 'last_fy';

const PRESET_LABEL: Record<Preset, string> = {
  month: 'This month',
  last_month: 'Last month',
  quarter: 'This quarter',
  fy: 'This financial year',
  last_fy: 'Last financial year',
};

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

export function presetRange(preset: Preset, today: string): DateRange {
  const [y, m] = today.split('-').map(Number);
  const month = m - 1;
  const fyStartYear = month >= 3 ? y : y - 1;
  switch (preset) {
    case 'month':
      return { from: iso(y, month, 1), to: today };
    case 'last_month':
      return { from: iso(y, month - 1, 1), to: iso(y, month, 0) };
    case 'quarter': {
      // Financial-year quarters: Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar.
      const q = Math.floor(((month + 9) % 12) / 3);
      const startMonth = (3 + q * 3) % 12;
      const startYear = startMonth > month ? y - 1 : y;
      return { from: iso(startYear, startMonth, 1), to: today };
    }
    case 'fy':
      return { from: iso(fyStartYear, 3, 1), to: today };
    case 'last_fy':
      return { from: iso(fyStartYear - 1, 3, 1), to: iso(fyStartYear, 2, 31) };
  }
}

function matchingPreset(range: DateRange, today: string): Preset | null {
  return (Object.keys(PRESET_LABEL) as Preset[]).find((p) => {
    const r = presetRange(p, today);
    return r.from === range.from && r.to === range.to;
  }) ?? null;
}

export function RangeControls({
  range,
  today,
  onChange,
}: {
  range: DateRange;
  today: string;
  onChange: (range: DateRange) => void;
}) {
  const id = useId();
  const preset = matchingPreset(range, today);
  return (
    <div className="range-controls">
      <label className="visually-hidden" htmlFor={`${id}-preset`}>
        Period
      </label>
      <select
        id={`${id}-preset`}
        value={preset ?? 'custom'}
        onChange={(e) => e.target.value !== 'custom' && onChange(presetRange(e.target.value as Preset, today))}
      >
        {(Object.keys(PRESET_LABEL) as Preset[]).map((p) => (
          <option key={p} value={p}>
            {PRESET_LABEL[p]}
          </option>
        ))}
        <option value="custom">Custom dates</option>
      </select>
      <label className="visually-hidden" htmlFor={`${id}-from`}>
        From
      </label>
      <input
        id={`${id}-from`}
        type="date"
        value={range.from}
        max={range.to}
        onChange={(e) => e.target.value && onChange({ ...range, from: e.target.value })}
      />
      <span aria-hidden="true">to</span>
      <label className="visually-hidden" htmlFor={`${id}-to`}>
        To
      </label>
      <input
        id={`${id}-to`}
        type="date"
        value={range.to}
        min={range.from}
        max={today}
        onChange={(e) => e.target.value && onChange({ ...range, to: e.target.value })}
      />
    </div>
  );
}

export function AsOfControl({ asOf, today, onChange }: { asOf: string; today: string; onChange: (asOf: string) => void }) {
  const id = useId();
  return (
    <div className="range-controls">
      <label htmlFor={id}>As of</label>
      <input id={id} type="date" value={asOf} max={today} onChange={(e) => e.target.value && onChange(e.target.value)} />
    </div>
  );
}
