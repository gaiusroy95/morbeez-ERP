'use client';

import { useState } from 'react';
import type { CustomerRecord, FarmerRecord, ProductRecord, RouteRecord } from '@morbeez/shared-types';
import { Field, FormDialog } from '@/components/ui/Form';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useCurrency } from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { optionalText, parseMoney, parseWholeNumber } from '@/lib/parse';
import { LANGS, useT, type Lang } from '@/lib/i18n';

/**
 * Adding a farmer, customer or product without leaving the form that needs
 * it (client feedback: "create new" right in the pick-list). The
 * searchable pick-list (SearchSelect) has a create button; it opens one of
 * these short forms on top, with what was typed in the search as the name,
 * and the new record comes back selected. The full forms on Farmers /
 * Customers / Products hold the rest of the details.
 *
 * Render these beside the form that needs them, never inside it: a form
 * can't contain a form.
 */

/** Whether the signed-in person may add this kind of record (hides the option if not). */
export function useCanAdd(kind: 'farmers' | 'customers' | 'products') {
  const { data: session } = useSession();
  return hasPermission(session, `${kind}:write`);
}

export function QuickAddFarmer({
  initialName = '',
  onClose,
  onAdded,
}: {
  initialName?: string;
  onClose: () => void;
  onAdded: (farmer: FarmerRecord) => void;
}) {
  const t = useT();
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState('');
  const [place, setPlace] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction(
    (body: Record<string, unknown>) => apiSend<FarmerRecord>('POST', 'farmers', body),
    [['farmers'], ['lookup', 'farmers']],
    onAdded,
  );
  const submit = () => {
    if (name.trim().length < 2) return setProblem(t("Enter the farmer's name (at least 2 characters)."));
    setProblem(null);
    save.mutate({ name: name.trim(), place: place.trim() || null, contact: { phone: optionalText(phone) } });
  };
  return (
      <FormDialog
        title={t('Add a farmer')}
        description={t('Bank details and notes can be added later on the Farmers page.')}
        submitLabel={t('Add farmer')}
        pending={save.isPending}
        error={problem ?? save.error}
        onClose={onClose}
        onSubmit={submit}
      >
        <Field label={t('Name')} wide>
          {(p) => <input {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label={t('Village / town (optional)')} wide>
          {(p) => <input {...p} maxLength={120} value={place} onChange={(e) => setPlace(e.target.value)} />}
        </Field>
        <Field label={t('Phone (optional)')} wide>
          {(p) => <input {...p} type="tel" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} />}
        </Field>
      </FormDialog>
  );
}

export function QuickAddCustomer({
  initialName = '',
  onClose,
  onAdded,
}: {
  initialName?: string;
  onClose: () => void;
  onAdded: (customer: CustomerRecord) => void;
}) {
  const t = useT();
  const currency = useCurrency();
  const [form, setForm] = useState({ name: initialName, phone: '', place: '', address: '', creditLimit: '0', terms: '0', language: 'en' as Lang });
  const [problem, setProblem] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useAction(
    (body: Record<string, unknown>) => apiSend<CustomerRecord>('POST', 'customers', body),
    [KEYS.customers, KEYS.lookupCustomers, KEYS.finance],
    onAdded,
  );
  const submit = () => {
    if (form.name.trim().length < 2) return setProblem(t('Enter the customer’s name (at least 2 characters).'));
    const limit = parseMoney(form.creditLimit, 'the credit limit');
    if (!limit.ok) return setProblem(limit.error);
    const terms = parseWholeNumber(form.terms, 'payment terms', 0, 180);
    if (!terms.ok) return setProblem(terms.error);
    setProblem(null);
    save.mutate({
      name: form.name.trim(),
      contact: { phone: optionalText(form.phone) },
      place: optionalText(form.place) ?? null,
      address: optionalText(form.address) ?? null,
      creditLimit: limit.value,
      paymentTermsDays: terms.value,
      preferredLanguage: form.language,
    });
  };
  return (
      <FormDialog
        title={t('New customer')}
        submitLabel={t('Add customer')}
        pending={save.isPending}
        error={problem ?? save.error}
        onClose={onClose}
        onSubmit={submit}
      >
        <Field label={t('Name')} wide>
          {(p) => <input {...p} autoFocus value={form.name} onChange={(e) => set({ name: e.target.value })} />}
        </Field>
        <Field label={t('Phone (optional)')}>
          {(p) => <input {...p} type="tel" maxLength={20} value={form.phone} onChange={(e) => set({ phone: e.target.value })} />}
        </Field>
        <Field label={t('Village / town (optional)')}>
          {(p) => <input {...p} maxLength={120} value={form.place} onChange={(e) => set({ place: e.target.value })} />}
        </Field>
        <Field label={t('Delivery address (optional)')} wide>
          {(p) => <input {...p} maxLength={300} value={form.address} onChange={(e) => set({ address: e.target.value })} />}
        </Field>
        <Field label={t('Language for statements and messages')}>
          {(p) => (
            <select {...p} value={form.language} onChange={(e) => set({ language: e.target.value as Lang })}>
              {LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.code === 'en' ? l.name : `${l.name} (${l.english})`}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={`${t('Credit limit')} (${currency})`} hint={t('0 means cash only — no confirmed orders on credit')}>
          {(p) => <input {...p} inputMode="decimal" value={form.creditLimit} onChange={(e) => set({ creditLimit: e.target.value })} />}
        </Field>
        <Field label={t('Payment terms (days)')} hint={t('0 = pays on delivery; up to 180')}>
          {(p) => <input {...p} inputMode="numeric" value={form.terms} onChange={(e) => set({ terms: e.target.value })} />}
        </Field>
      </FormDialog>
  );
}

const KINDS: { value: ProductRecord['kind']; label: string }[] = [
  { value: 'standard', label: 'Vegetables & other' },
  { value: 'live_bird', label: 'Live birds (by weight)' },
  { value: 'egg', label: 'Eggs (by piece or tray)' },
];
const UOMS: ProductRecord['baseUom'][] = ['kg', 'g', 'crate', 'bag', 'dozen', 'unit', 'piece'];

export function QuickAddProduct({
  initialName = '',
  onClose,
  onAdded,
}: {
  initialName?: string;
  onClose: () => void;
  onAdded: (product: ProductRecord) => void;
}) {
  const t = useT();
  const [name, setName] = useState(initialName);
  const [kind, setKind] = useState<ProductRecord['kind']>('standard');
  const [uom, setUom] = useState<ProductRecord['baseUom']>('kg');
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction(
    (body: Record<string, unknown>) => apiSend<ProductRecord>('POST', 'products', body),
    [['products'], ['lookup', 'products']],
    onAdded,
  );
  const submit = () => {
    if (name.trim().length < 2) return setProblem(t('Give the product a name.'));
    setProblem(null);
    save.mutate({
      name: name.trim(),
      kind,
      baseUom: kind === 'standard' ? uom : kind === 'egg' ? 'piece' : 'kg',
      ...(kind === 'egg' ? { packSize: 30 } : {}),
    });
  };
  return (
      <FormDialog
        title={t('Add a product')}
        description={t('Loss rules, tray size and a reference price can be set later on the Products page.')}
        submitLabel={t('Add product')}
        pending={save.isPending}
        error={problem ?? save.error}
        onClose={onClose}
        onSubmit={submit}
      >
        <Field label={t('Name')} wide>
          {(p) => <input {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label={t('Traded as')}>
          {(p) => (
            <select {...p} value={kind} onChange={(e) => setKind(e.target.value as ProductRecord['kind'])}>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {t(k.label)}
                </option>
              ))}
            </select>
          )}
        </Field>
        {kind === 'standard' && (
          <Field label={t('Counted in')}>
            {(p) => (
              <select {...p} value={uom} onChange={(e) => setUom(e.target.value as ProductRecord['baseUom'])}>
                {UOMS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
      </FormDialog>
  );
}

/** A new delivery route from inside the form. */
export function QuickAddRoute({ initialName, onClose, onAdded }: { initialName: string; onClose: () => void; onAdded: (r: RouteRecord) => void }) {
  const t = useT();
  const [name, setName] = useState(initialName);
  const [problem, setProblem] = useState<string | null>(null);
  const add = useAction((body: { name: string }) => apiSend<RouteRecord>('POST', 'routes', body), [['routes']], onAdded);
  return (
    <FormDialog
      title={t('Add a route')}
      description={<p>{t('A name your drivers know, like "Mysuru North".')}</p>}
      submitLabel={t('Add route')}
      pending={add.isPending}
      error={problem ?? add.error}
      onClose={onClose}
      onSubmit={() => {
        if (name.trim().length < 2) return setProblem(t('Give the route a name.'));
        setProblem(null);
        add.mutate({ name: name.trim() });
      }}
    >
      <Field label={t('Name')} wide>
        {(p) => <input {...p} autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}
