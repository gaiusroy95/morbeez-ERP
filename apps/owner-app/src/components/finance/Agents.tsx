'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AgentAccount, PaymentMethod } from '@morbeez/shared-types';
import { apiGet, apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useCurrency, useTenantProfile } from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { formatDateTime, formatRate, formatQuantity } from '@/lib/format';
import { percentOfMoney, subtractMoney } from '@/lib/decimal';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { EmptyRow } from '@/components/ui/ListControls';
import { Field, FormDialog } from '@/components/ui/Form';
import { METHOD_LABEL } from '@/components/forms/PaymentDialogs';

const REFRESH = [KEYS.finance, KEYS.procurement, KEYS.dashboard, KEYS.tax];

/**
 * Agents' commission (Master Spec §11; Accounting Engine AGT.1–AGT.3):
 * earned on the kg accepted when a lot is graded, at the purchase's
 * commission per kg; settled by payments, with TDS under 194H when the
 * business withholds it.
 */
export function Agents() {
  const { data: session } = useSession();
  const canPay = hasPermission(session, 'finance:pay');
  const canEdit = hasPermission(session, 'procurement:write');
  const currency = useCurrency();
  const [open, setOpen] = useState<string | null>(null);
  const [paying, setPaying] = useState<AgentAccount | null>(null);
  const [editing, setEditing] = useState<AgentAccount | null>(null);
  const list = useQuery({ queryKey: ['finance', 'agents'], queryFn: () => apiGet<AgentAccount[]>('finance/agents') });

  return (
    <Panel title="Agent commission">
      <p className="muted panel-note">
        Commission is earned when a lot is graded: the kg accepted × the purchase order&apos;s commission per kg. Lots
        counted in pieces or crates earn none.
      </p>
      {list.isPending ? (
        <SkeletonLines lines={3} />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : (
        <div className="table-wrap">
          <table className="table" aria-label="Agents">
            <thead>
              <tr>
                <th>Agent</th>
                <th className="num">Earned</th>
                <th className="num">Paid</th>
                <th className="num">Owed</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(list.data ?? []).length === 0 && <EmptyRow colSpan={5}>No agents yet — add one on a purchase order.</EmptyRow>}
              {(list.data ?? []).map((a) => (
                <tr key={a.agentId}>
                  <td>
                    <button type="button" className="link-button" onClick={() => setOpen(open === a.agentId ? null : a.agentId)}>
                      {a.name}
                    </button>
                    <div className="cell-sub">{a.pan ? `PAN ${a.pan}` : 'No PAN on file'}</div>
                  </td>
                  <td className="num">{formatRate(a.earned, currency)}</td>
                  <td className="num">{formatRate(a.settled, currency)}</td>
                  <td className="num strong">{formatRate(a.owed, currency)}</td>
                  <td className="num">
                    <span className="row-actions">
                    {canEdit && (
                      <button type="button" className="button button-ghost button-small" onClick={() => setEditing(a)}>
                        {a.pan ? 'Edit PAN' : 'Add PAN'}
                      </button>
                    )}
                    {canPay && Number(a.owed) > 0 && (
                      <button type="button" className="button button-small" onClick={() => setPaying(a)}>
                        Pay
                      </button>
                    )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <AgentDetail agentId={open} currency={currency} />}
      {paying && <PayAgentDialog agent={paying} currency={currency} onClose={() => setPaying(null)} />}
      {editing && <AgentPanDialog agent={editing} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

function AgentDetail({ agentId, currency }: { agentId: string; currency: string }) {
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const detail = useQuery({ queryKey: ['finance', 'agents', agentId], queryFn: () => apiGet<AgentAccount>(`finance/agents/${agentId}`) });
  if (detail.isPending) return <SkeletonLines lines={3} />;
  if (detail.error) return <ErrorState error={detail.error} onRetry={() => detail.refetch()} />;
  const a = detail.data;
  return (
    <div className="stack" aria-label={`${a.name}'s commission`}>
      <h3 className="section-title">{a.name} — commission earned</h3>
      <div className="table-wrap">
        <table className="table" aria-label="Commission earned">
          <thead>
            <tr>
              <th>Purchase · product</th>
              <th className="num">Kg accepted</th>
              <th className="num">Per kg</th>
              <th className="num">Commission</th>
              <th>Graded</th>
            </tr>
          </thead>
          <tbody>
            {(a.commissions ?? []).length === 0 && <EmptyRow colSpan={5}>Nothing earned yet.</EmptyRow>}
            {(a.commissions ?? []).map((c) => (
              <tr key={c.id}>
                <td>
                  P-{String(c.purchaseOrderNumber).padStart(5, '0')}
                  <div className="cell-sub">{c.productName}</div>
                </td>
                <td className="num">{formatQuantity(c.acceptedKg)} kg</td>
                <td className="num">{formatRate(c.ratePerKg, currency)}</td>
                <td className="num strong">{formatRate(c.amount, currency)}</td>
                <td>{formatDateTime(c.accruedAt, timeZone)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="section-title">Payments</h3>
      <div className="table-wrap">
        <table className="table" aria-label="Commission paid">
          <thead>
            <tr>
              <th>Paid</th>
              <th>How</th>
              <th className="num">Settled</th>
              <th className="num">TDS</th>
              <th className="num">Paid to the agent</th>
            </tr>
          </thead>
          <tbody>
            {(a.payments ?? []).length === 0 && <EmptyRow colSpan={5}>No payments yet.</EmptyRow>}
            {(a.payments ?? []).map((p) => (
              <tr key={p.id}>
                <td>{formatDateTime(p.paidAt, timeZone)}</td>
                <td>
                  {METHOD_LABEL[p.method]}
                  {p.reference && <div className="cell-sub">{p.reference}</div>}
                </td>
                <td className="num">{formatRate(p.amount, currency)}</td>
                <td className="num">{p.tdsSection ? `${formatRate(p.tdsAmount, currency)} (${p.tdsSection})` : '—'}</td>
                <td className="num strong">{formatRate(p.netPaid, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PayAgentDialog({ agent, currency, onClose }: { agent: AgentAccount; currency: string; onClose: () => void }) {
  const [amount, setAmount] = useState(agent.owed);
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer');
  const [reference, setReference] = useState('');
  const [tds, setTds] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const pay = useAction(
    (body: { amount: number; method: PaymentMethod; reference?: string; tdsSectionCode?: string }) => apiSend('POST', `finance/agents/${agent.agentId}/payments`, body),
    REFRESH,
    onClose,
  );
  const value = amount.replace(/,/g, '').trim();
  const valid = /^\d+(\.\d{1,2})?$/.test(value) && Number(value) > 0;
  // 194H: 2%, or 20% without a PAN (Income-tax Act s.206AA) — the server works it out the same way.
  const withheld = tds && valid ? percentOfMoney(value, agent.pan ? '2' : '20') : '0.00';

  return (
    <FormDialog
      title={`Pay ${agent.name}`}
      description={<p>{formatRate(agent.owed, currency)} of commission is owed.</p>}
      submitLabel="Record payment"
      pending={pay.isPending}
      error={problem ?? pay.error}
      onClose={onClose}
      onSubmit={() => {
        if (!valid) return setProblem('Enter the commission to settle.');
        if (Number(value) > Number(agent.owed)) return setProblem(`Only ${formatRate(agent.owed, currency)} is owed.`);
        setProblem(null);
        pay.mutate({ amount: Number(value), method, reference: reference.trim() || undefined, tdsSectionCode: tds ? '194H' : undefined });
      }}
    >
      <Field label={`Commission settled (${currency})`}>
        {(p) => <input {...p} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
      </Field>
      <Field label="Method">
        {(p) => (
          <select {...p} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Reference" hint="UTR or cheque number">
        {(p) => <input {...p} value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} />}
      </Field>
      <Field
        label="TDS"
        wide
        hint={
          tds
            ? `${formatRate(withheld, currency)} withheld under 194H; ${formatRate(valid ? subtractMoney(value, withheld) : '0', currency)} reaches ${agent.name}.`
            : 'Withhold 194H if your business is liable to tax audit.'
        }
      >
        {(p) => (
          <select {...p} value={tds ? '194H' : ''} onChange={(e) => setTds(e.target.value === '194H')}>
            <option value="">No TDS</option>
            <option value="194H">194H — commission ({agent.pan ? '2%' : '20%, no PAN'})</option>
          </select>
        )}
      </Field>
    </FormDialog>
  );
}

/** The agent's PAN: 194H withholds 2% with one, 20% without. */
function AgentPanDialog({ agent, onClose }: { agent: AgentAccount; onClose: () => void }) {
  const [pan, setPan] = useState(agent.pan ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: { pan?: string }) => apiSend('PATCH', `procurement/agents/${agent.agentId}`, body), REFRESH, onClose);
  return (
    <FormDialog
      title={`PAN — ${agent.name}`}
      description={<p>Used when TDS is withheld on their commission (194H): 2% with a PAN, 20% without.</p>}
      submitLabel="Save PAN"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        const value = pan.trim().toUpperCase();
        if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(value)) return setProblem('A PAN is 5 letters, 4 digits, 1 letter.');
        setProblem(null);
        save.mutate({ pan: value });
      }}
    >
      <Field label="PAN">
        {(p) => <input {...p} autoComplete="off" maxLength={10} value={pan} onChange={(e) => setPan(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}
