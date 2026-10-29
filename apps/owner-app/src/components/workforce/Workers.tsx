'use client';

import { useState } from 'react';
import type {
  AddWorkerBody,
  LoginLink,
  PayRate,
  WorkerDetail,
  WorkerDocument,
  WorkerDocumentKind,
  WorkerProfileBody,
  WorkerRow,
} from '@morbeez/shared-types';
import { ActionBar, Field, FormDialog } from '@/components/ui/Form';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyRow, SelectableRow } from '@/components/ui/ListControls';
import { DetailPanel, KeyValues } from '@/components/ui/DetailPanel';
import { ErrorState, SkeletonLines } from '@/components/ui/Panel';
import { apiSend, apiUpload } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useWorker } from '@/lib/hooks/use-workforce';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { displayLogin, normalizeIndianMobile } from '@/lib/phone';
import { parseMoney } from '@/lib/parse';

export const SKILL_LABEL = { unskilled: 'Unskilled', semi_skilled: 'Semi-skilled', skilled: 'Skilled', highly_skilled: 'Highly skilled' } as const;
export const EMPLOYMENT_LABEL = { permanent: 'Permanent', casual: 'Casual (daily)', contract: 'Contract' } as const;
export const ROLE_LABEL: Record<string, string> = { driver: 'Driver', warehouse: 'Warehouse', procurement: 'Procurement', finance: 'Finance', other: 'Other' };

export function rateLabel(rate: PayRate | null, currency: string): string {
  if (!rate) return 'No pay rate';
  const amount = formatMoney(rate.rate, currency);
  switch (rate.payBasis) {
    case 'monthly':
      return `${amount} a month`;
    case 'daily':
      return `${amount} a day`;
    case 'hourly':
      return `${amount} an hour`;
    case 'piece':
      return `${amount} per ${rate.unitLabel}`;
  }
}

