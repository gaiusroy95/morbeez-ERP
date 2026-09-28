'use client';

import type { BalanceSheet, CashFlowStatement, ProfitAndLoss, StatementLine, StatementSection } from '@morbeez/shared-types';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatAmount, formatDate } from '@/lib/format';

// Financial statements as tables — the numbers are the point, and a table
// reads correctly for screen readers and prints cleanly. Each account line
// opens its general ledger for the same dates.

function AccountRow({
  line,
  onOpen,
  compare,
}: {
  line: StatementLine;
  onOpen: (code: string) => void;
  compare?: boolean;
}) {
  return (
    <tr>
      <th scope="row" className="st-account">
        <button type="button" className="link-button" onClick={() => onOpen(line.code)}>
          <span className="st-number">{line.number}</span> {line.name}
        </button>
      </th>
      <td className="num">{formatAmount(line.amount)}</td>
      {compare && <td className="num" />}
    </tr>
  );
}

function SubtotalRow({
  label,
  amount,
  previous,
  tone,
  total,
  note,
}: {
  label: string;
  amount: string;
  previous?: string;
  tone?: 'bad' | 'good';
  total?: boolean;
  note?: string;
}) {
  return (
    <tr className={total ? 'st-total' : 'st-subtotal'}>
      <th scope="row">
        {label}
        {note && <span className="st-note"> {note}</span>}
      </th>
      <td className="num" data-tone={tone}>
        {formatAmount(amount)}
      </td>
      {previous !== undefined && <td className="num muted">{formatAmount(previous)}</td>}
    </tr>
  );
}

function SectionRows({
  section,
  onOpen,
  compare,
  hideTotal,
}: {
  section: StatementSection | undefined;
  onOpen: (code: string) => void;
  compare?: boolean;
  hideTotal?: boolean;
}) {
  if (!section || section.lines.length === 0) return null;
  return (
    <>
      <tr className="st-heading">
        <th scope="rowgroup" colSpan={compare ? 3 : 2}>
          {section.label}
        </th>
      </tr>
      {section.lines.map((line) => (
        <AccountRow key={line.code} line={line} onOpen={onOpen} compare={compare} />
      ))}
      {!hideTotal && section.lines.length > 1 && (
        <tr className="st-sectiontotal">
          <th scope="row">Total {section.label.toLowerCase()}</th>
          <td className="num">{formatAmount(section.total)}</td>
          {compare && <td className="num" />}
        </tr>
      )}
    </>
  );
}

const tone = (value: string) => (Number(value) < 0 ? 'bad' : undefined);

function margin(part: string, whole: string): string | undefined {
  const w = Number(whole);
  if (w <= 0) return undefined;
  return `${((Number(part) / w) * 100).toFixed(1)}% of net sales`;
}

export function ProfitAndLossView({ pnl, onOpen }: { pnl: ProfitAndLoss; onOpen: (code: string) => void }) {
  const s = (key: StatementSection['key']) => pnl.sections.find((x) => x.key === key);
  const f = pnl.figures;
  const p = pnl.previous.figures;
  const empty = pnl.sections.every((x) => x.lines.length === 0);
  return (
    <div className="table-wrap">
      <table className="table statement">
        <caption className="st-caption">
          Profit and loss, {formatDate(pnl.from)} – {formatDate(pnl.to)} · amounts in {pnl.currency}
        </caption>
        <thead>
          <tr>
            <th scope="col">Account</th>
            <th scope="col" className="num">
              This period
            </th>
            <th scope="col" className="num">
              <span title={`${formatDate(pnl.previous.from)} – ${formatDate(pnl.previous.to)}`}>Previous period</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {empty && (
            <tr>
              <td colSpan={3} className="empty-cell">
                Nothing was posted in this period.
              </td>
            </tr>
          )}
          <SectionRows section={s('sales')} onOpen={onOpen} compare hideTotal />
          <SectionRows section={s('contra_sales')} onOpen={onOpen} compare hideTotal />
          <SubtotalRow label="Net sales" amount={f.netSales} previous={p.netSales} />
          <SectionRows section={s('cost_of_sales')} onOpen={onOpen} compare hideTotal />
          <SubtotalRow
            label="Gross profit"
            amount={f.grossProfit}
            previous={p.grossProfit}
            tone={tone(f.grossProfit)}
            note={margin(f.grossProfit, f.netSales)}
          />
          <SectionRows section={s('operating_expense')} onOpen={onOpen} compare />
          <SubtotalRow label="Operating profit" amount={f.operatingProfit} previous={p.operatingProfit} tone={tone(f.operatingProfit)} />
          <SectionRows section={s('other_income')} onOpen={onOpen} compare />
          <SectionRows section={s('finance_cost')} onOpen={onOpen} compare />
          <SectionRows section={s('other_expense')} onOpen={onOpen} compare />
          <SubtotalRow
            label="Net profit"
            amount={f.netProfit}
            previous={p.netProfit}
            tone={tone(f.netProfit)}
            total
            note={margin(f.netProfit, f.netSales)}
          />
        </tbody>
      </table>
    </div>
  );
}

