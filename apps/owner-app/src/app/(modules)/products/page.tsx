'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Paginated, ProductRecord } from '@morbeez/shared-types';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { PageHeader } from '@/components/ui/ListControls';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Field, FormDialog } from '@/components/ui/Form';
import { apiGet, apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useCurrency, useTenantProfile } from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { formatMoney } from '@/lib/format';

const SUBTITLE = 'What you trade and how it is counted. Prices come from your actual sales, not a fixed list.';

const KIND_LABEL: Record<ProductRecord['kind'], string> = {
  standard: 'Vegetables & other',
  live_bird: 'Live birds (by weight)',
  egg: 'Eggs (by piece or tray)',
};
const UOMS: ProductRecord['baseUom'][] = ['kg', 'g', 'crate', 'bag', 'dozen', 'unit', 'piece'];
const REFRESH = [['products'], ['lookup', 'products'], KEYS.orders];

function useProducts() {
  return useQuery({
    queryKey: ['products', 'all'],
    queryFn: () => apiGet<Paginated<ProductRecord>>('products', { page: 1, pageSize: 100 }),
  });
}

function toleranceLabel(p: ProductRecord, defaults: { shrinkage: string; breakage: string }) {
  if (p.kind === 'standard') return '—';
  const own = p.lossTolerancePct;
  const label = p.kind === 'live_bird' ? 'shrinkage' : 'breakage';
  return own !== null ? `${Number(own)}% ${label}` : `${Number(p.kind === 'live_bird' ? defaults.shrinkage : defaults.breakage)}% ${label} (business default)`;
}

