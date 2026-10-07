'use client';

import { useState } from 'react';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { PageHeader } from '@/components/ui/ListControls';
import {
  AlertSettingsForm,
  DayOffCard,
  DayOffDialog,
  DriveMyselfDialog,
  DriverPoolTable,
  GrantDialog,
  GrantsTable,
} from '@/components/delegation/Delegation';
import { LEVELS, useDayOff, useDriverPool, useGrants } from '@/lib/hooks/use-delegation';
import { useTrips } from '@/lib/hooks/use-modules';
import { useCurrency, useEmployeeName, useTenantProfile, useVehicleName } from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { useT } from '@/lib/i18n';

const SUBTITLE = 'Who may run a trip for you, with how much authority — so the business keeps going when you take a day off.';

function Loading() {
  return <SkeletonLines lines={5} />;
}

export default function DelegationPage() {
  const t = useT();
  const { data: session } = useSession();
  const can = (p: string) => hasPermission(session, p);
  const canDecide = can('logistics:reconcile');
  const profile = useTenantProfile();
  const currency = useCurrency();
  const pool = useDriverPool();
  const grants = useGrants();
  const dayOff = useDayOff();
  const planned = useTrips('planned', 1);
  const running = useTrips('in_progress', 1);
  const vehicleName = useVehicleName();
  const employeeName = useEmployeeName();
  const [dialog, setDialog] = useState<'dayoff' | 'grant' | 'me' | null>(null);
  const timeZone = profile.data?.timezone ?? 'Asia/Kolkata';

  if (session && !can('logistics:dispatch')) {
    return (
      <div className="stack">
        <PageHeader title={t('Delegation')} subtitle={SUBTITLE} />
        <div className="panel placeholder">
          <strong>{t("Your role doesn't include trips.")}</strong>
          <p>{t('Ask the business owner if you need to see who drives for the business.')}</p>
        </div>
      </div>
    );
  }

  const poolData = pool.data ?? [];
  const plannedTrips = planned.data?.items ?? [];
  const openTrips = [...plannedTrips, ...(running.data?.items ?? [])];
  const iDrive = poolData.some((d) => d.isMe);

  return (
    <div className="stack">
      <PageHeader
        title={t('Delegation')}
        subtitle={SUBTITLE}
        actions={
          canDecide && (
            <>
              {!iDrive && can('workforce:write') && (
                <button type="button" className="button" onClick={() => setDialog('me')}>
                  {t('I drive too')}
                </button>
              )}
              <button type="button" className="button button-primary" onClick={() => setDialog('grant')} disabled={!poolData.some((d) => d.delegationLevel !== null)}>
                {t('Delegate a trip')}
              </button>
            </>
          )
        }
      />

      {dayOff.data && pool.data ? (
        <DayOffCard state={dayOff.data} pool={poolData} timeZone={timeZone} canDecide={canDecide} onStart={() => setDialog('dayoff')} />
      ) : (
        <Loading />
      )}

      <Panel title={t('Drivers')} meta={t('Eligibility is your standing decision; it authorizes nothing unless it stands for every trip.')}>
        {pool.isPending ? <Loading /> : pool.error ? <ErrorState error={pool.error} onRetry={() => pool.refetch()} /> : <DriverPoolTable pool={poolData} canDecide={canDecide} />}
      </Panel>

      <Panel title={t('Delegations')}>
        {grants.isPending ? (
          <Loading />
        ) : grants.error ? (
          <ErrorState error={grants.error} onRetry={() => grants.refetch()} />
        ) : (
          <GrantsTable grants={grants.data ?? []} timeZone={timeZone} canDecide={canDecide} />
        )}
      </Panel>

      <div className="split-even">
        <Panel title={t('The four levels')}>
          <ol className="levels">
            {LEVELS.map((l) => (
              <li key={l.level}>
                <strong>
                  {t('Level')} {l.level} · {t(l.name)}
                </strong>
                <span>{t(l.covers)}</span>
              </li>
            ))}
          </ol>
        </Panel>
        <Panel title={t('Business rules')}>
          {profile.data ? (
            <AlertSettingsForm
              key={JSON.stringify(profile.data)}
              settings={{
                operatingDayEnd: profile.data.operatingDayEnd ?? '22:00',
                alertCashThreshold: profile.data.alertCashThreshold ?? '500',
                alertCollectionThreshold: profile.data.alertCollectionThreshold ?? '1000',
                defaultShrinkageTolerancePct: profile.data.defaultShrinkageTolerancePct ?? '2',
                defaultBreakageTolerancePct: profile.data.defaultBreakageTolerancePct ?? '1',
                weighmentPhoto: profile.data.weighmentPhoto ?? 'optional',
              }}
              currency={currency}
              canEdit={can('tenant:manage')}
            />
          ) : (
            <Loading />
          )}
        </Panel>
      </div>

      {dialog === 'dayoff' && (
        <DayOffDialog
          pool={poolData}
          plannedTrips={plannedTrips}
          vehicleName={vehicleName}
          employeeName={employeeName}
          currency={currency}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'grant' && (
        <GrantDialog pool={poolData} trips={openTrips} vehicleName={vehicleName} employeeName={employeeName} onClose={() => setDialog(null)} />
      )}
      {dialog === 'me' && <DriveMyselfDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
