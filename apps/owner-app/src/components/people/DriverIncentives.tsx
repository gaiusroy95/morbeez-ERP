'use client';

import { useState } from 'react';
import type { DriverIncentiveSettings, TripIncentives } from '@morbeez/shared-types';
import { Panel, ErrorState, SkeletonLines } from '@/components/ui/Panel';
import { ActionBar, Field } from '@/components/ui/Form';
import { apiSend } from '@/lib/api/client';
import { useAction } from '@/lib/hooks/use-action';
import { useDriverIncentives } from '@/lib/hooks/use-admin';
import { formatRate } from '@/lib/format';
import { useT } from '@/lib/i18n';

type Row = { kind: string; label: string; base: string; enabled: boolean; percent: string };

/**
 * Settings → Rates & rules: the drivers' incentives (driver app D7) — each
 * on or off and its percentage of its base, with the mileage target and the
 * night hours. Worked out from each trip's data when the owner closes it,
 * and paid with the driver's weekly pay.
 */
export function DriverIncentivesPanel({ canConfigure }: { canConfigure: boolean }) {
  const t = useT();
  const settings = useDriverIncentives();
  return (
    <Panel title={t('Driver incentives')}>
      {settings.isPending ? (
        <SkeletonLines lines={6} />
      ) : settings.error ? (
        <ErrorState error={settings.error} onRetry={() => settings.refetch()} />
      ) : (
        <IncentivesForm key={settings.data.version} settings={settings.data} canConfigure={canConfigure} />
      )}
    </Panel>
  );
}

