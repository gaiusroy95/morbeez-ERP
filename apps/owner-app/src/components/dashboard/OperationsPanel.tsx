'use client';

import Link from 'next/link';
import { useDashboardOperations } from '@/lib/hooks/use-dashboard';
import { formatCount, formatDate } from '@/lib/format';
import { ErrorState, Panel, SkeletonLines } from '../ui/Panel';
import { useT } from '@/lib/i18n';

interface Row {
  label: string;
  value: number;
  // Rows that mean "someone should act" turn amber when non-zero.
  attention?: boolean;
}

function OpsCard({ title, href, rows }: { title: string; href: string; rows: Row[] }) {
  const t = useT();
  return (
    <div className="panel panel-body">
      <div className="ops-card-title">
        <h3 style={{ fontSize: 14 }}>{t(title)}</h3>
        <Link href={href}>{t('Open')} →</Link>
      </div>
      <ul className="ops-list">
        {rows.map((row) => (
          <li key={row.label}>
            <span>{t(row.label)}</span>
            <span className="ops-count" data-attention={row.attention && row.value > 0 ? 'true' : undefined}>
              {formatCount(row.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OperationsPanel() {
  const { data, error, isPending, refetch } = useDashboardOperations();
  const t = useT();

  if (isPending) {
    return (
      <Panel title="Today's operations">
        <SkeletonLines lines={4} />
      </Panel>
    );
  }
  if (error) {
    return (
      <Panel title="Today's operations">
        <ErrorState error={error} onRetry={() => refetch()} />
      </Panel>
    );
  }

  return (
    <section aria-labelledby="ops-heading">
      <h2 id="ops-heading" className="section-label">
        {t("Today's operations")} · {formatDate(data.date)}
      </h2>
      <div className="ops-grid">
        <OpsCard
          title="Trips"
          href="/logistics"
          rows={[
            { label: 'Out on the road', value: data.trips.inProgress },
            { label: 'Planned', value: data.trips.planned },
            { label: 'Stops still to visit', value: data.stops.pendingOnActiveTrips },
            { label: 'Stops done today', value: data.stops.completedToday },
            { label: 'Stops skipped today', value: data.stops.skippedToday, attention: true },
            { label: 'Awaiting cash reconciliation', value: data.trips.awaitingReconciliation, attention: true },
          ]}
        />
        <OpsCard
          title="Orders"
          href="/orders"
          rows={[
            { label: 'To confirm', value: data.orders.awaitingConfirmation, attention: true },
            { label: 'Waiting on approval', value: data.orders.awaitingApproval, attention: true },
            { label: 'Confirmed, not yet delivered', value: data.orders.awaitingDelivery },
            { label: 'Delivered today', value: data.orders.deliveredToday },
          ]}
        />
        <OpsCard
          title="Procurement"
          href="/procurement"
          rows={[
            { label: 'Purchase orders to confirm', value: data.procurement.purchaseOrdersPlaced, attention: true },
            { label: 'Waiting for produce', value: data.procurement.awaitingReceipt },
            { label: 'Received, not graded', value: data.procurement.awaitingGrading, attention: true },
            { label: 'Pickups scheduled today', value: data.procurement.pickupsScheduledToday },
          ]}
        />
        <OpsCard
          title="Stock"
          href="/inventory"
          rows={[
            { label: 'Lots available to sell', value: data.stock.lotsAvailable },
            { label: 'Lots reserved for orders', value: data.stock.lotsReserved },
            { label: 'Lots waiting for grading', value: data.stock.lotsUngraded, attention: true },
          ]}
        />
      </div>
    </section>
  );
}
