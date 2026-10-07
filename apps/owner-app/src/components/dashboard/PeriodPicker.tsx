'use client';

import { DashboardRange, useUiStore } from '@/lib/stores/ui-store';
import { useT } from '@/lib/i18n';

const OPTIONS: { value: DashboardRange; label: string }[] = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
];

export function PeriodPicker() {
  const range = useUiStore((s) => s.dashboardRange);
  const setRange = useUiStore((s) => s.setDashboardRange);
  const t = useT();

  return (
    <div className="segmented" role="group" aria-label={t('Reporting period')}>
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={range === option.value}
          onClick={() => setRange(option.value)}
        >
          {t(option.label)}
        </button>
      ))}
    </div>
  );
}
