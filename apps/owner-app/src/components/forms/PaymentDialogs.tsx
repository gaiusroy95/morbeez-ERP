'use client';

import { useState } from 'react';
import type {
  CustomerPaymentRecord,
  FarmerPaymentRecord,
  PaymentMethod,
  RecordCustomerPaymentBody,
  RecordFarmerPaymentBody,
} from '@morbeez/shared-types';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useOpenInvoices, usePayableLots } from '@/lib/hooks/use-modules';
import { useTenantProfile } from '@/lib/hooks/use-lookups';
import { formatDate, formatDay, formatMoney, formatQuantity } from '@/lib/format';
import { firstError, localDateTimeToIso, optionalText, parseMoney, parseOptionalMoney, type Parsed } from '@/lib/parse';
import { Field, FormDialog } from '@/components/ui/Form';
import { SkeletonLines } from '@/components/ui/Panel';
import { useT } from '@/lib/i18n';

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  upi: 'UPI',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
};

// Money moved changes receivables/payables, cash flow, the customer or
// farmer's own view, the purchase order's lot status, and the dashboard.
const PAYMENT_EFFECTS = [KEYS.finance, KEYS.customers, KEYS.procurement, KEYS.dashboard];

function MethodField({ value, onChange }: { value: PaymentMethod; onChange: (m: PaymentMethod) => void }) {
  const t = useT();
  return (
    <Field label={t('Method')}>
      {(props) => (
        <select {...props} value={value} onChange={(e) => onChange(e.target.value as PaymentMethod)}>
          {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
            <option key={m} value={m}>
              {METHOD_LABEL[m]}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/** Per-row "apply" amounts; all blank = the backend's oldest-first default. */
function parseAllocations<K extends string>(
  entries: [string, string][],
  key: K,
  describe: (id: string) => string,
): Parsed<({ amount: number } & Record<K, string>)[] | undefined> {
  const chosen = entries.filter(([, text]) => text.trim() !== '');
  if (chosen.length === 0) return { ok: true, value: undefined };
  const result: ({ amount: number } & Record<K, string>)[] = [];
  for (const [id, text] of chosen) {
    const amount = parseMoney(text, `the amount for ${describe(id)}`, true);
    if (!amount.ok) return amount;
    result.push({ [key]: id, amount: amount.value } as { amount: number } & Record<K, string>);
  }
  return { ok: true, value: result };
}

export function CustomerPaymentDialog({
  customerId,
  customerName,
  currency,
  onClose,
  onDone,
}: {
  customerId: string;
  customerName: string;
  currency: string;
  onClose: () => void;
  onDone?: (payment: CustomerPaymentRecord) => void;
}) {
  const t = useT();
  const invoices = useOpenInvoices(customerId);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [receivedAt, setReceivedAt] = useState('');
  const [fee, setFee] = useState('');
  const [notes, setNotes] = useState('');
  const [apply, setApply] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const record = useAction(
    (body: RecordCustomerPaymentBody) => apiSend<CustomerPaymentRecord>('POST', 'finance/customer-payments', body),
    PAYMENT_EFFECTS,
    (payment) => {
      onDone?.(payment);
      onClose();
    },
  );

  const numberOf = (id: string) => invoices.data?.items.find((i) => i.id === id)?.invoiceNumber ?? 'an invoice';

  const submit = () => {
    const parsedAmount = parseMoney(amount, 'the amount received', true);
    const parsedFee = parseOptionalMoney(fee, 'the fee');
    const allocations = parseAllocations(Object.entries(apply), 'invoiceId', numberOf);
    const error = firstError([parsedAmount, parsedFee, allocations]);
    if (error) return setProblem(error);
    setProblem(null);
    record.mutate({
      customerId,
      amount: (parsedAmount as { value: number }).value,
      feeAmount: (parsedFee as { value: number | undefined }).value,
      method,
      reference: optionalText(reference),
      notes: optionalText(notes),
      receivedAt: localDateTimeToIso(receivedAt),
      allocations: (allocations as { value: { invoiceId: string; amount: number }[] | undefined }).value,
    });
  };

  return (
    <FormDialog
      title={`Record a payment from ${customerName}`}
      description={
        <p>
          {t("Applied to the invoices you fill in below, or — if you leave them all blank — to the oldest open invoices first. Anything left over is held on the customer's account for their next invoice.")}
        </p>
      }
      submitLabel={t('Record payment')}
      size="wide"
      pending={record.isPending}
      error={problem ?? record.error}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field label={`Amount received (${currency})`}>
        {(props) => <input {...props} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
      </Field>
      <MethodField value={method} onChange={setMethod} />
      <Field label={t('Reference (optional)')} hint={t('UPI transaction id, cheque number…')}>
        {(props) => <input {...props} maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} />}
      </Field>
      <Field label={t('Received at (optional)')} hint={t('Leave blank for now')}>
        {(props) => (
          <input {...props} type="datetime-local" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
        )}
      </Field>
      <Field label={`Bank or gateway fee (${currency}, optional)`} hint={t('Deducted by the bank; booked as a finance cost')}>
        {(props) => <input {...props} inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />}
      </Field>
      <Field label={t('Notes (optional)')}>
        {(props) => <input {...props} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </Field>
      <div className="form-wide">
        <h3 className="detail-subhead">{t('Open invoices')}</h3>
        {invoices.isPending ? (
          <SkeletonLines lines={2} />
        ) : !invoices.data || invoices.data.items.length === 0 ? (
          <p className="muted">{t('No open invoices — the whole amount is held on account.')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('Invoice')}</th>
                  <th>{t('Due')}</th>
                  <th className="align-right">{t('Outstanding')}</th>
                  <th className="align-right">{t('Apply')}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.data.items.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>
                      {invoice.invoiceNumber}
                      {invoice.kind === 'finance_charge' && <div className="cell-sub">{t('Finance charge')}</div>}
                      {invoice.kind === 'crate_charge' && <div className="cell-sub">{t('Lost crates')}</div>}
                    </td>
                    <td data-tone={invoice.state === 'overdue' ? 'bad' : undefined}>{formatDate(invoice.dueDate)}</td>
                    <td className="align-right">{formatMoney(invoice.outstanding, currency)}</td>
                    <td className="align-right">
                      <input
                        className="cell-input"
                        aria-label={`Amount to apply to ${invoice.invoiceNumber}`}
                        inputMode="decimal"
                        placeholder="—"
                        value={apply[invoice.id] ?? ''}
                        onChange={(e) => setApply({ ...apply, [invoice.id]: e.target.value })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </FormDialog>
  );
}

export function FarmerPaymentDialog({
  farmerId,
  farmerName,
  currency,
  onClose,
}: {
  farmerId: string;
  farmerName: string;
  currency: string;
  onClose: () => void;
}) {
  const t = useT();
  const lots = usePayableLots(farmerId);
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('upi');
  const [reference, setReference] = useState('');
  const [paidAt, setPaidAt] = useState('');
  const [fee, setFee] = useState('');
  const [notes, setNotes] = useState('');
  const [apply, setApply] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const record = useAction(
    (body: RecordFarmerPaymentBody) => apiSend<FarmerPaymentRecord>('POST', 'finance/farmer-payments', body),
    PAYMENT_EFFECTS,
    onClose,
  );

  const describe = (id: string) => lots.data?.find((l) => l.lotId === id)?.productName ?? 'a lot';

  const submit = () => {
    const parsedAmount = parseMoney(amount, 'the amount paid', true);
    const parsedFee = parseOptionalMoney(fee, 'the fee');
    const allocations = parseAllocations(Object.entries(apply), 'lotId', describe);
    const error = firstError([parsedAmount, parsedFee, allocations]);
    if (error) return setProblem(error);
    setProblem(null);
    record.mutate({
      farmerId,
      amount: (parsedAmount as { value: number }).value,
      feeAmount: (parsedFee as { value: number | undefined }).value,
      method,
      reference: optionalText(reference),
      notes: optionalText(notes),
      paidAt: localDateTimeToIso(paidAt),
      allocations: (allocations as { value: { lotId: string; amount: number }[] | undefined }).value,
    });
  };

  const unpaid = (lots.data ?? []).filter((lot) => Number(lot.outstanding) > 0);

  return (
    <FormDialog
      title={`Pay ${farmerName}`}
      description={
        <p>
          {t("Applied to the lots you fill in below, or — if you leave them all blank — to the oldest unpaid lots first. Anything beyond what's owed is an advance, drawn down by this farmer's next graded lots.")}
        </p>
      }
      submitLabel={t('Record payment')}
      size="wide"
      pending={record.isPending}
      error={problem ?? record.error}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field label={`Amount paid (${currency})`}>
        {(props) => <input {...props} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
      </Field>
      <MethodField value={method} onChange={setMethod} />
      <Field label={t('Reference (optional)')} hint={t('UPI transaction id, cheque number…')}>
        {(props) => <input {...props} maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} />}
      </Field>
      <Field label={t('Paid at (optional)')} hint={t('Leave blank for now')}>
        {(props) => <input {...props} type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />}
      </Field>
      <Field label={`Bank fee (${currency}, optional)`} hint={t('Booked as a finance cost')}>
        {(props) => <input {...props} inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />}
      </Field>
      <Field label={t('Notes (optional)')}>
        {(props) => <input {...props} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </Field>
      <div className="form-wide">
        <h3 className="detail-subhead">{t('Unpaid lots')}</h3>
        {lots.isPending ? (
          <SkeletonLines lines={2} />
        ) : unpaid.length === 0 ? (
          <p className="muted">{t('Nothing unpaid — the whole amount becomes an advance.')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('Graded')}</th>
                  <th>{t('Product')}</th>
                  <th className="align-right">{t('Quantity')}</th>
                  <th className="align-right">{t('Outstanding')}</th>
                  <th className="align-right">{t('Apply')}</th>
                </tr>
              </thead>
              <tbody>
                {unpaid.map((lot) => (
                  <tr key={lot.lotId}>
                    <td>{formatDay(lot.accruedAt, timeZone)}</td>
                    <td>{lot.productName}</td>
                    <td className="align-right">{formatQuantity(lot.acceptedQuantity)}</td>
                    <td className="align-right">{formatMoney(lot.outstanding, currency)}</td>
                    <td className="align-right">
                      <input
                        className="cell-input"
                        aria-label={`Amount to apply to ${lot.productName} lot`}
                        inputMode="decimal"
                        placeholder="—"
                        value={apply[lot.lotId] ?? ''}
                        onChange={(e) => setApply({ ...apply, [lot.lotId]: e.target.value })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </FormDialog>
  );
}