export function WorkersTable({
  workers,
  currency,
  selected,
  onSelect,
}: {
  workers: WorkerRow[];
  currency: string;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Worker</th>
            <th>Role</th>
            <th>Employment</th>
            <th>Pay</th>
            <th className="num">Advance due</th>
          </tr>
        </thead>
        <tbody>
          {workers.length === 0 && <EmptyRow colSpan={5}>No workers yet.</EmptyRow>}
          {workers.map((w) => (
            <SelectableRow key={w.employeeId} selected={selected === w.employeeId} onSelect={() => onSelect(w.employeeId)} label={w.name}>
              <td>
                {w.name} {w.status === 'archived' && <StatusBadge status="archived" />}
                {w.profileVersion === 0 && <div className="cell-sub">Employment details not set</div>}
              </td>
              <td>{ROLE_LABEL[w.roleType] ?? w.roleType}</td>
              <td>
                {EMPLOYMENT_LABEL[w.employmentType]}
                <div className="cell-sub">{SKILL_LABEL[w.skillCategory]}</div>
              </td>
              <td>{w.currentRate ? rateLabel(w.currentRate, currency) : <StatusBadge status="missing" tone="attention" label="No pay rate" />}</td>
              <td className="num">{Number(w.advanceOutstanding) ? formatMoney(w.advanceOutstanding, currency) : '—'}</td>
            </SelectableRow>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WorkerPanel({
  id,
  currency,
  states,
  canWrite,
  canConfigure,
  onClose,
}: {
  id: string;
  currency: string;
  states: { code: string; name: string }[];
  canWrite: boolean;
  canConfigure: boolean;
  onClose: () => void;
}) {
  const { data, error, isPending, refetch } = useWorker(id);
  const [dialog, setDialog] = useState<'profile' | 'rate' | 'document' | 'login' | null>(null);
  const [link, setLink] = useState<LoginLink | null>(null);
  const { data: session } = useSession();
  const canInvite = hasPermission(session, 'users:write');
  if (isPending || error || !data) {
    return (
      <DetailPanel title="Worker" onClose={onClose}>
        {error ? <ErrorState error={error} onRetry={() => refetch()} /> : <SkeletonLines lines={6} />}
      </DetailPanel>
    );
  }
  const state = states.find((s) => s.code === data.workStateCode)?.name;
  return (
    <DetailPanel title={data.name} onClose={onClose}>
      <KeyValues
        items={[
          ['Role', ROLE_LABEL[data.roleType] ?? data.roleType],
          ['Employment', EMPLOYMENT_LABEL[data.employmentType]],
          ['Skill (for minimum wage)', SKILL_LABEL[data.skillCategory]],
          ['Works in', state ? `${data.workStateCode} · ${state}` : 'Default state'],
          ['Joined', data.joinedOn ? formatDate(data.joinedOn) : '—'],
          ['Left', data.leftOn ? formatDate(data.leftOn) : '—'],
          ['Phone', data.phone ?? '—'],
          ['Address', data.address ?? '—'],
          ['App login', data.login ? displayLogin(data.login) : 'None'],
        ]}
      />
      <ActionBar>
        {canWrite && (
          <button type="button" className="button" onClick={() => setDialog('profile')}>
            Edit details
          </button>
        )}
        {canInvite && data.status === 'active' && (data.hasLogin || data.roleType === 'driver') && (
          <button type="button" className="button" onClick={() => setDialog('login')}>
            {data.hasLogin ? 'Send a new password link' : 'Give app login'}
          </button>
        )}
        {canConfigure && (
          <button type="button" className="button button-primary" onClick={() => setDialog('rate')}>
            New pay rate
          </button>
        )}
      </ActionBar>
      <h3 className="detail-subhead">Pay rates</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Rate</th>
              <th>From</th>
              <th>To</th>
            </tr>
          </thead>
          <tbody>
            {data.rates.length === 0 && <EmptyRow colSpan={3}>No pay rate — this worker can&apos;t be paid until one is set.</EmptyRow>}
            {data.rates.map((r) => (
              <tr key={r.id}>
                <td>{rateLabel(r, currency)}</td>
                <td>{formatDate(r.effectiveFrom)}</td>
                <td>{r.effectiveTo ? formatDate(r.effectiveTo) : 'Current'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="footnote">A rate change starts from a date; pay already settled keeps the rate it was worked out with.</p>

      <h3 className="detail-subhead">Documents</h3>
      <DocumentsList worker={data} canWrite={canWrite} />
      {canWrite && (
        <ActionBar>
          <button type="button" className="button" onClick={() => setDialog('document')}>
            Attach a document
          </button>
        </ActionBar>
      )}

      {dialog === 'profile' && <ProfileDialog worker={data} states={states} onClose={() => setDialog(null)} />}
      {dialog === 'rate' && <RateDialog worker={data} currency={currency} onClose={() => setDialog(null)} />}
      {dialog === 'document' && <DocumentDialog worker={data} onClose={() => setDialog(null)} />}
      {dialog === 'login' && (
        <LoginLinkRequestDialog
          worker={data}
          onClose={() => setDialog(null)}
          onLink={(l) => {
            setDialog(null);
            setLink(l);
          }}
        />
      )}
      {link && <LoginLinkDialog name={data.name} link={link} onClose={() => setLink(null)} />}
    </DetailPanel>
  );
}

function ProfileDialog({ worker, states, onClose }: { worker: WorkerDetail; states: { code: string; name: string }[]; onClose: () => void }) {
  const [f, setF] = useState({
    employmentType: worker.employmentType,
    skillCategory: worker.skillCategory,
    workStateCode: worker.workStateCode ?? '',
    joinedOn: worker.joinedOn ?? '',
    leftOn: worker.leftOn ?? '',
    phone: worker.phone ?? '',
    address: worker.address ?? '',
  });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const save = useAction(
    (body: WorkerProfileBody) => apiSend('PUT', `workforce/workers/${worker.employeeId}/profile`, body),
    [KEYS.workforce],
    onClose,
  );
  return (
    <FormDialog
      title={`Employment — ${worker.name}`}
      submitLabel="Save"
      pending={save.isPending}
      error={save.error}
      onClose={onClose}
      onSubmit={() =>
        save.mutate({
          version: worker.profileVersion,
          employmentType: f.employmentType,
          skillCategory: f.skillCategory,
          workStateCode: f.workStateCode || null,
          joinedOn: f.joinedOn || null,
          leftOn: f.leftOn || null,
          phone: f.phone.trim() || null,
          address: f.address.trim() || null,
        })
      }
    >
      <Field label="Employment">
        {(p) => (
          <select {...p} value={f.employmentType} onChange={(e) => set({ employmentType: e.target.value as typeof f.employmentType })}>
            {Object.entries(EMPLOYMENT_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Skill category" hint="Decides which minimum wage applies">
        {(p) => (
          <select {...p} value={f.skillCategory} onChange={(e) => set({ skillCategory: e.target.value as typeof f.skillCategory })}>
            {Object.entries(SKILL_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Works in (state)" hint="Blank uses the payroll default">
        {(p) => (
          <select {...p} value={f.workStateCode} onChange={(e) => set({ workStateCode: e.target.value })}>
            <option value="">Payroll default</option>
            {states.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Phone (optional)">{(p) => <input {...p} type="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} />}</Field>
      <Field label="Address (optional)" wide>
        {(p) => <textarea {...p} maxLength={500} value={f.address} onChange={(e) => set({ address: e.target.value })} />}
      </Field>
      <Field label="Joined on">{(p) => <input {...p} type="date" value={f.joinedOn} onChange={(e) => set({ joinedOn: e.target.value })} />}</Field>
      <Field label="Left on (optional)">{(p) => <input {...p} type="date" value={f.leftOn} onChange={(e) => set({ leftOn: e.target.value })} />}</Field>
    </FormDialog>
  );
}

function RateDialog({ worker, currency, onClose }: { worker: WorkerDetail; currency: string; onClose: () => void }) {
  const [basis, setBasis] = useState<PayRate['payBasis']>(worker.currentRate?.payBasis ?? 'daily');
  const [rate, setRate] = useState('');
  const [unit, setUnit] = useState(worker.currentRate?.unitLabel ?? 'crate');
  const [from, setFrom] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('POST', `workforce/workers/${worker.employeeId}/pay-rates`, body), [KEYS.workforce], onClose);
  return (
    <FormDialog
      title={`New pay rate — ${worker.name}`}
      description={<p>The current rate ends the day before this one starts.</p>}
      submitLabel="Set rate"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        const r = parseMoney(rate, 'the rate', true);
        if (!r.ok) return setProblem(r.error);
        if (!from) return setProblem('Choose the date it starts.');
        if (basis === 'piece' && !unit.trim()) return setProblem('Say what one piece is.');
        setProblem(null);
        save.mutate({ payBasis: basis, rate: r.value, unitLabel: basis === 'piece' ? unit.trim() : undefined, effectiveFrom: from });
      }}
    >
      <Field label="Paid">
        {(p) => (
          <select {...p} value={basis} onChange={(e) => setBasis(e.target.value as PayRate['payBasis'])}>
            <option value="monthly">A monthly salary</option>
            <option value="daily">By the day</option>
            <option value="hourly">By the hour</option>
            <option value="piece">By the piece</option>
          </select>
        )}
      </Field>
      <Field label={`Rate (${currency})`}>{(p) => <input {...p} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />}</Field>
      {basis === 'piece' && <Field label="Per">{(p) => <input {...p} maxLength={20} value={unit} onChange={(e) => setUnit(e.target.value)} />}</Field>}
      <Field label="Starts on">{(p) => <input {...p} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
    </FormDialog>
  );
}

export function AddWorkerDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (id: string) => void }) {
  const { data: session } = useSession();
  const canInvite = hasPermission(session, 'users:write');
  const [f, setF] = useState({ name: '', role: 'driver', phone: '', address: '', login: true });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const [problem, setProblem] = useState<string | null>(null);
  const [added, setAdded] = useState<AddedWorker | null>(null);
  const offerLogin = canInvite && f.role === 'driver';
  const add = useAction(
    async (body: AddWorkerBody & { login: boolean }): Promise<AddedWorker> => {
      const { login, ...worker } = body;
      const created = await apiSend<WorkerDetail>('POST', 'workforce/workers', worker);
      if (!login) return { id: created.employeeId, name: created.name, link: null, linkError: null };
      // The worker is saved either way. A login that can't be made (a number
      // already in use) is said so, and can be retried from their page.
      try {
        const link = await apiSend<LoginLink>('POST', `workforce/workers/${created.employeeId}/login-link`, {});
        return { id: created.employeeId, name: created.name, link, linkError: null };
      } catch (err) {
        return { id: created.employeeId, name: created.name, link: null, linkError: (err as Error).message };
      }
    },
    [KEYS.workforce, ['lookup', 'employees'], KEYS.delegation],
    (result) => (result.link || result.linkError ? setAdded(result) : onAdded(result.id)),
  );

  if (added?.link) {
    return <LoginLinkDialog name={added.name} link={added.link} onClose={() => onAdded(added.id)} />;
  }
  if (added?.linkError) {
    return (
      <FormDialog
        title={`${added.name} is added`}
        description={<p>Their login wasn&apos;t made: {added.linkError} Open their page to try again with another number.</p>}
        submitLabel="Open their page"
        pending={false}
        error={null}
        onClose={() => onAdded(added.id)}
        onSubmit={() => onAdded(added.id)}
      />
    );
  }

  const wantsLogin = offerLogin && f.login;
  return (
    <FormDialog
      title="Add a worker"
      description={<p>Pay rate and employment details can be set on their page afterwards.</p>}
      submitLabel={wantsLogin ? 'Add and get login link' : 'Add worker'}
      pending={add.isPending}
      error={problem ?? add.error}
      onClose={onClose}
      onSubmit={() => {
        if (f.name.trim().length < 2) return setProblem('Enter their name.');
        if (wantsLogin && !normalizeIndianMobile(f.phone)) return setProblem('Enter their 10-digit mobile number: it is what they sign in with.');
        if (f.phone.trim() && !/^[0-9+ -]{6,20}$/.test(f.phone.trim())) return setProblem('That phone number looks wrong.');
        setProblem(null);
        add.mutate({ name: f.name.trim(), roleType: f.role, phone: f.phone.trim() || null, address: f.address.trim() || null, login: wantsLogin });
      }}
    >
      <Field label="Name" wide>
        {(p) => <input {...p} value={f.name} onChange={(e) => set({ name: e.target.value })} />}
      </Field>
      <Field label="Role">
        {(p) => (
          <select {...p} value={f.role} onChange={(e) => set({ role: e.target.value })}>
            {Object.entries(ROLE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={wantsLogin ? 'Mobile number' : 'Mobile number (optional)'} hint={wantsLogin ? 'They sign in with it' : undefined}>
        {(p) => (
          <input
            {...p}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="98765 43210"
            value={f.phone}
            onChange={(e) => set({ phone: e.target.value })}
          />
        )}
      </Field>
      <Field label="Address (optional)" wide>
        {(p) => <textarea {...p} maxLength={500} value={f.address} onChange={(e) => set({ address: e.target.value })} />}
      </Field>
      {offerLogin && (
        <div className="field field-check form-wide">
          <input id="worker-login" type="checkbox" checked={f.login} onChange={(e) => set({ login: e.target.checked })} />
          <label htmlFor="worker-login">Give them a login for the Driver app — you get a link to send them, to set their own password</label>
        </div>
      )}
      <p className="footnote form-wide">ID documents (Aadhaar, licence) are attached on their page after adding.</p>
    </FormDialog>
  );
}

interface AddedWorker {
  id: string;
  name: string;
  link: LoginLink | null;
  linkError: string | null;
}

// ---- App login ----

/** Asks for the number to sign in with when the worker has no login yet; otherwise just confirms. */
function LoginLinkRequestDialog({ worker, onClose, onLink }: { worker: WorkerDetail; onClose: () => void; onLink: (link: LoginLink) => void }) {
  const [phone, setPhone] = useState(worker.phone ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const request = useAction(
    (body: { phone?: string }) => apiSend<LoginLink>('POST', `workforce/workers/${worker.employeeId}/login-link`, body),
    [KEYS.workforce],
    onLink,
  );
  return (
    <FormDialog
      title={worker.hasLogin ? `New password link — ${worker.name}` : `App login — ${worker.name}`}
      description={
        <p>
          {worker.hasLogin
            ? 'They choose a new password with it. Their current password keeps working until they do; earlier links stop working.'
            : 'You get a link to send them. On it they choose their own password, then sign in to the Driver app with this mobile number.'}
        </p>
      }
      submitLabel="Get the link"
      pending={request.isPending}
      error={problem ?? request.error}
      onClose={onClose}
      onSubmit={() => {
        if (worker.hasLogin) return request.mutate({});
        if (!normalizeIndianMobile(phone)) return setProblem('Enter their 10-digit mobile number.');
        setProblem(null);
        request.mutate({ phone: phone.trim() });
      }}
    >
      {!worker.hasLogin && (
        <Field label="Mobile number" hint="They sign in with it" wide>
          {(p) => <input {...p} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />}
        </Field>
      )}
    </FormDialog>
  );
}

/** The link, with ways to send it: WhatsApp to their number, or copy. */
export function LoginLinkDialog({ name, link, onClose }: { name: string; link: LoginLink; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const digits = link.login.replace(/\D/g, '');
  const message =
    `Hello ${name}, this is your Morbeez login. Open this link to set your password: ${link.link}\n\n` +
    `Then open the Morbeez app, tap Driver, and sign in with ${displayLogin(link.login)} and that password. The link works once, for 7 days.`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link.link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <FormDialog
      title={link.created ? `Login made for ${name}` : `New password link for ${name}`}
      description={
        <p>
          Send them this link. They choose their password on it, then sign in to the Driver app with{' '}
          <strong>{displayLogin(link.login)}</strong>. It works once, until{' '}
          {formatDateTime(link.expiresAt, Intl.DateTimeFormat().resolvedOptions().timeZone)}.
        </p>
      }
      submitLabel="Done"
      pending={false}
      error={null}
      onClose={onClose}
      onSubmit={onClose}
    >
      <input className="link-input form-wide" readOnly value={link.link} aria-label="Password set-up link" onFocus={(e) => e.target.select()} />
      <div className="link-actions form-wide">
        <a
          className="button button-primary"
          href={`https://wa.me/${digits}?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Share on WhatsApp
        </a>
        <button type="button" className="button" onClick={copy}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
    </FormDialog>
  );
}

// ---- Documents ----

const DOCUMENT_LABEL: Record<WorkerDocumentKind, string> = {
  aadhaar: 'Aadhaar',
  driving_licence: 'Driving licence',
  pan: 'PAN card',
  photo: 'Photo',
  other: 'Other document',
};

function DocumentsList({ worker, canWrite }: { worker: WorkerDetail; canWrite: boolean }) {
  const remove = useAction(
    (doc: WorkerDocument) => apiSend('POST', `workforce/workers/${worker.employeeId}/documents/${doc.id}/remove`),
    [KEYS.workforce],
  );
  if (worker.documents.length === 0) return <p className="muted">No documents attached.</p>;
  return (
    <ul className="doc-list">
      {worker.documents.map((d) => (
        <li key={d.id} className="doc-item">
          <div className="doc-text">
            <strong>{DOCUMENT_LABEL[d.kind]}</strong>
            {d.label && <span> · {d.label}</span>}
            <div className="cell-sub">
              {d.contentType === 'application/pdf' ? 'PDF' : 'Photo'} · {Math.max(1, Math.round(d.sizeBytes / 1024))} KB ·{' '}
              {formatDate(d.uploadedAt.slice(0, 10))}
            </div>
          </div>
          <span className="row-actions">
            <a
              className="button button-ghost"
              href={`/api/backend/workforce/workers/${worker.employeeId}/documents/${d.id}/file`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View
            </a>
            {canWrite && (
              <button type="button" className="button button-ghost" disabled={remove.isPending} onClick={() => remove.mutate(d)}>
                Remove
              </button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function DocumentDialog({ worker, onClose }: { worker: WorkerDetail; onClose: () => void }) {
  const [kind, setKind] = useState<WorkerDocumentKind>('aadhaar');
  const [label, setLabel] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const upload = useAction((form: FormData) => apiUpload(`workforce/workers/${worker.employeeId}/documents`, form), [KEYS.workforce], onClose);
  return (
    <FormDialog
      title={`Attach a document — ${worker.name}`}
      description={<p>A photo of the card (or a PDF), up to 10 MB. Take it with the camera or choose a file.</p>}
      submitLabel="Attach"
      pending={upload.isPending}
      error={problem ?? upload.error}
      onClose={onClose}
      onSubmit={() => {
        if (!file) return setProblem('Choose the photo or PDF.');
        if (file.size > 10 * 1024 * 1024) return setProblem('That file is over 10 MB.');
        if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.type)) return setProblem('Attach a photo (JPG, PNG, WebP) or a PDF.');
        setProblem(null);
        const form = new FormData();
        form.append('kind', kind);
        if (label.trim()) form.append('label', label.trim());
        form.append('file', file);
        upload.mutate(form);
      }}
    >
      <Field label="Document">
        {(p) => (
          <select {...p} value={kind} onChange={(e) => setKind(e.target.value as WorkerDocumentKind)}>
            {Object.entries(DOCUMENT_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Number or note (optional)" hint="e.g. the licence number">
        {(p) => <input {...p} maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} />}
      </Field>
      <Field label="Photo or PDF" wide>
        {(p) => (
          <input {...p} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        )}
      </Field>
    </FormDialog>
  );
}
