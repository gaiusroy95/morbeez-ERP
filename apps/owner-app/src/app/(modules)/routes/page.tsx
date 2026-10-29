'use client';

import { useState } from 'react';
import type { RouteRecord, RouteStopRecord } from '@morbeez/shared-types';
import { ErrorState, SkeletonLines } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { DetailPanel, KeyValues } from '@/components/ui/DetailPanel';
import { ActionBar, Field, FormDialog } from '@/components/ui/Form';
import { Icon } from '@/components/ui/Icon';
import { SearchSelect } from '@/components/forms/SearchSelect';
import { QuickAddRoute } from '@/components/forms/QuickAdd';
import { CreateBar, ListCard, SearchFilter } from '@/components/redesign/ListCards';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useActiveCustomers, useActiveFarmers } from '@/lib/hooks/use-lookups';
import { useRouteName, useRouteStops, useRoutes } from '@/lib/hooks/use-delivery-orders';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { useOpenOnNew } from '@/lib/hooks/use-open-on-new';
import { useT } from '@/lib/i18n';

// A route's stops are a customer's usual route too, so changes refresh customers.
const ROUTE_EFFECTS = [['routes'], KEYS.customers, KEYS.lookupCustomers, KEYS.orders, KEYS.logistics];

type Stop = Pick<RouteStopRecord, 'kind' | 'partyId'>;

