'use client';

import { useState } from 'react';
import type { CustomerReceivable, CustomerRecord } from '@morbeez/shared-types';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyRow, PageHeader, Pager, SelectableRow } from '@/components/ui/ListControls';
import { DetailPanel, KeyValues } from '@/components/ui/DetailPanel';
import { AgingBar } from '@/components/finance/AgingBar';
import { useCustomers, useReceivables } from '@/lib/hooks/use-modules';
import { useCurrency, useTenantProfile } from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { formatDateTime, formatMoney } from '@/lib/format';
import { sumMoney } from '@/lib/decimal';

/**
 * Credit in use, as the backend's credit check and the dashboard's
 * credit-breach alert both define it: the value of confirmed, not-yet-
 * delivered orders. A display-only ratio.
 */
function creditUse(receivable: CustomerReceivable | undefined, creditLimit: string): number | null {
  if (!receivable || Number(creditLimit) <= 0) return null;
  return (Number(receivable.openOrderValue) / Number(creditLimit)) * 100;
}

function CreditMeter({ percent }: { percent: number | null }) {
  if (percent === null) return <span className="muted">—</span>;
  const tone = percent > 100 ? 'bad' : percent >= 80 ? 'attention' : undefined;
  return (
    <span className="meter-cell">
      <span className="meter" aria-hidden="true">
        <span style={{ width: `${Math.min(percent, 100)}%` }} data-tone={tone} />
      </span>
      <span data-tone={tone} className="meter-label">
        {Math.round(percent)}%
      </span>
    </span>
  );
}

function CustomerDetail({
  customer,
  receivable,
  canSeeFinance,
  onClose,
}: {
  customer: CustomerRecord;
  receivable: CustomerReceivable | undefined;
  canSeeFinance: boolean;
  onClose: () => void;
}) {
  const currency = useCurrency();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  return (
    <DetailPanel title={customer.name} onClose={onClose}>
      <KeyValues
        items={[
          ['Status', <StatusBadge key="s" status={customer.status} />],
          ['Payment terms', customer.paymentTermsDays === 0 ? 'On delivery' : `${customer.paymentTermsDays} days`],
          ['Credit limit', formatMoney(customer.creditLimit, currency)],
          ['Phone', customer.contact.phone ?? '—'],
          ['Email', customer.contact.email ?? '—'],
        ]}
      />
      {canSeeFinance && (
        <>
          <h3 className="detail-subhead">Money</h3>
          {receivable ? (
            <>
              <KeyValues
                items={[
                  ['Delivered to date', formatMoney(receivable.delivered, currency)],
                  ['Collected to date', formatMoney(receivable.collected, currency)],
                  ['Outstanding', formatMoney(receivable.outstanding, currency)],
                  ['Confirmed, not delivered', formatMoney(receivable.openOrderValue, currency)],
                  ['Last payment', formatDateTime(receivable.lastCollectionAt, timeZone)],
                ]}
              />
              <h3 className="detail-subhead">What&apos;s owed, by age</h3>
              <AgingBar receivable={receivable} currency={currency} />
            </>
          ) : (
            <p className="muted">No deliveries or open orders yet.</p>
          )}
        </>
      )}
    </DetailPanel>
  );
}

export default function CustomersPage() {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const { data: session } = useSession();
  const canSeeFinance = hasPermission(session, 'finance:read');
  const { data, error, isPending, isPlaceholderData, refetch } = useCustomers(page);
  const receivables = useReceivables(canSeeFinance);
  const currency = useCurrency();

  const byCustomer = new Map((receivables.data?.customers ?? []).map((r) => [r.customerId, r]));
  const selectedCustomer = data?.items.find((c) => c.id === selected) ?? null;
  const columns = canSeeFinance ? 6 : 3;

  return (
    <div className="stack">
      <PageHeader title="Customers" subtitle="Who you sell to — their terms, what they owe, and how much credit they're using." />
      <div className="split" data-detail={selectedCustomer ? 'open' : undefined}>
        <Panel title="Customers" meta={data ? `${data.total} total` : undefined}>
          {isPending ? (
            <SkeletonLines lines={6} />
          ) : error ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : (
            <div data-updating={isPlaceholderData || undefined} className="updating">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Terms</th>
                      <th className="align-right">Credit limit</th>
                      {canSeeFinance && (
                        <>
                          <th className="align-right">Outstanding</th>
                          <th className="align-right">Overdue</th>
                          <th className="align-right">Credit in use</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.length === 0 && <EmptyRow colSpan={columns}>No customers yet.</EmptyRow>}
                    {data.items.map((customer) => {
                      const receivable = byCustomer.get(customer.id);
                      const overdue = receivable
                        ? sumMoney([receivable.overdue1To30, receivable.overdue31To60, receivable.overdueOver60])
                        : '0.00';
                      return (
                        <SelectableRow
                          key={customer.id}
                          selected={selected === customer.id}
                          onSelect={() => setSelected(customer.id)}
                          label={customer.name}
                        >
                          <td>
                            {customer.name}
                            {customer.status === 'archived' && (
                              <>
                                {' '}
                                <StatusBadge status="archived" />
                              </>
                            )}
                          </td>
                          <td>{customer.paymentTermsDays === 0 ? 'On delivery' : `${customer.paymentTermsDays} days`}</td>
                          <td className="align-right">{formatMoney(customer.creditLimit, currency)}</td>
                          {canSeeFinance && (
                            <>
                              <td className="align-right">
                                {receivables.isPending ? '…' : formatMoney(receivable?.outstanding ?? '0', currency)}
                              </td>
                              <td className="align-right" data-tone={Number(overdue) > 0 ? 'bad' : undefined}>
                                {receivables.isPending ? '…' : Number(overdue) > 0 ? formatMoney(overdue, currency) : '—'}
                              </td>
                              <td className="align-right">
                                <CreditMeter percent={creditUse(receivable, customer.creditLimit)} />
                              </td>
                            </>
                          )}
                        </SelectableRow>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
              {receivables.error && (
                <p className="footnote">Couldn&apos;t load balances: {(receivables.error as Error).message}</p>
              )}
            </div>
          )}
        </Panel>
        {selectedCustomer && (
          <CustomerDetail
            key={selectedCustomer.id}
            customer={selectedCustomer}
            receivable={byCustomer.get(selectedCustomer.id)}
            canSeeFinance={canSeeFinance}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  );
}
