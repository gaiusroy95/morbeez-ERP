'use client';

import { useState } from 'react';
import type { GstRateView, TaxProfile, TaxReference, TdsSectionView } from '@morbeez/shared-types';
import { ActionBar, Field, FormDialog } from '@/components/ui/Form';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyRow } from '@/components/ui/ListControls';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { formatDate } from '@/lib/format';
import { parseDecimal, parseMoney, parseWholeNumber } from '@/lib/parse';

const TAXABILITY_LABEL: Record<string, string> = {
  taxable: 'Taxable',
  nil_rated: 'Nil-rated',
  exempt: 'Exempt',
  non_gst: 'Non-GST',
};

export const REGISTRATION_LABEL: Record<TaxProfile['registrationType'], string> = {
  regular: 'Regular GST registration',
  composition: 'Composition scheme',
  unregistered: 'Not registered for GST',
};

const opt = (v: string) => (v.trim() === '' ? undefined : v.trim());

// ---- Registration ----

export function ProfileView({
  profile,
  reference,
  sections,
  canConfigure,
}: {
  profile: TaxProfile;
  reference: TaxReference;
  sections: TdsSectionView[];
  canConfigure: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const state = reference.states.find((s) => s.code === profile.stateCode)?.name;
  const rows: [string, string][] = [
    ['Registration', REGISTRATION_LABEL[profile.registrationType]],
    ['GSTIN', profile.gstin ?? '—'],
    ['Legal name', profile.legalName ?? '—'],
    ['Address', [profile.addressLine1, profile.addressLine2, profile.city, profile.pincode].filter(Boolean).join(', ') || '—'],
    ['State', state ? `${profile.stateCode} · ${state}` : '—'],
    ['PAN', profile.pan ?? '—'],
    ['TAN (for TDS)', profile.tan ?? '—'],
    ['HSN digits on invoices', `At least ${profile.hsnMinDigits}`],
    ['B2C large-invoice limit', `₹${Number(profile.b2clThreshold).toLocaleString('en-IN')}`],
    [
      'E-invoicing',
      profile.einvoiceEnabled
        ? `On${profile.einvoiceReportWithinDays ? ` · register within ${profile.einvoiceReportWithinDays} days` : ''}`
        : 'Off',
    ],
    ['TDS on farmer purchases', profile.farmerTdsSection ? `Section ${profile.farmerTdsSection}` : 'None'],
  ];
  return (
    <>
      {profile.version === 0 && (
        <p className="action-note" data-tone="info">
          No tax registration saved yet — invoices are issued without GST until it is.
        </p>
      )}
      <dl className="key-values">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {canConfigure && (
        <ActionBar>
          <button type="button" className="button button-primary" onClick={() => setEditing(true)}>
            Edit registration
          </button>
        </ActionBar>
      )}
      {editing && <ProfileDialog profile={profile} reference={reference} sections={sections} onClose={() => setEditing(false)} />}
    </>
  );
}

function ProfileDialog({
  profile,
  reference,
  sections,
  onClose,
}: {
  profile: TaxProfile;
  reference: TaxReference;
  sections: TdsSectionView[];
  onClose: () => void;
}) {
  const [f, setF] = useState({
    registrationType: profile.registrationType,
    gstin: profile.gstin ?? '',
    legalName: profile.legalName ?? '',
    tradeName: profile.tradeName ?? '',
    addressLine1: profile.addressLine1 ?? '',
    addressLine2: profile.addressLine2 ?? '',
    city: profile.city ?? '',
    pincode: profile.pincode ?? '',
    stateCode: profile.stateCode ?? '',
    pan: profile.pan ?? '',
    tan: profile.tan ?? '',
    hsnMinDigits: String(profile.hsnMinDigits),
    b2clThreshold: profile.b2clThreshold,
    einvoiceEnabled: profile.einvoiceEnabled,
    einvoiceReportWithinDays: profile.einvoiceReportWithinDays ? String(profile.einvoiceReportWithinDays) : '',
    farmerTdsSection: profile.farmerTdsSection ?? '',
  });
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend<TaxProfile>('PUT', 'tax/profile', body), [KEYS.tax], onClose);
  const registered = f.registrationType !== 'unregistered';
  const codes = [...new Set(sections.filter((s) => s.inForce).map((s) => s.code))];

  const submit = () => {
    const threshold = parseMoney(f.b2clThreshold, 'the B2C large-invoice limit');
    if (!threshold.ok) return setProblem(threshold.error);
    let window: number | null = null;
    if (f.einvoiceReportWithinDays.trim()) {
      const w = parseWholeNumber(f.einvoiceReportWithinDays, 'the reporting window', 1, 365);
      if (!w.ok) return setProblem(w.error);
      window = w.value;
    }
    if (registered && !f.gstin.trim()) return setProblem('A GST-registered business needs its GSTIN.');
    if (!registered && !f.stateCode) return setProblem('Choose your state — it decides CGST/SGST or IGST once you register.');
    setProblem(null);
    save.mutate({
      version: profile.version,
      registrationType: f.registrationType,
      gstin: registered ? opt(f.gstin) : undefined,
      legalName: opt(f.legalName),
      tradeName: opt(f.tradeName),
      addressLine1: opt(f.addressLine1),
      addressLine2: opt(f.addressLine2),
      city: opt(f.city),
      pincode: opt(f.pincode),
      stateCode: registered ? undefined : f.stateCode,
      pan: opt(f.pan),
      tan: opt(f.tan),
      hsnMinDigits: Number(f.hsnMinDigits),
      b2clThreshold: threshold.value,
      einvoiceEnabled: f.registrationType === 'regular' && f.einvoiceEnabled,
      einvoiceReportWithinDays: window,
      farmerTdsSection: f.farmerTdsSection || null,
    });
  };

  return (
    <FormDialog
      title="Tax registration"
      description={<p>Changes apply to invoices issued from now on; invoices already issued keep the tax they were issued with.</p>}
      submitLabel="Save"
      size="wide"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field label="Registration" wide>
        {(p) => (
          <select {...p} value={f.registrationType} onChange={(e) => set({ registrationType: e.target.value as TaxProfile['registrationType'] })}>
            {(Object.keys(REGISTRATION_LABEL) as TaxProfile['registrationType'][]).map((r) => (
              <option key={r} value={r}>
                {REGISTRATION_LABEL[r]}
              </option>
            ))}
          </select>
        )}
      </Field>
      {registered ? (
        <Field label="GSTIN" hint="State and PAN are read from it">
          {(p) => <input {...p} maxLength={15} value={f.gstin} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} />}
        </Field>
      ) : (
        <Field label="State">
          {(p) => (
            <select {...p} value={f.stateCode} onChange={(e) => set({ stateCode: e.target.value })}>
              <option value="">Choose…</option>
              {reference.states.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} · {s.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <Field label="Legal name">{(p) => <input {...p} value={f.legalName} onChange={(e) => set({ legalName: e.target.value })} />}</Field>
      <Field label="Trade name (optional)">{(p) => <input {...p} value={f.tradeName} onChange={(e) => set({ tradeName: e.target.value })} />}</Field>
      <Field label="Address">{(p) => <input {...p} maxLength={100} value={f.addressLine1} onChange={(e) => set({ addressLine1: e.target.value })} />}</Field>
      <Field label="Address line 2 (optional)">{(p) => <input {...p} maxLength={100} value={f.addressLine2} onChange={(e) => set({ addressLine2: e.target.value })} />}</Field>
      <Field label="City">{(p) => <input {...p} value={f.city} onChange={(e) => set({ city: e.target.value })} />}</Field>
      <Field label="Pincode">{(p) => <input {...p} inputMode="numeric" maxLength={6} value={f.pincode} onChange={(e) => set({ pincode: e.target.value })} />}</Field>
      <Field label="PAN (optional)" hint={registered ? 'Taken from the GSTIN if blank' : undefined}>
        {(p) => <input {...p} maxLength={10} value={f.pan} onChange={(e) => set({ pan: e.target.value.toUpperCase() })} />}
      </Field>
      <Field label="TAN (optional)" hint="Needed to deduct TDS">
        {(p) => <input {...p} maxLength={10} value={f.tan} onChange={(e) => set({ tan: e.target.value.toUpperCase() })} />}
      </Field>
      <Field label="HSN digits on invoices" hint="4 up to ₹5 crore turnover, 6 above">
        {(p) => (
          <select {...p} value={f.hsnMinDigits} onChange={(e) => set({ hsnMinDigits: e.target.value })}>
            <option value="4">4</option>
            <option value="6">6</option>
            <option value="8">8</option>
          </select>
        )}
      </Field>
      <Field label="B2C large-invoice limit (₹)" hint="Inter-state B2C invoices above this are reported one by one">
        {(p) => <input {...p} inputMode="decimal" value={f.b2clThreshold} onChange={(e) => set({ b2clThreshold: e.target.value })} />}
      </Field>
      <div className="field field-check form-wide">
        <input
          id="einvoice-on"
          type="checkbox"
          disabled={f.registrationType !== 'regular'}
          checked={f.registrationType === 'regular' && f.einvoiceEnabled}
          onChange={(e) => set({ einvoiceEnabled: e.target.checked })}
        />
        <label htmlFor="einvoice-on">E-invoicing applies (aggregate turnover above the notified limit)</label>
      </div>
      <Field label="Register e-invoices within (days, optional)" hint="If a reporting time limit applies to you">
        {(p) => (
          <input {...p} inputMode="numeric" value={f.einvoiceReportWithinDays} onChange={(e) => set({ einvoiceReportWithinDays: e.target.value })} />
        )}
      </Field>
      <Field label="TDS on farmer purchases" hint="e.g. 194Q once your own turnover is above ₹10 crore">
        {(p) => (
          <select {...p} value={f.farmerTdsSection} onChange={(e) => set({ farmerTdsSection: e.target.value })}>
            <option value="">None</option>
            {codes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
      </Field>
    </FormDialog>
  );
}

// ---- Rules ----

function EndRuleDialog({ kind, id, label, from, onClose }: { kind: 'gst-rates' | 'tds-sections'; id: string; label: string; from: string; onClose: () => void }) {
  const [date, setDate] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const end = useAction(() => apiSend('POST', `tax/${kind}/${id}/end`, { effectiveTo: date }), [KEYS.tax], onClose);
  return (
    <FormDialog
      title={`End ${label}`}
      description={<p>The rule stops applying after this date. Invoices and deductions already made keep it.</p>}
      submitLabel="End rule"
      tone="danger"
      pending={end.isPending}
      error={problem ?? end.error}
      onClose={onClose}
      onSubmit={() => {
        if (!date) return setProblem('Choose the last day it applies.');
        setProblem(null);
        end.mutate(undefined);
      }}
    >
      <Field label="Last day it applies">{(p) => <input {...p} type="date" min={from} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
    </FormDialog>
  );
}

function RuleStatus({ rule }: { rule: { source: string; inForce: boolean; effectiveTo: string | null } }) {
  return (
    <>
      {rule.inForce ? <StatusBadge status="active" tone="done" label="In force" /> : <StatusBadge status="inactive" label="Not in force" />}{' '}
      <StatusBadge status={rule.source} tone={rule.source === 'tenant' ? 'active' : 'muted'} label={rule.source === 'tenant' ? 'Yours' : 'Default'} />
    </>
  );
}

export function GstRatesView({ rates, canConfigure }: { rates: GstRateView[]; canConfigure: boolean }) {
  const [adding, setAdding] = useState(false);
  const [ending, setEnding] = useState<GstRateView | null>(null);
  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        A product&apos;s HSN picks the rule with the longest matching code in force on the invoice date; at the same
        length, your own rule wins over the default. A rate change is a new rule from a new date — past invoices keep
        theirs.
      </p>
      {canConfigure && (
        <ActionBar>
          <button type="button" className="button button-primary" onClick={() => setAdding(true)}>
            Add a GST rule
          </button>
        </ActionBar>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>HSN / SAC</th>
              <th>Description</th>
              <th>Treatment</th>
              <th className="num">GST</th>
              <th className="num">Cess</th>
              <th>From</th>
              <th>To</th>
              <th />
              {canConfigure && <th />}
            </tr>
          </thead>
          <tbody>
            {rates.length === 0 && <EmptyRow colSpan={9}>No GST rules.</EmptyRow>}
            {rates.map((r) => (
              <tr key={r.id}>
                <td className="st-number">{r.hsnCode}</td>
                <td>{r.description}</td>
                <td>{TAXABILITY_LABEL[r.taxability]}</td>
                <td className="num">{r.taxability === 'taxable' ? `${Number(r.rate)}%` : '—'}</td>
                <td className="num">{Number(r.cessRate) ? `${Number(r.cessRate)}%` : '—'}</td>
                <td>{formatDate(r.effectiveFrom)}</td>
                <td>{r.effectiveTo ? formatDate(r.effectiveTo) : '—'}</td>
                <td>
                  <RuleStatus rule={r} />
                </td>
                {canConfigure && (
                  <td>
                    {r.source === 'tenant' && !r.effectiveTo && (
                      <button type="button" className="button button-small" onClick={() => setEnding(r)}>
                        End
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding && <GstRateDialog onClose={() => setAdding(false)} />}
      {ending && (
        <EndRuleDialog kind="gst-rates" id={ending.id} label={`the ${ending.hsnCode} rule`} from={ending.effectiveFrom} onClose={() => setEnding(null)} />
      )}
    </>
  );
}

function GstRateDialog({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ hsnCode: '', description: '', supplyKind: 'goods', taxability: 'taxable', rate: '', cessRate: '', effectiveFrom: '' });
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const [problem, setProblem] = useState<string | null>(null);
  const create = useAction((body: unknown) => apiSend<GstRateView>('POST', 'tax/gst-rates', body), [KEYS.tax], onClose);
  const taxable = f.taxability === 'taxable';
  const submit = () => {
    if (!/^[0-9]{2,8}$/.test(f.hsnCode)) return setProblem('The HSN/SAC code is 2 to 8 digits.');
    if (f.description.trim().length < 3) return setProblem('Describe what the code covers.');
    if (!f.effectiveFrom) return setProblem('Choose the date the rule starts.');
    let rate = 0;
    let cess = 0;
    if (taxable) {
      const r = parseDecimal(f.rate, 'the GST rate', { decimals: 2, max: 100 });
      if (!r.ok) return setProblem(r.error);
      rate = r.value;
      if (f.cessRate.trim()) {
        const c = parseDecimal(f.cessRate, 'the cess rate', { decimals: 2, max: 400 });
        if (!c.ok) return setProblem(c.error);
        cess = c.value;
      }
    }
    setProblem(null);
    create.mutate({ hsnCode: f.hsnCode, description: f.description.trim(), supplyKind: f.supplyKind, taxability: f.taxability, rate, cessRate: cess, effectiveFrom: f.effectiveFrom });
  };
  return (
    <FormDialog
      title="Add a GST rule"
      description={<p>Your earlier rule for the same code, if any, ends the day before this one starts.</p>}
      submitLabel="Add rule"
      pending={create.isPending}
      error={problem ?? create.error}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field label="HSN / SAC code" hint="A shorter code covers every longer one under it">
        {(p) => <input {...p} inputMode="numeric" maxLength={8} value={f.hsnCode} onChange={(e) => set({ hsnCode: e.target.value })} />}
      </Field>
      <Field label="Goods or services">
        {(p) => (
          <select {...p} value={f.supplyKind} onChange={(e) => set({ supplyKind: e.target.value })}>
            <option value="goods">Goods (HSN)</option>
            <option value="services">Services (SAC)</option>
          </select>
        )}
      </Field>
      <Field label="Description" wide>
        {(p) => <input {...p} maxLength={300} value={f.description} onChange={(e) => set({ description: e.target.value })} />}
      </Field>
      <Field label="Treatment">
        {(p) => (
          <select {...p} value={f.taxability} onChange={(e) => set({ taxability: e.target.value })}>
            {Object.entries(TAXABILITY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Starts on">{(p) => <input {...p} type="date" value={f.effectiveFrom} onChange={(e) => set({ effectiveFrom: e.target.value })} />}</Field>
      {taxable && (
        <>
          <Field label="GST rate (%)" hint="Split CGST + SGST within the state, IGST across states">
            {(p) => <input {...p} inputMode="decimal" value={f.rate} onChange={(e) => set({ rate: e.target.value })} />}
          </Field>
          <Field label="Cess rate (%, optional)">{(p) => <input {...p} inputMode="decimal" value={f.cessRate} onChange={(e) => set({ cessRate: e.target.value })} />}</Field>
        </>
      )}
    </FormDialog>
  );
}

const BASIS_LABEL = { excess_over_annual: 'Only the part above the annual limit', full_once_crossed: 'All of it, once a limit is crossed' } as const;

export function TdsSectionsView({ sections, canConfigure }: { sections: TdsSectionView[]; canConfigure: boolean }) {
  const [adding, setAdding] = useState(false);
  const [ending, setEnding] = useState<TdsSectionView | null>(null);
  const money = (v: string | null) => (v === null ? '—' : `₹${Number(v).toLocaleString('en-IN')}`);
  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        The defaults use the Income-tax Act, 1961 section numbers. Check the rates, limits and numbering with your
        accountant — from 1 April 2026 the Income-tax Act, 2025 renumbers them. Add your own rule for a code to override
        the default.
      </p>
      {canConfigure && (
        <ActionBar>
          <button type="button" className="button button-primary" onClick={() => setAdding(true)}>
            Add a TDS section
          </button>
        </ActionBar>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Section</th>
              <th>What it covers</th>
              <th className="num">Individual / HUF</th>
              <th className="num">Others</th>
              <th className="num">No PAN</th>
              <th className="num">Per payment</th>
              <th className="num">Per year</th>
              <th>Taxed</th>
              <th>From</th>
              <th />
              {canConfigure && <th />}
            </tr>
          </thead>
          <tbody>
            {sections.map((s) => (
              <tr key={s.id}>
                <td className="st-number">{s.code}</td>
                <td>{s.description}</td>
                <td className="num">{Number(s.rateIndividual)}%</td>
                <td className="num">{Number(s.rateOther)}%</td>
                <td className="num">{Number(s.rateNoPan)}%</td>
                <td className="num">{money(s.singleThreshold)}</td>
                <td className="num">{money(s.annualThreshold)}</td>
                <td className="muted">{BASIS_LABEL[s.basis]}</td>
                <td>
                  {formatDate(s.effectiveFrom)}
                  {s.effectiveTo && <div className="cell-sub">to {formatDate(s.effectiveTo)}</div>}
                </td>
                <td>
                  <RuleStatus rule={s} />
                </td>
                {canConfigure && (
                  <td>
                    {s.source === 'tenant' && !s.effectiveTo && (
                      <button type="button" className="button button-small" onClick={() => setEnding(s)}>
                        End
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding && <TdsSectionDialog onClose={() => setAdding(false)} />}
      {ending && <EndRuleDialog kind="tds-sections" id={ending.id} label={`your ${ending.code} rule`} from={ending.effectiveFrom} onClose={() => setEnding(null)} />}
    </>
  );
}

function TdsSectionDialog({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({
    code: '',
    description: '',
    rateIndividual: '',
    rateOther: '',
    rateNoPan: '20',
    singleThreshold: '',
    annualThreshold: '',
    basis: 'full_once_crossed',
    effectiveFrom: '',
  });
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const [problem, setProblem] = useState<string | null>(null);
  const create = useAction((body: unknown) => apiSend<TdsSectionView>('POST', 'tax/tds-sections', body), [KEYS.tax], onClose);
  const submit = () => {
    if (!f.code.trim()) return setProblem('Enter the section code.');
    if (f.description.trim().length < 3) return setProblem('Describe what the section covers.');
    if (!f.effectiveFrom) return setProblem('Choose the date it starts.');
    const rates = [
      parseDecimal(f.rateIndividual, 'the individual/HUF rate', { decimals: 3, max: 100 }),
      parseDecimal(f.rateOther, 'the rate for others', { decimals: 3, max: 100 }),
      parseDecimal(f.rateNoPan, 'the no-PAN rate', { decimals: 3, max: 100 }),
    ];
    for (const r of rates) if (!r.ok) return setProblem(r.error);
    const limit = (v: string, label: string) => (v.trim() ? parseMoney(v, label) : ({ ok: true, value: null } as const));
    const single = limit(f.singleThreshold, 'the per-payment limit');
    const annual = limit(f.annualThreshold, 'the annual limit');
    if (!single.ok) return setProblem(single.error);
    if (!annual.ok) return setProblem(annual.error);
    if (f.basis === 'excess_over_annual' && annual.value === null) return setProblem('"Only the part above" needs an annual limit.');
    setProblem(null);
    const [ind, other, noPan] = rates.map((r) => (r as { value: number }).value);
    create.mutate({
      code: f.code.trim(),
      description: f.description.trim(),
      rateIndividual: ind,
      rateOther: other,
      rateNoPan: noPan,
      singleThreshold: single.value,
      annualThreshold: annual.value,
      basis: f.basis,
      effectiveFrom: f.effectiveFrom,
    });
  };
  return (
    <FormDialog title="Add a TDS section" submitLabel="Add section" size="wide" pending={create.isPending} error={problem ?? create.error} onClose={onClose} onSubmit={submit}>
      <Field label="Section code" hint="e.g. 194Q, or the new Act's numbering">
        {(p) => <input {...p} maxLength={20} value={f.code} onChange={(e) => set({ code: e.target.value })} />}
      </Field>
      <Field label="Starts on">{(p) => <input {...p} type="date" value={f.effectiveFrom} onChange={(e) => set({ effectiveFrom: e.target.value })} />}</Field>
      <Field label="What it covers" wide>
        {(p) => <input {...p} maxLength={300} value={f.description} onChange={(e) => set({ description: e.target.value })} />}
      </Field>
      <Field label="Rate — individual / HUF (%)">{(p) => <input {...p} inputMode="decimal" value={f.rateIndividual} onChange={(e) => set({ rateIndividual: e.target.value })} />}</Field>
      <Field label="Rate — others (%)">{(p) => <input {...p} inputMode="decimal" value={f.rateOther} onChange={(e) => set({ rateOther: e.target.value })} />}</Field>
      <Field label="Rate — no PAN (%)">{(p) => <input {...p} inputMode="decimal" value={f.rateNoPan} onChange={(e) => set({ rateNoPan: e.target.value })} />}</Field>
      <Field label="How much is taxed">
        {(p) => (
          <select {...p} value={f.basis} onChange={(e) => set({ basis: e.target.value })}>
            {Object.entries(BASIS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Per-payment limit (₹, optional)">{(p) => <input {...p} inputMode="decimal" value={f.singleThreshold} onChange={(e) => set({ singleThreshold: e.target.value })} />}</Field>
      <Field label="Annual limit (₹, optional)">{(p) => <input {...p} inputMode="decimal" value={f.annualThreshold} onChange={(e) => set({ annualThreshold: e.target.value })} />}</Field>
    </FormDialog>
  );
}
