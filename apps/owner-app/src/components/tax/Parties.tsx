'use client';

import { useState } from 'react';
import type { CustomerTaxRow, FarmerTaxRow, ProductTaxRow, TaxReference } from '@morbeez/shared-types';
import { Field, FormDialog } from '@/components/ui/Form';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyRow } from '@/components/ui/ListControls';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { formatMoney } from '@/lib/format';

const TREATMENT = { taxable: 'Taxable', nil_rated: 'Nil-rated', exempt: 'Exempt', non_gst: 'Non-GST' } as const;

const opt = (v: string) => (v.trim() === '' ? undefined : v.trim());

// ---- Products: HSN ----

export function ProductsTaxView({ rows, minDigits, canConfigure }: { rows: ProductTaxRow[]; minDigits: number; canConfigure: boolean }) {
  const [editing, setEditing] = useState<ProductTaxRow | null>(null);
  const missing = rows.filter((r) => r.status === 'active' && (!r.hsnCode || !r.rule)).length;
  return (
    <>
      {missing > 0 && (
        <p className="action-note">
          {missing} active product(s) have no HSN code or no GST rule for it. They&apos;re invoiced without GST and flagged on
          the returns until fixed.
        </p>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Product</th>
              <th>HSN</th>
              <th>Unit (UQC)</th>
              <th>Rule today</th>
              {canConfigure && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={5}>No products yet.</EmptyRow>}
            {rows.map((r) => (
              <tr key={r.productId}>
                <td>
                  {r.name} {r.status === 'archived' && <StatusBadge status="archived" />}
                </td>
                <td className="st-number">
                  {r.hsnCode ?? <StatusBadge status="missing" tone="attention" label="Missing" />}
                  {r.hsnCode && r.hsnCode.length < minDigits && (
                    <div className="cell-sub">Shorter than the {minDigits} digits invoices need</div>
                  )}
                </td>
                <td>
                  {r.baseUom} · {r.uqc}
                </td>
                <td>
                  {r.rule ? (
                    <>
                      {r.rule.taxability === 'taxable' ? `${Number(r.rule.rate)}% GST` : TREATMENT[r.rule.taxability]}
                      <div className="cell-sub">
                        {r.rule.hsnCode} · {r.rule.description}
                      </div>
                    </>
                  ) : r.hsnCode ? (
                    <StatusBadge status="no_rule" tone="attention" label="No rule for this code" />
                  ) : (
                    '—'
                  )}
                </td>
                {canConfigure && (
                  <td>
                    <button type="button" className="button button-small" onClick={() => setEditing(r)}>
                      {r.hsnCode ? 'Change' : 'Set HSN'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <HsnDialog row={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function HsnDialog({ row, onClose }: { row: ProductTaxRow; onClose: () => void }) {
  const [hsn, setHsn] = useState(row.hsnCode ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction(() => apiSend('PUT', `tax/products/${row.productId}`, { hsnCode: hsn }), [KEYS.tax], onClose);
  return (
    <FormDialog
      title={`HSN code — ${row.name}`}
      description={<p>Fresh vegetables are chapter 07 (e.g. 0702 tomatoes, 0703 onions). Past invoices keep the code they were issued with.</p>}
      submitLabel="Save"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        if (!/^[0-9]{4,8}$/.test(hsn)) return setProblem('An HSN code on a product is 4 to 8 digits.');
        setProblem(null);
        save.mutate(undefined);
      }}
    >
      <Field label="HSN code">{(p) => <input {...p} inputMode="numeric" maxLength={8} value={hsn} onChange={(e) => setHsn(e.target.value)} />}</Field>
    </FormDialog>
  );
}

// ---- Customers: GSTIN and place of supply ----

export function CustomersTaxView({ rows, reference, canConfigure }: { rows: CustomerTaxRow[]; reference: TaxReference; canConfigure: boolean }) {
  const [editing, setEditing] = useState<CustomerTaxRow | null>(null);
  const stateName = (code: string | null) => (code ? reference.states.find((s) => s.code === code)?.name ?? code : null);
  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        A customer with a GSTIN is a B2B sale (and e-invoiced, if that applies to you). The state is the place of supply —
        your own state means CGST + SGST, any other IGST. With none recorded, a sale is treated as within your state.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>GSTIN</th>
              <th>Place of supply</th>
              <th>Billing address</th>
              {canConfigure && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={5}>No customers yet.</EmptyRow>}
            {rows.map((r) => (
              <tr key={r.customerId}>
                <td>
                  {r.name} {r.status === 'archived' && <StatusBadge status="archived" />}
                  {r.legalName && r.legalName !== r.name && <div className="cell-sub">{r.legalName}</div>}
                </td>
                <td className="st-number">{r.gstin ?? <span className="muted">Unregistered</span>}</td>
                <td>{stateName(r.stateCode) ?? <span className="muted">Not set</span>}</td>
                <td className="muted">{[r.addressLine1, r.city, r.pincode].filter(Boolean).join(', ') || '—'}</td>
                {canConfigure && (
                  <td>
                    <button type="button" className="button button-small" onClick={() => setEditing(r)}>
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <CustomerTaxDialog row={editing} reference={reference} onClose={() => setEditing(null)} />}
    </>
  );
}

function CustomerTaxDialog({ row, reference, onClose }: { row: CustomerTaxRow; reference: TaxReference; onClose: () => void }) {
  const [f, setF] = useState({
    gstin: row.gstin ?? '',
    legalName: row.legalName ?? '',
    stateCode: row.stateCode ?? '',
    addressLine1: row.addressLine1 ?? '',
    city: row.city ?? '',
    pincode: row.pincode ?? '',
  });
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('PUT', `tax/customers/${row.customerId}`, body), [KEYS.tax], onClose);
  const registered = f.gstin.trim() !== '';
  return (
    <FormDialog
      title={`Tax details — ${row.name}`}
      description={<p>Applies to invoices issued from now on.</p>}
      submitLabel="Save"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        if (!registered && !f.stateCode) return setProblem("Choose the customer's state, or enter their GSTIN.");
        setProblem(null);
        save.mutate({
          gstin: opt(f.gstin),
          legalName: opt(f.legalName),
          stateCode: registered ? undefined : f.stateCode,
          addressLine1: opt(f.addressLine1),
          city: opt(f.city),
          pincode: opt(f.pincode),
        });
      }}
    >
      <Field label="GSTIN (blank if unregistered)" hint="The state is read from it">
        {(p) => <input {...p} maxLength={15} value={f.gstin} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} />}
      </Field>
      {!registered && (
        <Field label="State (place of supply)">
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
      <Field label="Legal name" hint="As registered — needed for e-invoices">
        {(p) => <input {...p} value={f.legalName} onChange={(e) => set({ legalName: e.target.value })} />}
      </Field>
      <Field label="Address">{(p) => <input {...p} maxLength={100} value={f.addressLine1} onChange={(e) => set({ addressLine1: e.target.value })} />}</Field>
      <Field label="City">{(p) => <input {...p} value={f.city} onChange={(e) => set({ city: e.target.value })} />}</Field>
      <Field label="Pincode">{(p) => <input {...p} inputMode="numeric" maxLength={6} value={f.pincode} onChange={(e) => set({ pincode: e.target.value })} />}</Field>
    </FormDialog>
  );
}

// ---- Farmers: PAN and TDS ----

const DEDUCTEE_LABEL = { individual_huf: 'Individual / HUF', other: 'Company, firm or other', no_pan: 'No PAN — higher rate' } as const;

export function FarmersTaxView({
  rows,
  currency,
  section,
  canConfigure,
}: {
  rows: FarmerTaxRow[];
  currency: string;
  section: string | null;
  canConfigure: boolean;
}) {
  const [editing, setEditing] = useState<FarmerTaxRow | null>(null);
  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        {section
          ? `TDS under section ${section} is withheld automatically when a farmer's lot is graded, and the farmer is owed the rest.`
          : 'No TDS section is applied to farmer purchases (Tax settings). A PAN recorded now is used once one is.'}
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Farmer</th>
              <th>PAN</th>
              <th>Deductee</th>
              <th className="num">Purchases this year</th>
              <th className="num">TDS this year</th>
              {canConfigure && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={6}>No farmers yet.</EmptyRow>}
            {rows.map((r) => (
              <tr key={r.farmerId}>
                <td>
                  {r.name} {r.status === 'archived' && <StatusBadge status="archived" />}
                  {r.tdsExempt && (
                    <div className="cell-sub">
                      <StatusBadge status="exempt" tone="muted" label="No TDS" /> {r.exemptReason}
                    </div>
                  )}
                </td>
                <td className="st-number">{r.pan ?? <StatusBadge status="missing" tone="attention" label="Missing" />}</td>
                <td>{DEDUCTEE_LABEL[r.deducteeType]}</td>
                <td className="num">{formatMoney(r.purchasesThisYear, currency)}</td>
                <td className="num">{Number(r.tdsThisYear) ? formatMoney(r.tdsThisYear, currency) : '—'}</td>
                {canConfigure && (
                  <td>
                    <button type="button" className="button button-small" onClick={() => setEditing(r)}>
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <FarmerTaxDialog row={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function FarmerTaxDialog({ row, onClose }: { row: FarmerTaxRow; onClose: () => void }) {
  const [pan, setPan] = useState(row.pan ?? '');
  const [type, setType] = useState(row.deducteeTypeSet ? row.deducteeType : '');
  const [exempt, setExempt] = useState(row.tdsExempt);
  const [reason, setReason] = useState(row.exemptReason ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('PUT', `tax/farmers/${row.farmerId}`, body), [KEYS.tax], onClose);
  return (
    <FormDialog
      title={`PAN and TDS — ${row.name}`}
      description={<p>Without a PAN, TDS is withheld at the section&apos;s higher no-PAN rate.</p>}
      submitLabel="Save"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        if (pan.trim() && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan.trim())) return setProblem('A PAN is 5 letters, 4 digits, 1 letter.');
        if (exempt && reason.trim().length < 3) return setProblem('Say why no TDS applies (e.g. a lower-deduction certificate).');
        setProblem(null);
        save.mutate({ pan: opt(pan), deducteeType: type || undefined, tdsExempt: exempt, exemptReason: exempt ? reason.trim() : undefined });
      }}
    >
      <Field label="PAN">{(p) => <input {...p} maxLength={10} value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} />}</Field>
      <Field label="Deductee type" hint="Read from the PAN unless set">
        {(p) => (
          <select {...p} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">From the PAN</option>
            <option value="individual_huf">Individual / HUF</option>
            <option value="other">Company, firm or other</option>
          </select>
        )}
      </Field>
      <div className="field field-check form-wide">
        <input id="tds-exempt" type="checkbox" checked={exempt} onChange={(e) => setExempt(e.target.checked)} />
        <label htmlFor="tds-exempt">No TDS on this farmer</label>
      </div>
      {exempt && (
        <Field label="Why" wide>
          {(p) => <input {...p} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      )}
    </FormDialog>
  );
}
