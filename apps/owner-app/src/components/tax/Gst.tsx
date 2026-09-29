'use client';

import { Fragment, useState } from 'react';
import type { Gstr1, Gstr3b, HsnSummaryRow, RateBucket, TaxInvoiceRow, TaxReference } from '@morbeez/shared-types';
import { Field, FormDialog } from '@/components/ui/Form';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyRow, Figures } from '@/components/ui/ListControls';
import { apiGet, apiSend } from '@/lib/api/client';
import { actionErrorMessage, KEYS, useAction } from '@/lib/hooks/use-action';
import { formatAmount, formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { sumMoney } from '@/lib/decimal';

const DOC_LABEL = { tax_invoice: 'Tax invoice', bill_of_supply: 'Bill of supply', invoice: 'Invoice' } as const;

const EINVOICE_BADGE: Record<TaxInvoiceRow['einvoice']['status'], { tone: 'done' | 'attention' | 'bad' | 'muted' | 'active'; label: string }> = {
  not_applicable: { tone: 'muted', label: 'Not applicable' },
  missing_data: { tone: 'bad', label: 'Missing details' },
  ready: { tone: 'attention', label: 'Ready — needs IRN' },
  registered: { tone: 'done', label: 'IRN registered' },
  cancelled: { tone: 'muted', label: 'IRN cancelled' },
};

function stateLabel(reference: TaxReference, code: string | null) {
  if (!code) return '—';
  return `${code} · ${reference.states.find((s) => s.code === code)?.name ?? ''}`;
}

/** Saves the IRP request body as a .json file for the portal's upload or a GSP. */
async function downloadJson(row: TaxInvoiceRow): Promise<string | null> {
  try {
    const json = await apiGet<Record<string, unknown>>(`tax/einvoices/${row.invoiceId}/json`);
    const blob = new Blob([JSON.stringify([json], null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${row.invoiceNumber}-einvoice.json`;
    a.click();
    URL.revokeObjectURL(url);
    return null;
  } catch (error) {
    return actionErrorMessage(error);
  }
}

export function InvoicesView({
  rows,
  reference,
  currency,
  timeZone,
  canFile,
}: {
  rows: TaxInvoiceRow[];
  reference: TaxReference;
  currency: string;
  timeZone: string;
  canFile: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [recording, setRecording] = useState<TaxInvoiceRow | null>(null);
  const [cancelling, setCancelling] = useState<TaxInvoiceRow | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const needIrn = rows.filter((r) => r.einvoice.status === 'ready' || r.einvoice.status === 'missing_data');
  return (
    <>
      <Figures
        items={[
          { label: 'Invoices', value: String(rows.length) },
          { label: 'Taxable value', value: formatMoney(sumMoney(rows.map((r) => r.taxableValue)), currency) },
          { label: 'GST charged', value: formatMoney(sumMoney(rows.flatMap((r) => [r.cgst, r.sgst, r.igst, r.cess])), currency) },
          { label: 'Waiting for an IRN', value: String(needIrn.length), tone: needIrn.length ? 'attention' : undefined },
        ]}
      />
      {downloadError && (
        <p className="form-error" role="alert">
          {downloadError}
        </p>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Customer</th>
              <th>Place of supply</th>
              <th className="num">Taxable</th>
              <th className="num">CGST + SGST</th>
              <th className="num">IGST</th>
              <th className="num">Total</th>
              <th>E-invoice</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={8}>No sale invoices in this period.</EmptyRow>}
            {rows.map((r) => {
              const badge = EINVOICE_BADGE[r.einvoice.status];
              const expanded = open === r.invoiceId;
              return (
                <Fragment key={r.invoiceId}>
                  <tr>
                    <td>
                      <button type="button" className="link-button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : r.invoiceId)}>
                        {expanded ? '▾' : '▸'} {r.invoiceNumber}
                      </button>
                      <div className="cell-sub">
                        {formatDate(r.issuedOn)} · {DOC_LABEL[r.documentType]}
                      </div>
                    </td>
                    <td>
                      {r.customerName}
                      <div className="cell-sub">{r.buyerGstin ?? 'Unregistered'}</div>
                    </td>
                    <td>{stateLabel(reference, r.placeOfSupply)}</td>
                    <td className="num">{formatAmount(r.taxableValue)}</td>
                    <td className="num">{Number(r.cgst) ? formatAmount(sumMoney([r.cgst, r.sgst])) : '—'}</td>
                    <td className="num">{Number(r.igst) ? formatAmount(r.igst) : '—'}</td>
                    <td className="num">{formatAmount(r.total)}</td>
                    <td>
                      <StatusBadge status={r.einvoice.status} tone={badge.tone} label={badge.label} />
                      {r.unclassifiedLines > 0 && (
                        <div className="cell-sub" data-tone="bad">
                          {r.unclassifiedLines} line(s) without HSN/rule
                        </div>
                      )}
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="journal-detail">
                      <td colSpan={8}>
                        <EinvoiceDetail
                          row={r}
                          timeZone={timeZone}
                          canFile={canFile}
                          onDownload={async () => setDownloadError(await downloadJson(r))}
                          onRecord={() => setRecording(r)}
                          onCancel={() => setCancelling(r)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="footnote">
        Morbeez prepares the e-invoice (IRP schema 1.1); register it on the Invoice Registration Portal or through your
        GSP, then record the IRN here. Finance-charge invoices aren&apos;t analysed for GST.
      </p>
      {recording && <RecordIrnDialog row={recording} onClose={() => setRecording(null)} />}
      {cancelling && <CancelIrnDialog row={cancelling} onClose={() => setCancelling(null)} />}
    </>
  );
}

function EinvoiceDetail({
  row,
  timeZone,
  canFile,
  onDownload,
  onRecord,
  onCancel,
}: {
  row: TaxInvoiceRow;
  timeZone: string;
  canFile: boolean;
  onDownload: () => void;
  onRecord: () => void;
  onCancel: () => void;
}) {
  const e = row.einvoice;
  if (e.status === 'not_applicable') return <p className="muted">{e.issues[0]}</p>;
  if (e.status === 'missing_data') {
    return (
      <>
        <p>Fill these in before it can be registered:</p>
        <ul className="plain-list">
          {e.issues.map((i) => (
            <li key={i}>• {i}</li>
          ))}
        </ul>
        {e.reportBy && <p className="footnote">Register by {formatDate(e.reportBy)}.</p>}
      </>
    );
  }
  if (e.status === 'ready') {
    return (
      <>
        <p>
          Ready for the IRP{e.reportBy && <> — register by {formatDate(e.reportBy)}</>}.
        </p>
        <div className="action-bar">
          <button type="button" className="button" onClick={onDownload}>
            Download e-invoice JSON
          </button>
          {canFile && (
            <button type="button" className="button button-primary" onClick={onRecord}>
              Record IRN
            </button>
          )}
        </div>
      </>
    );
  }
  const cancellable = e.status === 'registered' && e.cancellableUntil && new Date(e.cancellableUntil).getTime() > Date.now();
  return (
    <>
      <dl className="key-values">
        <div>
          <dt>IRN</dt>
          <dd className="st-number" style={{ wordBreak: 'break-all' }}>
            {e.irn}
          </dd>
        </div>
        <div>
          <dt>Acknowledgement</dt>
          <dd>
            {e.ackNo} · {formatDateTime(e.ackDate, timeZone)}
          </dd>
        </div>
      </dl>
      {canFile && cancellable && (
        <div className="action-bar">
          <button type="button" className="button button-danger" onClick={onCancel}>
            Record IRN cancellation
          </button>
          <span className="muted">Possible until {formatDateTime(e.cancellableUntil, timeZone)}</span>
        </div>
      )}
    </>
  );
}

function RecordIrnDialog({ row, onClose }: { row: TaxInvoiceRow; onClose: () => void }) {
  const [irn, setIrn] = useState('');
  const [ackNo, setAckNo] = useState('');
  const [ackAt, setAckAt] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('POST', `tax/einvoices/${row.invoiceId}/irn`, body), [KEYS.tax], onClose);
  return (
    <FormDialog
      title={`Record IRN — ${row.invoiceNumber}`}
      description={<p>Copy these from the IRP&apos;s response after registering the invoice.</p>}
      submitLabel="Record"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        if (!/^[0-9a-fA-F]{64}$/.test(irn.trim())) return setProblem('An IRN is 64 hexadecimal characters.');
        if (!/^[0-9]{1,20}$/.test(ackNo.trim())) return setProblem('The acknowledgement number is digits only.');
        if (!ackAt) return setProblem('Enter the acknowledgement date and time.');
        setProblem(null);
        save.mutate({ irn: irn.trim(), ackNo: ackNo.trim(), ackDate: new Date(ackAt).toISOString() });
      }}
    >
      <Field label="IRN" wide>
        {(p) => <input {...p} maxLength={64} value={irn} onChange={(e) => setIrn(e.target.value)} />}
      </Field>
      <Field label="Acknowledgement number">{(p) => <input {...p} inputMode="numeric" value={ackNo} onChange={(e) => setAckNo(e.target.value)} />}</Field>
      <Field label="Acknowledged at">{(p) => <input {...p} type="datetime-local" value={ackAt} onChange={(e) => setAckAt(e.target.value)} />}</Field>
    </FormDialog>
  );
}

function CancelIrnDialog({ row, onClose }: { row: TaxInvoiceRow; onClose: () => void }) {
  const [reason, setReason] = useState('2');
  const [remark, setRemark] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('POST', `tax/einvoices/${row.invoiceId}/cancel`, body), [KEYS.tax], onClose);
  return (
    <FormDialog
      title={`Record IRN cancellation — ${row.invoiceNumber}`}
      description={<p>Cancel it on the IRP first; this records that it was. After 24 hours only a credit note can correct it.</p>}
      submitLabel="Record cancellation"
      tone="danger"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        if (remark.trim().length < 3) return setProblem('Add a short remark.');
        setProblem(null);
        save.mutate({ reasonCode: reason, remark: remark.trim() });
      }}
    >
      <Field label="Reason">
        {(p) => (
          <select {...p} value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="1">Duplicate</option>
            <option value="2">Data entry mistake</option>
            <option value="3">Order cancelled</option>
            <option value="4">Other</option>
          </select>
        )}
      </Field>
      <Field label="Remark">{(p) => <input {...p} maxLength={100} value={remark} onChange={(e) => setRemark(e.target.value)} />}</Field>
    </FormDialog>
  );
}

// ---- Returns ----

function RateCells({ b }: { b: Pick<RateBucket, 'taxableValue' | 'igst' | 'cgst' | 'sgst' | 'cess'> }) {
  return (
    <>
      <td className="num">{formatAmount(b.taxableValue)}</td>
      <td className="num">{formatAmount(b.igst)}</td>
      <td className="num">{formatAmount(b.cgst)}</td>
      <td className="num">{formatAmount(b.sgst)}</td>
      <td className="num">{formatAmount(b.cess)}</td>
    </>
  );
}

const TAX_HEAD = (
  <>
    <th className="num">Taxable</th>
    <th className="num">IGST</th>
    <th className="num">CGST</th>
    <th className="num">SGST</th>
    <th className="num">Cess</th>
  </>
);

function HsnTable({ title, rows }: { title: string; rows: HsnSummaryRow[] }) {
  return (
    <div className="table-wrap">
      <table className="table statement">
        <caption className="st-caption">{title}</caption>
        <thead>
          <tr>
            <th>HSN</th>
            <th>UQC</th>
            <th className="num">Rate</th>
            <th className="num">Quantity</th>
            <th className="num">Total value</th>
            {TAX_HEAD}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow colSpan={10}>None.</EmptyRow>}
          {rows.map((h) => (
            <tr key={`${h.hsnCode}-${h.uqc}-${h.rate}`}>
              <td className="st-number">{h.hsnCode ?? '—'}</td>
              <td>{h.uqc}</td>
              <td className="num">{Number(h.rate)}%</td>
              <td className="num">{Number(h.quantity).toLocaleString('en-IN', { maximumFractionDigits: 3 })}</td>
              <td className="num">{formatAmount(h.totalValue)}</td>
              <RateCells b={h} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Gstr1View({ data, reference }: { data: Gstr1; reference: TaxReference }) {
  const stateOf = (code: string) => stateLabel(reference, code);
  return (
    <div className="stack">
      {data.issues.map((i) => (
        <p key={i} className="action-note">
          {i}
        </p>
      ))}
      <p className="st-status muted">
        {formatDate(data.from)} – {formatDate(data.to)} · GSTIN {data.supplierGstin ?? '—'} · amounts in {data.currency}
      </p>
      <div className="table-wrap">
        <table className="table statement">
          <caption className="st-caption">B2B — sales to registered buyers (table 4)</caption>
          <thead>
            <tr>
              <th>Buyer GSTIN</th>
              <th>Invoice</th>
              <th>Place of supply</th>
              <th className="num">Invoice value</th>
              <th className="num">Rate</th>
              {TAX_HEAD}
            </tr>
          </thead>
          <tbody>
            {data.b2b.length === 0 && <EmptyRow colSpan={10}>None.</EmptyRow>}
            {data.b2b.flatMap((inv) =>
              inv.rates.map((b, i) => (
                <tr key={`${inv.invoiceNumber}-${b.rate}`}>
                  <td className="st-number">{i === 0 ? inv.buyerGstin : ''}</td>
                  <td>{i === 0 ? `${inv.invoiceNumber} · ${formatDate(inv.issuedOn)}` : ''}</td>
                  <td>{i === 0 ? stateOf(inv.placeOfSupply) : ''}</td>
                  <td className="num">{i === 0 ? formatAmount(inv.invoiceValue) : ''}</td>
                  <td className="num">{Number(b.rate)}%</td>
                  <RateCells b={b} />
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
      <div className="table-wrap">
        <table className="table statement">
          <caption className="st-caption">B2C large — inter-state, unregistered, above the limit (table 5)</caption>
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Place of supply</th>
              <th className="num">Invoice value</th>
              <th className="num">Rate</th>
              {TAX_HEAD}
            </tr>
          </thead>
          <tbody>
            {data.b2cl.length === 0 && <EmptyRow colSpan={9}>None.</EmptyRow>}
            {data.b2cl.flatMap((inv) =>
              inv.rates.map((b) => (
                <tr key={`${inv.invoiceNumber}-${b.rate}`}>
                  <td>{inv.invoiceNumber}</td>
                  <td>{stateOf(inv.placeOfSupply)}</td>
                  <td className="num">{formatAmount(inv.invoiceValue)}</td>
                  <td className="num">{Number(b.rate)}%</td>
                  <RateCells b={b} />
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
      <div className="table-wrap">
        <table className="table statement">
          <caption className="st-caption">B2C small — by place of supply and rate (table 7)</caption>
          <thead>
            <tr>
              <th>Place of supply</th>
              <th>Supply</th>
              <th className="num">Rate</th>
              {TAX_HEAD}
            </tr>
          </thead>
          <tbody>
            {data.b2cs.length === 0 && <EmptyRow colSpan={8}>None.</EmptyRow>}
            {data.b2cs.map((r) => (
              <tr key={`${r.placeOfSupply}-${r.intraState}-${r.rate}`}>
                <td>{stateOf(r.placeOfSupply)}</td>
                <td>{r.intraState ? 'Intra-state' : 'Inter-state'}</td>
                <td className="num">{Number(r.rate)}%</td>
                <RateCells b={r} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-wrap">
        <table className="table statement">
          <caption className="st-caption">Nil-rated, exempt and non-GST (table 8) — fresh vegetables land here</caption>
          <thead>
            <tr>
              <th>Supply</th>
              <th className="num">Nil-rated</th>
              <th className="num">Exempt</th>
              <th className="num">Non-GST</th>
            </tr>
          </thead>
          <tbody>
            {data.nil.map((n) => (
              <tr key={n.description}>
                <td>{n.description}</td>
                <td className="num">{formatAmount(n.nilRated)}</td>
                <td className="num">{formatAmount(n.exempt)}</td>
                <td className="num">{formatAmount(n.nonGst)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <HsnTable title="HSN summary — B2B (table 12)" rows={data.hsn.b2b} />
      <HsnTable title="HSN summary — B2C (table 12)" rows={data.hsn.b2c} />
      <p className="st-status muted">
        Documents issued (table 13): {data.documents.series} {data.documents.from ?? '—'} to {data.documents.to ?? '—'} ·{' '}
        {data.documents.issued} issued, {data.documents.cancelled} cancelled
      </p>
    </div>
  );
}

export function Gstr3bView({ data, reference }: { data: Gstr3b; reference: TaxReference }) {
  const o = data.outwardTaxable;
  return (
    <div className="stack">
      <div className="table-wrap">
        <table className="table statement">
          <caption className="st-caption">
            3.1 Outward supplies, {formatDate(data.from)} – {formatDate(data.to)} · amounts in {data.currency}
          </caption>
          <thead>
            <tr>
              <th>Nature of supply</th>
              {TAX_HEAD}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>(a) Taxable outward supplies</td>
              <RateCells b={o} />
            </tr>
            <tr>
              <td>(c) Nil-rated and exempt</td>
              <td className="num">{formatAmount(data.outwardNilExempt)}</td>
              <td colSpan={4} />
            </tr>
            <tr>
              <td>(e) Non-GST</td>
              <td className="num">{formatAmount(data.outwardNonGst)}</td>
              <td colSpan={4} />
            </tr>
          </tbody>
        </table>
      </div>
      <div className="table-wrap">
        <table className="table statement">
          <caption className="st-caption">3.2 Inter-state supplies to unregistered persons</caption>
          <thead>
            <tr>
              <th>Place of supply</th>
              <th className="num">Taxable</th>
              <th className="num">IGST</th>
            </tr>
          </thead>
          <tbody>
            {data.interStateToUnregistered.length === 0 && <EmptyRow colSpan={3}>None.</EmptyRow>}
            {data.interStateToUnregistered.map((r) => (
              <tr key={r.placeOfSupply}>
                <td>{stateLabel(reference, r.placeOfSupply)}</td>
                <td className="num">{formatAmount(r.taxableValue)}</td>
                <td className="num">{formatAmount(r.igst)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Figures
        items={[
          { label: 'IGST payable', value: formatAmount(data.taxPayable.igst) },
          { label: 'CGST payable', value: formatAmount(data.taxPayable.cgst) },
          { label: 'SGST payable', value: formatAmount(data.taxPayable.sgst) },
          { label: 'Cess payable', value: formatAmount(data.taxPayable.cess) },
        ]}
      />
      {data.notes.map((n) => (
        <p key={n} className="footnote">
          {n}
        </p>
      ))}
    </div>
  );
}
