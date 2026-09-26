import type { CashDay } from '@morbeez/shared-types';
import { formatDate, formatMoney, formatMoneyCompact } from '@/lib/format';

/**
 * Daily cash in (up) against cash out (down) around a zero line. Bars are
 * CSS, not a chart library; each day's figures are in its tooltip and in a
 * visually hidden table, so the chart is never the only way to read them.
 */
export function CashChart({ days, currency }: { days: CashDay[]; currency: string }) {
  // Display-only scale.
  const max = Math.max(1, ...days.map((d) => Math.max(Number(d.cashIn), Number(d.cashOut))));
  const dense = days.length > 31;

  return (
    <div className="cash-chart">
      <div className="cash-legend" aria-hidden="true">
        <span><span className="swatch" data-tone="in" /> Cash in</span>
        <span><span className="swatch" data-tone="out" /> Cash out</span>
        <span className="muted">Peak day {formatMoneyCompact(String(max), currency)}</span>
      </div>
      <div className="cash-plot" data-dense={dense || undefined} aria-hidden="true">
        {days.map((day) => (
          <div
            key={day.date}
            className="cash-day"
            title={`${formatDate(day.date)} — in ${formatMoney(day.cashIn, currency)}, out ${formatMoney(day.cashOut, currency)}`}
          >
            <div className="cash-half cash-half-in">
              <span style={{ height: `${(Number(day.cashIn) / max) * 100}%` }} />
            </div>
            <div className="cash-half cash-half-out">
              <span style={{ height: `${(Number(day.cashOut) / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="cash-axis" aria-hidden="true">
        <span>{days[0] && formatDate(days[0].date)}</span>
        <span>{days.length > 0 && formatDate(days[days.length - 1].date)}</span>
      </div>
      <table className="visually-hidden">
        <caption>Cash in and out by day</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>Cash in</th>
            <th>Cash out</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.date}>
              <td>{formatDate(day.date)}</td>
              <td>{formatMoney(day.cashIn, currency)}</td>
              <td>{formatMoney(day.cashOut, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
