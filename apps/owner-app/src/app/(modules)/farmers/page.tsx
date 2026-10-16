'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FarmerRecord, Paginated } from '@morbeez/shared-types';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { PageHeader } from '@/components/ui/ListControls';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Field, FormDialog } from '@/components/ui/Form';
import { apiGet, apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { optionalText } from '@/lib/parse';
import { useT } from '@/lib/i18n';

const SUBTITLE = 'Who you buy from. A farmer added here can be chosen on a purchase order.';
// The list here, the pick-lists (purchase orders, pickups) and the views that name farmers.
const REFRESH = [['farmers'], ['lookup', 'farmers'], KEYS.procurement, KEYS.finance];

function useFarmers() {
  return useQuery({
    queryKey: ['farmers', 'all'],
    queryFn: () => apiGet<Paginated<FarmerRecord>>('farmers', { page: 1, pageSize: 100 }),
  });
}

export default function FarmersPage() {
  const t = useT();
  const { data: session } = useSession();
  const canWrite = hasPermission(session, 'farmers:write');
  const farmers = useFarmers();
  const [editing, setEditing] = useState<FarmerRecord | 'new' | null>(null);
  const toggle = useAction(
    (f: FarmerRecord) => apiSend('POST', `farmers/${f.id}/${f.status === 'active' ? 'archive' : 'restore'}`),
    REFRESH,
  );

  if (session && !hasPermission(session, 'farmers:read')) {
    return (
      <div className="stack">
        <PageHeader title={t('Farmers')} subtitle={t(SUBTITLE)} />
        <div className="panel placeholder">
          <strong>{t("Your role doesn't include farmers.")}</strong>
        </div>
      </div>
    );
  }

  const items = farmers.data?.items ?? [];
  return (
    <div className="stack">
      <PageHeader
        title={t('Farmers')}
        subtitle={t(SUBTITLE)}
        actions={
          canWrite && (
            <button type="button" className="button button-primary" onClick={() => setEditing('new')}>
              {t('Add a farmer')}
            </button>
          )
        }
      />
      <Panel title={t('Farmers')}>
        {farmers.isPending ? (
          <SkeletonLines lines={6} />
        ) : farmers.error ? (
          <ErrorState error={farmers.error} onRetry={() => farmers.refetch()} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('Name')}</th>
                  <th>{t('Phone')}</th>
                  <th>{t('Notes')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr>
                    <td colSpan={4} className="empty-cell">
                      {t('No farmers yet.')}
                    </td>
                  </tr>
                )}
                {items.map((f) => (
                  <tr key={f.id}>
                    <td>
                      {f.name} {f.status === 'archived' && <StatusBadge status="archived" />}
                    </td>
                    <td>{f.contact?.phone ?? '—'}</td>
                    <td className="muted">{f.contact?.notes ?? ''}</td>
                    <td className="num">
                      {canWrite && (
                        <span className="row-actions">
                          <button type="button" className="button button-ghost" onClick={() => setEditing(f)}>
                            {t('Edit')}
                          </button>
                          <button type="button" className="button button-ghost" onClick={() => toggle.mutate(f)} disabled={toggle.isPending}>
                            {f.status === 'active' ? t('Archive') : t('Restore')}
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {editing && <FarmerDialog farmer={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function FarmerDialog({ farmer, onClose }: { farmer: FarmerRecord | null; onClose: () => void }) {
  const t = useT();
  const [form, setForm] = useState({
    name: farmer?.name ?? '',
    phone: farmer?.contact?.phone ?? '',
    notes: farmer?.contact?.notes ?? '',
    holder: '',
    account: '',
    ifsc: '',
  });
  const [problem, setProblem] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useAction(
    (body: Record<string, unknown>) => (farmer ? apiSend('PATCH', `farmers/${farmer.id}`, body) : apiSend('POST', 'farmers', body)),
    REFRESH,
    onClose,
  );

  const submit = () => {
    if (form.name.trim().length < 2) return setProblem(t("Enter the farmer's name (at least 2 characters)."));
    // Bank details are optional, but all three or none.
    const holder = form.holder.trim();
    const account = form.account.replace(/\s/g, '');
    const ifsc = form.ifsc.trim().toUpperCase();
    const anyBank = holder || account || ifsc;
    if (anyBank) {
      if (holder.length < 2 || !/^\d{6,20}$/.test(account) || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
        return setProblem(t('Bank details need the account holder, a 6–20 digit account number and an IFSC code (like SBIN0001234) — or leave all three blank.'));
      }
    }
    setProblem(null);
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      contact: { phone: optionalText(form.phone), notes: optionalText(form.notes) },
      ...(anyBank ? { bankDetails: { accountHolderName: holder, accountNumber: account, ifscCode: ifsc } } : {}),
    };
    save.mutate(farmer ? { version: farmer.version, ...body } : body);
  };

  return (
    <FormDialog
      title={farmer ? t('Edit {name}', { name: farmer.name }) : t('Add a farmer')}
      submitLabel={farmer ? t('Save') : t('Add farmer')}
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field label={t('Name')} wide>
        {(p) => <input {...p} value={form.name} onChange={(e) => set({ name: e.target.value })} />}
      </Field>
      <Field label={t('Phone (optional)')}>
        {(p) => <input {...p} type="tel" maxLength={20} value={form.phone} onChange={(e) => set({ phone: e.target.value })} />}
      </Field>
      <Field label={t('Notes (optional)')}>
        {(p) => <input {...p} maxLength={500} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}
      </Field>
      <Field
        label={t('Bank account holder (optional)')}
        hint={farmer ? t('Blank keeps the bank details already saved') : t('For paying the farmer by bank; can be added later')}
        wide
      >
        {(p) => <input {...p} value={form.holder} onChange={(e) => set({ holder: e.target.value })} />}
      </Field>
      <Field label={t('Account number')}>
        {(p) => <input {...p} inputMode="numeric" autoComplete="off" value={form.account} onChange={(e) => set({ account: e.target.value })} />}
      </Field>
      <Field label={t('IFSC code')}>
        {(p) => <input {...p} autoComplete="off" value={form.ifsc} onChange={(e) => set({ ifsc: e.target.value })} />}
      </Field>
    </FormDialog>
  );
}
