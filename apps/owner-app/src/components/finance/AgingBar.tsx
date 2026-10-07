import type { CustomerReceivable } from '@morbeez/shared-types';
import { formatMoney } from '@/lib/format';
import { useT } from '@/lib/i18n';

const BUCKETS: { key: keyof CustomerReceivable; label: string; tone: string }[] = [
  { key: 'notYetDue', label: 'Not yet due', tone: 'ok' },
  { key: 'overdue1To30', label: '1–30 days late', tone: 'warn' },
  { key: 'overdue31To60', label: '31–60 days late', tone: 'bad' },
  { key: 'overdueOver60', label: 'Over 60 days late', tone: 'worst' },
];

/**
 * Outstanding split by how late it is. The stacked bar is a glance; the
 * legend underneath carries every figure in words, so nothing depends on
 * reading colour.
 */
export function AgingBar({
  receivable,
  currency,
}: {
  receivable: Pick<CustomerReceivable, 'notYetDue' | 'overdue1To30' | 'overdue31To60' | 'overdueOver60'>;
  currency: string;
}) {
  const t = useT();
  const values =BUCKETS.map((bucket) => ({ ...bucket, value: String(receivable[bucket.key as keyof typeof receivable]) }));
  const total = values.reduce((sum, bucket) => sum + Number(bucket.value), 0);

  if (total <= 0) return <p className="muted">{t('Nothing outstanding.')}</p>;

  return (
    <div className="aging">
      <div className="aging-bar" aria-hidden="true">
        {values
          .filter((bucket) => Number(bucket.value) > 0)
          .map((bucket) => (
            <span key={bucket.key} data-tone={bucket.tone} style={{ flexGrow: Number(bucket.value) }} />
          ))}
      </div>
      <ul className="aging-legend">
        {values.map((bucket) => (
          <li key={bucket.key}>
            <span className="swatch" data-tone={bucket.tone} aria-hidden="true" />
            <span>{t(bucket.label)}</span>
            <span className="num">{formatMoney(bucket.value, currency)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