export function BalanceSheetView({ sheet, onOpen }: { sheet: BalanceSheet; onOpen: (code: string) => void }) {
  return (
    <div className="stack">
      <p className="st-status">
        {sheet.balanced ? (
          <StatusBadge status="balanced" tone="done" label="Balances" />
        ) : (
          <StatusBadge status="unbalanced" tone="bad" label="Does not balance — report this" />
        )}{' '}
        <span className="muted">
          As of {formatDate(sheet.asOf)} · amounts in {sheet.currency}
        </span>
      </p>
      <div className="st-columns">
        <div className="table-wrap">
          <table className="table statement">
            <caption className="st-caption">What the business owns</caption>
            <tbody>
              {sheet.assets.sections.map((section) => (
                <SectionRows key={section.key} section={section} onOpen={onOpen} />
              ))}
              <SubtotalRow label="Total assets" amount={sheet.assets.total} total />
            </tbody>
          </table>
        </div>
        <div className="table-wrap">
          <table className="table statement">
            <caption className="st-caption">What it owes, and the owner&apos;s stake</caption>
            <tbody>
              {sheet.liabilities.sections.map((section) => (
                <SectionRows key={section.key} section={section} onOpen={onOpen} />
              ))}
              <SubtotalRow label="Total liabilities" amount={sheet.liabilities.total} />
              <tr className="st-heading">
                <th scope="rowgroup" colSpan={2}>
                  Equity
                </th>
              </tr>
              {sheet.equity.lines.map((line) => (
                <AccountRow key={line.code} line={line} onOpen={onOpen} />
              ))}
              <tr>
                <th scope="row" className="st-account">
                  Profit not yet closed to retained earnings
                </th>
                <td className="num" data-tone={tone(sheet.equity.unclosedProfit)}>
                  {formatAmount(sheet.equity.unclosedProfit)}
                </td>
              </tr>
              <SubtotalRow label="Total equity" amount={sheet.equity.total} />
              <SubtotalRow label="Total liabilities and equity" amount={sheet.liabilitiesAndEquity} total />
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const ACTIVITY_LABEL = {
  operating: 'Operating activities',
  investing: 'Investing activities',
  financing: 'Financing activities',
} as const;

export function CashFlowView({ flow, onOpen }: { flow: CashFlowStatement; onOpen: (code: string) => void }) {
  return (
    <div className="stack">
      <div className="table-wrap">
        <table className="table statement">
          <caption className="st-caption">
            Cash flow, {formatDate(flow.from)} – {formatDate(flow.to)} · amounts in {flow.currency} · + in, ( ) out
          </caption>
          <tbody>
            <SubtotalRow label="Cash at the start" amount={flow.openingCash} />
            {flow.activities.map((activity) => (
              <ActivityRows key={activity.activity} activity={activity} onOpen={onOpen} />
            ))}
            <SubtotalRow label="Net change in cash" amount={flow.netChange} tone={tone(flow.netChange)} />
            <SubtotalRow label="Cash at the end" amount={flow.closingCash} total tone={tone(flow.closingCash)} />
          </tbody>
        </table>
      </div>
      <div className="table-wrap">
        <table className="table">
          <caption className="st-caption">By cash account</caption>
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col" className="num">
                Start
              </th>
              <th scope="col" className="num">
                End
              </th>
            </tr>
          </thead>
          <tbody>
            {flow.cashAccounts.map((a) => (
              <tr key={a.code}>
                <th scope="row" className="st-account">
                  <button type="button" className="link-button" onClick={() => onOpen(a.code)}>
                    {a.name}
                  </button>
                </th>
                <td className="num">{formatAmount(a.opening)}</td>
                <td className="num" data-tone={tone(a.closing)}>
                  {formatAmount(a.closing)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="footnote">
        Built straight from the ledger: every entry that moved cash or bank, classified by what was on its other side.
        Transfers between cash and bank cancel out.
      </p>
    </div>
  );
}

function ActivityRows({
  activity,
  onOpen,
}: {
  activity: CashFlowStatement['activities'][number];
  onOpen: (code: string) => void;
}) {
  return (
    <>
      <tr className="st-heading">
        <th scope="rowgroup" colSpan={2}>
          {ACTIVITY_LABEL[activity.activity]}
        </th>
      </tr>
      {activity.lines.length === 0 ? (
        <tr>
          <td colSpan={2} className="muted st-account">
            None in this period
          </td>
        </tr>
      ) : (
        activity.lines.map((line) => (
          <tr key={line.code}>
            <th scope="row" className="st-account">
              <button type="button" className="link-button" onClick={() => onOpen(line.code)}>
                {line.label}
              </button>
            </th>
            <td className="num" data-tone={tone(line.amount)}>
              {formatAmount(line.amount)}
            </td>
          </tr>
        ))
      )}
      <tr className="st-sectiontotal">
        <th scope="row">Net cash from {activity.activity}</th>
        <td className="num">{formatAmount(activity.total)}</td>
      </tr>
    </>
  );
}