export default function ProductsPage() {
  const { data: session } = useSession();
  const canWrite = hasPermission(session, 'products:write');
  const currency = useCurrency();
  const profile = useTenantProfile().data;
  const defaults = { shrinkage: profile?.defaultShrinkageTolerancePct ?? '2', breakage: profile?.defaultBreakageTolerancePct ?? '1' };
  const products = useProducts();
  const [editing, setEditing] = useState<ProductRecord | 'new' | null>(null);
  const toggle = useAction(
    (p: ProductRecord) => apiSend('POST', `products/${p.id}/${p.status === 'active' ? 'archive' : 'restore'}`),
    REFRESH,
  );

  if (session && !hasPermission(session, 'products:read')) {
    return (
      <div className="stack">
        <PageHeader title="Products" subtitle={SUBTITLE} />
        <div className="panel placeholder">
          <strong>Your role doesn&apos;t include products.</strong>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <PageHeader
        title="Products"
        subtitle={SUBTITLE}
        actions={
          canWrite && (
            <button type="button" className="button button-primary" onClick={() => setEditing('new')}>
              Add a product
            </button>
          )
        }
      />
      <Panel title="Products">
        {products.isPending ? (
          <SkeletonLines lines={6} />
        ) : products.error ? (
          <ErrorState error={products.error} onRetry={() => products.refetch()} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Traded as</th>
                  <th>Counted in</th>
                  <th>Loss accepted</th>
                  <th className="num">Reference price</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(products.data?.items ?? []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty-cell">
                      No products yet.
                    </td>
                  </tr>
                )}
                {(products.data?.items ?? []).map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.name} {p.status === 'archived' && <StatusBadge status="archived" />}
                      {p.category && <div className="cell-sub">{p.category}</div>}
                    </td>
                    <td>{KIND_LABEL[p.kind]}</td>
                    <td>{p.kind === 'egg' ? `pieces · trays of ${p.packSize}` : p.baseUom}</td>
                    <td>{toleranceLabel(p, defaults)}</td>
                    <td className="num">{p.basePrice !== null ? formatMoney(p.basePrice, currency) : <span className="muted">—</span>}</td>
                    <td className="num">
                      {canWrite && (
                        <span className="row-actions">
                          <button type="button" className="button button-ghost" onClick={() => setEditing(p)}>
                            Edit
                          </button>
                          <button type="button" className="button button-ghost" onClick={() => toggle.mutate(p)} disabled={toggle.isPending}>
                            {p.status === 'active' ? 'Archive' : 'Restore'}
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
      {editing && <ProductDialog product={editing === 'new' ? null : editing} currency={currency} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ProductDialog({ product, currency, onClose }: { product: ProductRecord | null; currency: string; onClose: () => void }) {
  const [name, setName] = useState(product?.name ?? '');
  const [category, setCategory] = useState(product?.category ?? '');
  const [kind, setKind] = useState<ProductRecord['kind']>(product?.kind ?? 'standard');
  const [uom, setUom] = useState<ProductRecord['baseUom']>(product?.baseUom ?? 'kg');
  const [packSize, setPackSize] = useState(String(product?.packSize ?? 30));
  const [tolerance, setTolerance] = useState(product?.lossTolerancePct !== null && product?.lossTolerancePct !== undefined ? String(Number(product.lossTolerancePct)) : '');
  const [reference, setReference] = useState(product?.basePrice ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction(
    (body: Record<string, unknown>) => (product ? apiSend('PATCH', `products/${product.id}`, body) : apiSend('POST', 'products', body)),
    REFRESH,
    onClose,
  );

  const submit = () => {
    if (name.trim().length < 2) return setProblem('Give the product a name.');
    const tol = tolerance.trim() === '' ? null : Number(tolerance);
    if (tol !== null && !(tol >= 0 && tol <= 100)) return setProblem('The loss accepted is a percentage, 0 to 100.');
    const tray = Number(packSize);
    if (kind === 'egg' && !(Number.isInteger(tray) && tray >= 2)) return setProblem('A tray holds a whole number of eggs, 2 or more.');
    const ref = reference.trim() === '' ? null : Number(reference.replace(/,/g, ''));
    if (ref !== null && !(ref >= 0)) return setProblem('The reference price is an amount, or blank.');
    setProblem(null);
    const body: Record<string, unknown> = {
      name: name.trim(),
      category: category.trim() || undefined,
      basePrice: ref,
      ...(kind !== 'standard' ? { lossTolerancePct: tol } : {}),
      ...(kind === 'egg' ? { packSize: tray } : {}),
    };
    if (product) save.mutate({ version: product.version, ...body, ...(kind === 'standard' ? { baseUom: uom } : {}) });
    else save.mutate({ ...body, kind, baseUom: kind === 'standard' ? uom : kind === 'egg' ? 'piece' : 'kg' });
  };

  return (
    <FormDialog
      title={product ? `Edit ${product.name}` : 'Add a product'}
      description={
        <p>
          New orders start at the last price each customer actually paid — there is no fixed selling price. A reference
          price is only used for a product that has never been sold.
        </p>
      }
      submitLabel={product ? 'Save' : 'Add product'}
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field label="Name">{(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label="Category (optional)">{(p) => <input {...p} value={category} onChange={(e) => setCategory(e.target.value)} />}</Field>
      <Field label="Traded as" hint={product ? "Can't change once created" : undefined}>
        {(p) => (
          <select {...p} value={kind} disabled={!!product} onChange={(e) => setKind(e.target.value as ProductRecord['kind'])}>
            {(Object.keys(KIND_LABEL) as ProductRecord['kind'][]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        )}
      </Field>
      {kind === 'standard' && (
        <Field label="Counted in">
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
      {kind === 'egg' && (
        <Field label="Eggs to a tray">
          {(p) => <input {...p} inputMode="numeric" value={packSize} onChange={(e) => setPackSize(e.target.value)} />}
        </Field>
      )}
      {kind !== 'standard' && (
        <Field
          label={kind === 'live_bird' ? 'Transit shrinkage accepted (%)' : 'Breakage accepted (%)'}
          hint="Blank: the business default. Above it, you're alerted."
        >
          {(p) => <input {...p} inputMode="decimal" value={tolerance} onChange={(e) => setTolerance(e.target.value)} />}
        </Field>
      )}
      <Field label={`Reference price (${currency}, optional)`} hint={kind === 'live_bird' ? 'Per kg of live weight' : kind === 'egg' ? 'Per egg' : undefined}>
        {(p) => <input {...p} inputMode="decimal" value={reference} onChange={(e) => setReference(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}