function IncentivesForm({ settings, canConfigure }: { settings: DriverIncentiveSettings; canConfigure: boolean }) {
  const t = useT();
  const [rows, setRows] = useState<Row[]>(settings.rules.map((r) => ({ kind: r.kind, label: r.label, base: r.base, enabled: r.enabled, percent: String(Number(r.percent)) })));
  const [target, setTarget] = useState(settings.targetKmPerLitre ? String(Number(settings.targetKmPerLitre)) : '');
  const [nightFrom, setNightFrom] = useState(settings.nightFrom);
  const [nightUntil, setNightUntil] = useState(settings.nightUntil);
  const c = settings.conditions;
  const [cond, setCond] = useState({
    minCollected: String(Number(c.minCollected)),
    minCrates: String(c.minCrates),
    qualityShortAllowed: String(c.qualityShortAllowed),
    performanceSkipsAllowed: String(c.performanceSkipsAllowed),
    km: c.dataQualityNeeds.km,
    deliveryPhotos: c.dataQualityNeeds.deliveryPhotos,
    bills: c.dataQualityNeeds.bills,
    completionOnException: c.completionOnException,
  });
  const setC = (patch: Partial<typeof cond>) => setCond({ ...cond, ...patch });
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('PUT', 'workforce/payroll/driver-incentives', body), [['workforce', 'driver-incentives']]);
  const set = (kind: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.kind === kind ? { ...r, ...patch } : r)));

  const submit = () => {
    const bad = rows.find((r) => r.enabled && !(Number(r.percent) >= 0 && Number(r.percent) <= 100 && r.percent.trim() !== ''));
    if (bad) return setProblem(t('{label}: a percentage from 0 to 100.', { label: t(bad.label) }));
    const mileageOn = rows.some((r) => r.kind === 'mileage' && r.enabled);
    if (mileageOn && !(Number(target) > 0)) return setProblem(t('The mileage incentive needs a km/l target.'));
    const whole = (v: string, min: number) => /^\d+$/.test(v.trim()) && Number(v) >= min;
    if (!(Number(cond.minCollected) >= 0 && cond.minCollected.trim() !== '')) return setProblem(t('Minimum collected: an amount, 0 or more.'));
    if (!whole(cond.minCrates, 1) || !whole(cond.qualityShortAllowed, 0) || !whole(cond.performanceSkipsAllowed, 0)) {
      return setProblem(t('Crates, short deliveries and stops: whole numbers (crates at least 1).'));
    }
    setProblem(null);
    save.mutate({
      version: settings.version,
      rules: rows.map((r) => ({ kind: r.kind, enabled: r.enabled, percent: Number(r.percent || 0) })),
      targetKmPerLitre: target.trim() ? Number(target) : null,
      nightFrom,
      nightUntil,
      conditions: {
        minCollected: Math.round(Number(cond.minCollected) * 100) / 100,
        minCrates: Number(cond.minCrates),
        qualityShortAllowed: Number(cond.qualityShortAllowed),
        performanceSkipsAllowed: Number(cond.performanceSkipsAllowed),
        dataQualityNeeds: { km: cond.km, deliveryPhotos: cond.deliveryPhotos, bills: cond.bills },
        completionOnException: cond.completionOnException,
      },
    });
  };

  return (
    <>
      <div className="table-wrap">
        <table className="table incentive-table">
          <thead>
            <tr>
              <th>{t('Incentive')}</th>
              <th className="num">%</th>
              <th>{t('Of')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.kind} className={r.enabled ? undefined : 'muted-row'}>
                <td>
                  <label className="checkbox-row">
                    <input type="checkbox" checked={r.enabled} disabled={!canConfigure} onChange={(e) => set(r.kind, { enabled: e.target.checked })} /> {t(r.label)}
                  </label>
                </td>
                <td className="num">
                  <input
                    className="percent-input"
                    aria-label={t('{label} percentage', { label: t(r.label) })}
                    inputMode="decimal"
                    value={r.percent}
                    disabled={!canConfigure || !r.enabled}
                    onChange={(e) => set(r.kind, { percent: e.target.value })}
                  />
                </td>
                <td className="muted">{t(r.base)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-grid settings-form">
        <Field label="Mileage target (km per litre)" hint="What the vehicle should do on a litre: fuel saved below it earns the mileage incentive.">
          {(p) => <input {...p} inputMode="decimal" value={target} disabled={!canConfigure} onChange={(e) => setTarget(e.target.value)} placeholder="8.5" />}
        </Field>
        <Field label="Night duty from">{(p) => <input {...p} type="time" value={nightFrom} disabled={!canConfigure} onChange={(e) => setNightFrom(e.target.value)} />}</Field>
        <Field label="Night duty until">{(p) => <input {...p} type="time" value={nightUntil} disabled={!canConfigure} onChange={(e) => setNightUntil(e.target.value)} />}</Field>
      </div>
      <h3 className="detail-subhead">{t('Eligibility conditions')}</h3>
      <div className="form-grid settings-form">
        <Field label="Collection: at least (₹) collected on the trip">
          {(p) => <input {...p} inputMode="decimal" value={cond.minCollected} disabled={!canConfigure} onChange={(e) => setC({ minCollected: e.target.value })} />}
        </Field>
        <Field label="Crates: at least this many brought back">
          {(p) => <input {...p} inputMode="numeric" value={cond.minCrates} disabled={!canConfigure} onChange={(e) => setC({ minCrates: e.target.value })} />}
        </Field>
        <Field label="Quality: short deliveries allowed">
          {(p) => <input {...p} inputMode="numeric" value={cond.qualityShortAllowed} disabled={!canConfigure} onChange={(e) => setC({ qualityShortAllowed: e.target.value })} />}
        </Field>
        <Field label="Performance: stops that may be left undone">
          {(p) => <input {...p} inputMode="numeric" value={cond.performanceSkipsAllowed} disabled={!canConfigure} onChange={(e) => setC({ performanceSkipsAllowed: e.target.value })} />}
        </Field>
        <fieldset className="checks form-wide">
          <legend>{t('Data quality: what must be recorded')}</legend>
          <label className="checkbox-row">
            <input type="checkbox" checked={cond.km} disabled={!canConfigure} onChange={(e) => setC({ km: e.target.checked })} /> {t('Opening and closing KM')}
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={cond.deliveryPhotos} disabled={!canConfigure} onChange={(e) => setC({ deliveryPhotos: e.target.checked })} /> {t('A photo of every delivery')}
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={cond.bills} disabled={!canConfigure} onChange={(e) => setC({ bills: e.target.checked })} /> {t('A bill for every expense')}
          </label>
        </fieldset>
        <label className="checkbox-row form-wide">
          <input type="checkbox" checked={cond.completionOnException} disabled={!canConfigure} onChange={(e) => setC({ completionOnException: e.target.checked })} />{' '}
          {t('Trip completion: also when you close a trip with an approved exception')}
        </label>
      </div>
      {(problem ?? save.error) ? (
        <p className="form-error" role="alert">
          {problem ?? (save.error as Error).message}
        </p>
      ) : null}
      {canConfigure && (
        <ActionBar>
          <button type="button" className="button button-primary" disabled={save.isPending} onClick={submit}>
            {t('Save incentives')}
          </button>
          {save.isSuccess && !save.isPending && <span className="muted">{t('Saved.')}</span>}
        </ActionBar>
      )}
      <p className="footnote">
        {t(
          "Worked out from each trip's data when you close it, and paid with the driver's weekly pay — a change applies to trips you close after it. Each incentive is off until you switch it on.",
        )}
      </p>
    </>
  );
}

/** A trip's incentives for its driver: what you closed it with, or what it would pay now. */
export function TripIncentivesView({ data, currency }: { data: TripIncentives; currency: string }) {
  const t = useT();
  if (data.lines.length === 0) return null;
  return (
    <>
      <h3 className="detail-subhead">{t(data.final ? "Driver's incentives" : "Driver's incentives (estimate until you close the trip)")}</h3>
      <div className="table-wrap">
        <table className="table">
          <tbody>
            {data.lines.map((l) => (
              <tr key={l.kind}>
                <td>
                  {t(l.label)}
                  <div className="cell-sub">{l.detail}</div>
                </td>
                <td className="num muted">{Number(l.percent)}%</td>
                <td className="num">{formatRate(l.amount, currency)}</td>
              </tr>
            ))}
            <tr className="total-row">
              <td colSpan={2}>{t('Total')}</td>
              <td className="num">{formatRate(data.total, currency)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