function RenameDialog({ route, onClose }: { route: RouteRecord; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState(route.name);
  const [problem, setProblem] = useState<string | null>(null);
  const rename = useAction((body: { name: string }) => apiSend<RouteRecord>('PATCH', `routes/${route.id}`, body), ROUTE_EFFECTS, onClose);
  return (
    <FormDialog
      title={t('Rename route')}
      submitLabel={t('Save')}
      pending={rename.isPending}
      error={problem ?? rename.error}
      onClose={onClose}
      onSubmit={() => {
        if (name.trim().length < 2) return setProblem(t('Give the route a name.'));
        setProblem(null);
        rename.mutate({ name: name.trim() });
      }}
    >
      <Field label={t('Name')} wide>
        {(p) => <input {...p} autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

/**
 * One route: its customers and farmers in the order the vehicle visits
 * them. Trips planned on it make their stops in this order; a customer on
 * it has it as their usual route.
 */
function RouteDetail({ route, canWrite, onClose }: { route: RouteRecord; canWrite: boolean; onClose: () => void }) {
  const t = useT();
  const stops = useRouteStops(route.id);
  const customers = useActiveCustomers();
  const farmers = useActiveFarmers();
  const routeName = useRouteName();
  const [renaming, setRenaming] = useState(false);
  const save = useAction((list: Stop[]) => apiSend<RouteStopRecord[]>('PUT', `routes/${route.id}/stops`, { stops: list }), ROUTE_EFFECTS);
  const toggle = useAction(
    () => apiSend<RouteRecord>('PATCH', `routes/${route.id}`, { status: route.status === 'active' ? 'archived' : 'active' }),
    ROUTE_EFFECTS,
  );
  const list = stops.data ?? [];
  const put = (next: Stop[]) => save.mutate(next.map((s) => ({ kind: s.kind, partyId: s.partyId })));
  const move = (i: number, by: -1 | 1) => {
    const next: Stop[] = [...list];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    put(next);
  };
  const add = (kind: Stop['kind'], partyId: string) => {
    if (!partyId || list.some((s) => s.kind === kind && s.partyId === partyId)) return;
    put([...list, { kind, partyId }]);
  };
  const onRoute = new Set(list.map((s) => s.partyId));

  return (
    <DetailPanel title={route.name} onClose={onClose}>
      <KeyValues
        items={[
          ['Status', <StatusBadge key="s" status={route.status} />],
          ['Customers', String(list.filter((s) => s.kind === 'customer').length)],
          ['Farmers', String(list.filter((s) => s.kind === 'farmer').length)],
        ]}
      />
      {canWrite && (
        <ActionBar>
          <button type="button" className="button" onClick={() => setRenaming(true)}>
            {t('Rename')}
          </button>
          <button type="button" className={route.status === 'active' ? 'button button-danger' : 'button'} onClick={() => toggle.mutate(undefined)}>
            {route.status === 'active' ? t('Archive route') : t('Restore route')}
          </button>
        </ActionBar>
      )}
      <h3 className="detail-subhead">{t('Stops, in visiting order')}</h3>
      {stops.isPending ? (
        <SkeletonLines lines={4} />
      ) : stops.error ? (
        <ErrorState error={stops.error} onRetry={() => stops.refetch()} />
      ) : (
        <ol className="route-stops" data-updating={save.isPending || undefined}>
          {list.length === 0 && <li className="muted">{t('No stops yet — add the customers and farmers on this route.')}</li>}
          {list.map((s, i) => (
            <li key={`${s.kind}:${s.partyId}`}>
              <span className="stop-seq">{i + 1}</span>
              <span className="route-stop-main">
                <strong>{s.name}</strong>
                <span className="muted">
                  {s.kind === 'customer' ? t('Customer') : t('Farmer')}
                  {s.place ? ` · ${s.place}` : ''}
                  {s.latitude ? '' : ` · ${t('no map pin')}`}
                </span>
              </span>
              {canWrite && (
                <span className="route-stop-actions">
                  <button type="button" className="icon-button" aria-label={t('Move {name} up', { name: s.name })} disabled={i === 0} onClick={() => move(i, -1)}>
                    <Icon name="arrowUp" size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t('Move {name} down', { name: s.name })}
                    disabled={i === list.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <Icon name="arrowDown" size={16} />
                  </button>
                  <button type="button" className="icon-button" aria-label={t('Take {name} off the route', { name: s.name })} onClick={() => put(list.filter((_, j) => j !== i))}>
                    <Icon name="close" size={16} />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {save.error ? (
        <p className="form-error" role="alert">
          {t('That change was not saved.')}
        </p>
      ) : null}
      {canWrite && (
        <div className="form-grid">
          <Field label={t('Add a customer')}>
            {(props) => (
              <SearchSelect
                {...props}
                value=""
                onChange={(id) => add('customer', id)}
                loading={customers.isPending}
                placeholder={t('Choose a customer…')}
                searchPlaceholder={t('Search by name or phone…')}
                options={customers.records
                  .filter((c) => !onRoute.has(c.id))
                  .map((c) => ({ value: c.id, label: c.name, sub: c.routeId ? t('Now on {route}', { route: routeName(c.routeId) }) : (c.place ?? undefined) }))}
              />
            )}
          </Field>
          <Field label={t('Add a farmer')}>
            {(props) => (
              <SearchSelect
                {...props}
                value=""
                onChange={(id) => add('farmer', id)}
                loading={farmers.isPending}
                placeholder={t('Choose a farmer…')}
                searchPlaceholder={t('Search by name or phone…')}
                options={farmers.records.filter((f) => !onRoute.has(f.id)).map((f) => ({ value: f.id, label: f.name, sub: f.place ?? undefined }))}
              />
            )}
          </Field>
        </div>
      )}
      <p className="footnote">
        {t('Trips planned on this route visit them in this order. A customer on it has it as their usual route; adding one who is on another route moves them here.')}
      </p>
      {renaming && <RenameDialog route={route} onClose={() => setRenaming(false)} />}
    </DetailPanel>
  );
}

/** The business's delivery routes (Settings → Routes in the client's design). */
export default function RoutesPage() {
  const t = useT();
  const routes = useRoutes();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  useOpenOnNew(() => setAdding(true));
  const { data: session } = useSession();
  const canWrite = hasPermission(session, 'orders:write');
  const list = (routes.data ?? []).filter((r) => r.name.toLowerCase().includes(query.trim().toLowerCase()));
  const route = (routes.data ?? []).find((r) => r.id === selected);

  return (
    <div className="list-split">
      <div className="list-screen">
        <h1 className="page-title visually-hidden">{t('Routes')}</h1>
        <SearchFilter value={query} onChange={setQuery} placeholder="Search routes…" />
        {routes.isPending ? (
          <SkeletonLines lines={4} height={64} />
        ) : routes.error ? (
          <div className="panel">
            <ErrorState error={routes.error} onRetry={() => routes.refetch()} />
          </div>
        ) : (
          <div className="card-list">
            {list.length === 0 && <div className="list-empty">{query ? t('Nothing matches.') : t('No routes yet.')}</div>}
            {list.map((r) => (
              <ListCard
                key={r.id}
                number={t('{customers} customers · {farmers} farmers', { customers: r.customers, farmers: r.farmers })}
                title={r.name}
                status={r.status === 'active' ? 'Active' : 'Archived'}
                tone={r.status === 'active' ? 'done' : 'muted'}
                initial={r.name}
                selected={selected === r.id}
                onOpen={() => setSelected(r.id)}
              />
            ))}
          </div>
        )}
        {canWrite && <CreateBar label="Add Route" onClick={() => setAdding(true)} />}
      </div>
      {route && <RouteDetail key={route.id} route={route} canWrite={canWrite} onClose={() => setSelected(null)} />}
      {adding && (
        <QuickAddRoute
          initialName=""
          onClose={() => setAdding(false)}
          onAdded={(r) => {
            setAdding(false);
            setSelected(r.id);
          }}
        />
      )}
    </div>
  );
}
