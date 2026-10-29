'use client';

import { useState } from 'react';
import type {
  AgentRecord,
  CreatePurchaseOrderBody,
  FarmerPaymentRecord,
  GradeLotBody,
  LotPaymentStatus,
  LotRecord,
  PaymentMethod,
  PickupRecord,
  ProcurementBoardDay,
  ProcurementCard,
  ProcurementStage,
  PurchaseOrderRecord,
  PurchaseOrderStatus,
  ReceiveGoodsBody,
  SchedulePickupBody,
  SettleLotBody,
} from '@morbeez/shared-types';
import { ErrorState, SkeletonLines } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyRow } from '@/components/ui/ListControls';
import { DetailPanel, KeyValues } from '@/components/ui/DetailPanel';
import { ActionBar, Field, FormDialog } from '@/components/ui/Form';
import { ApprovalGate } from '@/components/forms/ApprovalGate';
import { emptyLine, LinesEditor, parseLines, withProduct, type LineDraft } from '@/components/forms/LinesEditor';
import { METHOD_LABEL } from '@/components/forms/PaymentDialogs';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { usePurchaseOrder } from '@/lib/hooks/use-modules';
import {
  useActiveDrivers,
  useActiveFarmers,
  useActiveProducts,
  useActiveVehicles,
  useCurrency,
  useEmployeeName,
  useFarmerName,
  useProductName,
  useProductUom,
  useTenantProfile,
  useVehicleName,
} from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { QuickAddFarmer, QuickAddProduct, useCanAdd } from '@/components/forms/QuickAdd';
import { SearchSelect } from '@/components/forms/SearchSelect';
import { useT } from '@/lib/i18n';
import { clock, formatDate, formatDateTime, formatMoney, formatQuantity, todayIn } from '@/lib/format';
import {
  firstError,
  localDateTimeToIso,
  optionalText,
  parseMoney,
  parseQuantity,
  type Parsed,
} from '@/lib/parse';
import { useOpenOnNew } from '@/lib/hooks/use-open-on-new';
import { formatPoNumber, useAgents, useProcurementBoard } from '@/lib/hooks/use-procurement';
import { CreateBar, DayTabs, ListCard, SearchFilter, type CardTone } from '@/components/redesign/ListCards';

// Purchase-order statuses read differently from order statuses — 'placed'
// here is waiting on the farmer's confirmation, 'confirmed' is waiting on
// produce, 'received' is waiting on grading.
const PO_LABEL: Partial<Record<PurchaseOrderStatus, string>> = {
  placed: 'To confirm',
  confirmed: 'Awaiting produce',
  received: 'To grade',
};

// Grading creates stock and a farmer payable; paying moves cash — so these
// refresh inventory and finance as well as procurement.
const PO_EFFECTS = [KEYS.procurement, KEYS.inventory, KEYS.finance, KEYS.dashboard];

function poBadge(po: PurchaseOrderRecord) {
  if (po.status === 'placed' && po.approvalRequestId) return <StatusBadge status="awaiting_approval" />;
  return <StatusBadge status={po.status} label={PO_LABEL[po.status]} />;
}

function val<T>(parsed: Parsed<T>): T {
  return (parsed as { value: T }).value;
}

// ---- New purchase order ----

/**
 * "Create Procurement" (client design V1.1, screen 4): farmer, pickup date
 * and time, driver and vehicle, products by the kilo or the bag, an
 * optional agent with a commission per kg, notes. Saving confirms the
 * order and schedules the pickup in one go; an order over the approval
 * limit waits for approval and its pickup is scheduled once approved.
 */
function NewPurchaseOrderDialog({
  onClose,
  onCreated,
  initialFarmerId = '',
}: {
  onClose: () => void;
  onCreated: (po: PurchaseOrderRecord) => void;
  /** "New Procurement" on a farmer's profile: who it's from. */
  initialFarmerId?: string;
}) {
  const t = useT();
  const farmers = useActiveFarmers();
  const products = useActiveProducts();
  const drivers = useActiveDrivers();
  const vehicles = useActiveVehicles();
  const agents = useAgents();
  const currency = useCurrency();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const [form, setForm] = useState({
    farmerId: initialFarmerId,
    date: todayIn(timeZone),
    time: '',
    driverId: '',
    vehicleId: '',
    agentId: '',
    commission: '',
    notes: '',
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const [addingFarmer, setAddingFarmer] = useState<string | null>(null);
  const [addingAgent, setAddingAgent] = useState<string | null>(null);
  const canAddFarmer = useCanAdd('farmers');
  const [addingProduct, setAddingProduct] = useState<{ lineKey: number; name: string } | null>(null);
  const canAddProduct = useCanAdd('products');
  const [lines, setLines] = useState<LineDraft[]>(() => [emptyLine()]);
  const [problem, setProblem] = useState<string | null>(null);
  const create = useAction(
    (body: CreatePurchaseOrderBody) => apiSend<PurchaseOrderRecord>('POST', 'procurement/purchase-orders', body),
    PO_EFFECTS,
    onCreated,
  );
  const farmer = farmers.records.find((f) => f.id === form.farmerId);
  const activeAgents = (agents.data ?? []).filter((a) => a.status === 'active');

  const submit = () => {
    if (!form.farmerId) return setProblem(t('Choose the farmer.'));
    if (!form.date) return setProblem(t('Choose the pickup date.'));
    if (!form.driverId || !form.vehicleId) return setProblem(t('Choose the driver and the vehicle.'));
    const parsed = parseLines(lines, false, products.records);
    if (!parsed.ok) return setProblem(parsed.error);
    let commission: number | undefined;
    if (form.agentId && form.commission.trim()) {
      const c = parseMoney(form.commission, 'the commission');
      if (!c.ok) return setProblem(c.error);
      commission = c.value;
    }
    setProblem(null);
    create.mutate({
      farmerId: form.farmerId,
      pickupDate: form.date,
      pickupTime: form.time || undefined,
      driverEmployeeId: form.driverId,
      vehicleId: form.vehicleId,
      agentId: form.agentId || undefined,
      commissionPerKg: commission,
      notes: optionalText(form.notes),
      confirm: true,
      lines: parsed.value.map((line) => ({
        productId: line.productId,
        expectedQuantity: line.quantity,
        indicativePrice: line.price ?? 0,
        ...(line.bags !== undefined ? { bags: line.bags, kgPerBag: line.kgPerBag } : {}),
      })),
    });
  };

  return (
    <>
      <FormDialog
        title={t('Create Procurement')}
        description={<p>{t('The rate is indicative — what the farmer is actually paid is fixed per lot at grading.')}</p>}
        submitLabel={t('Save Procurement')}
        size="wide"
        pending={create.isPending}
        error={problem ?? create.error}
        onClose={onClose}
        onSubmit={submit}
      >
        <Field label={t('Farmer')} wide>
          {(props) => (
            <SearchSelect
              {...props}
              value={form.farmerId}
              onChange={(farmerId) => set({ farmerId })}
              loading={farmers.isPending}
              placeholder={t('Choose a farmer…')}
              searchPlaceholder={t('Search by name or phone…')}
              options={farmers.records.map((f) => ({ value: f.id, label: f.name, sub: f.place ?? f.contact?.phone }))}
              createLabel={canAddFarmer ? t('Create new farmer') : undefined}
              onCreate={canAddFarmer ? (typed) => setAddingFarmer(typed) : undefined}
            />
          )}
        </Field>
        {farmer && (
          <div className="farmer-card form-wide">
            <span className="list-card-badge" aria-hidden="true">
              {farmer.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="farmer-card-text">
              <strong>{farmer.name}</strong>
              {farmer.place && <span>{farmer.place}</span>}
              {farmer.contact?.phone && <span>{farmer.contact.phone}</span>}
            </span>
            <a className="button button-small" href="/farmers" target="_blank" rel="noopener noreferrer">
              {t('View')}
            </a>
          </div>
        )}
        <Field label={t('Pickup Date')}>
          {(props) => <input {...props} type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />}
        </Field>
        <Field label={t('Pickup time (optional)')}>
          {(props) => <input {...props} type="time" value={form.time} onChange={(e) => set({ time: e.target.value })} />}
        </Field>
        <Field label={t('Driver')}>
          {(props) => (
            <select {...props} value={form.driverId} onChange={(e) => set({ driverId: e.target.value })}>
              <option value="">{drivers.isPending ? t('Loading…') : t('Choose a driver…')}</option>
              {drivers.records.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('Vehicle')}>
          {(props) => (
            <select {...props} value={form.vehicleId} onChange={(e) => set({ vehicleId: e.target.value })}>
              <option value="">{vehicles.isPending ? t('Loading…') : t('Choose a vehicle…')}</option>
              {vehicles.records.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.registrationNumber}
                </option>
              ))}
            </select>
          )}
        </Field>
        <p className="form-section-title form-wide">{t('Products')}</p>
        <LinesEditor
          lines={lines}
          onChange={setLines}
          products={products.records}
          onAddProduct={canAddProduct ? (lineKey, name) => setAddingProduct({ lineKey, name }) : undefined}
          currency={currency}
          priceLabel={t('Rate (₹/kg)')}
          priceOptional={false}
          bags
        />
        <Field label={t('Agent (optional)')}>
          {(props) => (
            <SearchSelect
              {...props}
              value={form.agentId}
              onChange={(agentId) => {
                const agent = activeAgents.find((a) => a.id === agentId);
                set({ agentId, commission: agent && Number(agent.defaultCommissionPerKg) > 0 ? agent.defaultCommissionPerKg : form.commission });
              }}
              loading={agents.isPending}
              placeholder={t('Select Agent')}
              searchPlaceholder={t('Search agents…')}
              options={[{ value: '', label: t('No agent') }, ...activeAgents.map((a) => ({ value: a.id, label: a.name, sub: a.phone }))]}
              createLabel={t('Create new agent')}
              onCreate={(typed) => setAddingAgent(typed)}
            />
          )}
        </Field>
        <Field label={t('Commission (₹/kg)')} hint={form.agentId ? undefined : t('Choose an agent first')}>
          {(props) => (
            <input
              {...props}
              inputMode="decimal"
              disabled={!form.agentId}
              placeholder="0.00"
              value={form.commission}
              onChange={(e) => set({ commission: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('Notes (optional)')} wide>
          {(props) => <textarea {...props} maxLength={500} placeholder={t('Enter notes…')} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}
        </Field>
      </FormDialog>
      {addingProduct && (
        <QuickAddProduct
          initialName={addingProduct.name}
          onClose={() => setAddingProduct(null)}
          onAdded={(product) => {
            setLines((current) => withProduct(current, addingProduct.lineKey, product));
            setAddingProduct(null);
          }}
        />
      )}
      {addingFarmer !== null && (
        <QuickAddFarmer
          initialName={addingFarmer}
          onClose={() => setAddingFarmer(null)}
          onAdded={(f) => {
            set({ farmerId: f.id });
            setAddingFarmer(null);
          }}
        />
      )}
      {addingAgent !== null && (
        <QuickAddAgent
          initialName={addingAgent}
          onClose={() => setAddingAgent(null)}
          onAdded={(agent) => {
            set({ agentId: agent.id, commission: Number(agent.defaultCommissionPerKg) > 0 ? agent.defaultCommissionPerKg : form.commission });
            setAddingAgent(null);
          }}
        />
      )}
    </>
  );
}

/** A new agent from inside the form: name, phone, usual commission. */
function QuickAddAgent({ initialName, onClose, onAdded }: { initialName: string; onClose: () => void; onAdded: (a: AgentRecord) => void }) {
  const t = useT();
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState('');
  const [commission, setCommission] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const add = useAction(
    (body: { name: string; phone?: string; defaultCommissionPerKg?: number }) => apiSend<AgentRecord>('POST', 'procurement/agents', body),
    [['procurement', 'agents']],
    onAdded,
  );
  return (
    <FormDialog
      title={t('Add an agent')}
      submitLabel={t('Add agent')}
      pending={add.isPending}
      error={problem ?? add.error}
      onClose={onClose}
      onSubmit={() => {
        if (name.trim().length < 2) return setProblem(t("Enter the agent's name."));
        let c: number | undefined;
        if (commission.trim()) {
          const parsed = parseMoney(commission, 'the commission');
          if (!parsed.ok) return setProblem(parsed.error);
          c = parsed.value;
        }
        setProblem(null);
        add.mutate({ name: name.trim(), phone: optionalText(phone), defaultCommissionPerKg: c });
      }}
    >
      <Field label={t('Name')} wide>
        {(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <Field label={t('Phone (optional)')}>
        {(p) => <input {...p} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />}
      </Field>
      <Field label={t('Usual commission (₹/kg)')}>
        {(p) => <input {...p} inputMode="decimal" value={commission} onChange={(e) => setCommission(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

function VehicleAndDriverFields({
  vehicleId,
  driverId,
  onChange,
  optional,
}: {
  vehicleId: string;
  driverId: string;
  onChange: (patch: { vehicleId?: string; driverId?: string }) => void;
  optional: boolean;
}) {
  const vehicles = useActiveVehicles();
  const drivers = useActiveDrivers();
  const suffix = optional ? ' (optional)' : '';
  return (
    <>
      <Field label={`Vehicle${suffix}`}>
        {(props) => (
          <select {...props} value={vehicleId} onChange={(e) => onChange({ vehicleId: e.target.value })}>
            <option value="">{optional ? 'Decide later' : 'Choose a vehicle…'}</option>
            {vehicles.records.map((v) => (
              <option key={v.id} value={v.id}>
                {v.registrationNumber}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={`Driver${suffix}`}>
        {(props) => (
          <select {...props} value={driverId} onChange={(e) => onChange({ driverId: e.target.value })}>
            <option value="">{optional ? 'Decide later' : 'Choose a driver…'}</option>
            {drivers.records.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
      </Field>
    </>
  );
}

function ConfirmPurchaseOrderDialog({ po, onClose }: { po: PurchaseOrderRecord; onClose: () => void }) {
  const [date, setDate] = useState(po.expectedDeliveryDate?.slice(0, 10) ?? '');
  const confirm = useAction(
    () =>
      apiSend<PurchaseOrderRecord>('POST', `procurement/purchase-orders/${po.id}/confirm`, {
        version: po.version,
        expectedDeliveryDate: date || undefined,
      }),
    PO_EFFECTS,
    onClose,
  );
  return (
    <FormDialog
      title="Confirm this purchase order?"
      description={
        <p>Confirm once the farmer has agreed. If it&apos;s over your approval threshold it goes for approval first.</p>
      }
      submitLabel="Confirm"
      pending={confirm.isPending}
      error={confirm.error}
      onClose={onClose}
      onSubmit={() => confirm.mutate(undefined)}
    >
      <Field label="Expected delivery (optional)">
        {(props) => <input {...props} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

function SchedulePickupDialog({ po, onClose }: { po: PurchaseOrderRecord; onClose: () => void }) {
  const [form, setForm] = useState({ vehicleId: '', driverId: '', at: '' });
  const schedule = useAction(
    (body: SchedulePickupBody) => apiSend<PickupRecord>('POST', `procurement/purchase-orders/${po.id}/pickups`, body),
    [...PO_EFFECTS, KEYS.logistics],
    onClose,
  );
  return (
    <FormDialog
      title="Schedule a pickup"
      description={<p>A pickup can then be added to a trip as one of its stops (Trips).</p>}
      submitLabel="Schedule"
      pending={schedule.isPending}
      error={schedule.error}
      onClose={onClose}
      onSubmit={() =>
        schedule.mutate({
          vehicleId: form.vehicleId || undefined,
          driverEmployeeId: form.driverId || undefined,
          scheduledAt: localDateTimeToIso(form.at),
        })
      }
    >
      <Field label="When (optional)" wide>
        {(props) => (
          <input {...props} type="datetime-local" value={form.at} onChange={(e) => setForm({ ...form, at: e.target.value })} />
        )}
      </Field>
      <VehicleAndDriverFields
        vehicleId={form.vehicleId}
        driverId={form.driverId}
        optional
        onChange={(patch) =>
          setForm({ ...form, vehicleId: patch.vehicleId ?? form.vehicleId, driverId: patch.driverId ?? form.driverId })
        }
      />
    </FormDialog>
  );
}

function ReceiveGoodsDialog({
  po,
  pickups,
  onClose,
}: {
  po: PurchaseOrderRecord;
  pickups: PickupRecord[];
  onClose: () => void;
}) {
  const productName = useProductName();
  const productUom = useProductUom();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const usable = pickups.filter((p) => p.status !== 'cancelled');
  const [pickupId, setPickupId] = useState(usable.length === 1 ? usable[0].id : '');
  // Prefilled with what was ordered; the person corrects it to what arrived.
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries((po.lines ?? []).map((line) => [line.productId, String(Number(line.expectedQuantity))])),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const receive = useAction(
    (body: ReceiveGoodsBody) => apiSend<LotRecord[]>('POST', `procurement/purchase-orders/${po.id}/receive-goods`, body),
    PO_EFFECTS,
    onClose,
  );

  const submit = () => {
    const lines: ReceiveGoodsBody['lines'] = [];
    for (const line of po.lines ?? []) {
      const text = quantities[line.productId] ?? '';
      if (text.trim() === '' || Number(text) === 0) continue; // nothing of this product arrived
      const quantity = parseQuantity(text, `the quantity of ${productName(line.productId)}`);
      if (!quantity.ok) return setProblem(quantity.error);
      lines.push({ productId: line.productId, receivedQuantity: quantity.value });
    }
    if (lines.length === 0) return setProblem('Enter what arrived for at least one product.');
    setProblem(null);
    receive.mutate({ lines, pickupId: pickupId || undefined });
  };

  return (
    <FormDialog
      title="Receive goods"
      description={
        <p>
          Enter what actually arrived, by weight or count. Each product becomes a lot waiting for grading. Leave a
          product at 0 if none of it came.
        </p>
      }
      submitLabel="Record receipt"
      pending={receive.isPending}
      error={problem ?? receive.error}
      onClose={onClose}
      onSubmit={submit}
    >
      {(po.lines ?? []).map((line) => {
        const uom = productUom(line.productId);
        return (
          <Field
            key={line.id}
            label={`${productName(line.productId)} (${uom})`}
            hint={`Ordered ${formatQuantity(line.expectedQuantity, uom)}`}
          >
            {(props) => (
              <input
                {...props}
                inputMode="decimal"
                value={quantities[line.productId] ?? ''}
                onChange={(e) => setQuantities({ ...quantities, [line.productId]: e.target.value })}
              />
            )}
          </Field>
        );
      })}
      {usable.length > 0 && (
        <Field label="Came on pickup (optional)" wide>
          {(props) => (
            <select {...props} value={pickupId} onChange={(e) => setPickupId(e.target.value)}>
              <option value="">Not linked to a pickup</option>
              {usable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.status === 'completed'
                    ? `Picked up ${formatDateTime(p.pickedUpAt, timeZone)}`
                    : `Scheduled ${formatDateTime(p.scheduledAt, timeZone)}`}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
    </FormDialog>
  );
}

// ---- Lot actions ----

function GradeLotDialog({
  lot,
  indicativePrice,
  onClose,
}: {
  lot: LotRecord;
  indicativePrice: string | undefined;
  onClose: () => void;
}) {
  const productName = useProductName();
  const productUom = useProductUom();
  const currency = useCurrency();
  const uom = productUom(lot.productId);
  const received = Number(lot.receivedQuantity);
  const [form, setForm] = useState({
    accepted: String(received),
    grade: '',
    reason: '',
    unitCost: indicativePrice ? String(Number(indicativePrice)) : '',
  });
  const [problem, setProblem] = useState<string | null>(null);
  const grade = useAction(
    (body: GradeLotBody) => apiSend<LotRecord>('POST', `procurement/lots/${lot.id}/grade`, body),
    PO_EFFECTS,
    onClose,
  );
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  // Rejected is whatever of the received quantity wasn't accepted, in
  // thousandths so 3-dp quantities subtract exactly.
  const acceptedMilli = Math.round(Number(form.accepted.replace(/,/g, '')) * 1000);
  const receivedMilli = Math.round(received * 1000);
  const rejectedMilli = receivedMilli - acceptedMilli;
  const rejected = Number.isFinite(rejectedMilli) ? rejectedMilli / 1000 : NaN;
  const fullyRejected = acceptedMilli === 0;

  const submit = () => {
    const accepted = parseQuantity(form.accepted, 'the accepted quantity', false);
    if (!accepted.ok) return setProblem(accepted.error);
    if (rejectedMilli < 0) return setProblem(`You can't accept more than the ${formatQuantity(lot.receivedQuantity, uom)} received.`);
    const unitCost: Parsed<number | undefined> = fullyRejected
      ? { ok: true, value: undefined }
      : parseMoney(form.unitCost, 'the rate paid per unit');
    const reason: Parsed<string | undefined> =
      rejectedMilli > 0 && form.reason.trim() === ''
        ? { ok: false, error: 'Say why part of the lot was rejected.' }
        : { ok: true, value: optionalText(form.reason) };
    const error = firstError([unitCost, reason]);
    if (error) return setProblem(error);
    setProblem(null);
    grade.mutate({
      version: lot.version,
      acceptedQuantity: accepted.value,
      rejectedQuantity: rejected,
      grade: optionalText(form.grade),
      rejectionReason: val(reason),
      unitCost: val(unitCost),
    });
  };

  return (
    <FormDialog
      title={`Grade ${productName(lot.productId)}`}
      description={
        <p>
          Received {formatQuantity(lot.receivedQuantity, uom)}. What you accept becomes sellable stock, and the farmer is
          owed accepted × rate.
        </p>
      }
      submitLabel="Save grading"
      pending={grade.isPending}
      error={problem ?? grade.error}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field label={`Accepted (${uom})`}>
        {(props) => <input {...props} inputMode="decimal" value={form.accepted} onChange={(e) => set({ accepted: e.target.value })} />}
      </Field>
      <Field label={`Rejected (${uom})`} hint="Received − accepted">
        {(props) => <input {...props} readOnly value={Number.isFinite(rejected) && rejected >= 0 ? String(rejected) : '—'} />}
      </Field>
      <Field label="Grade (optional)" hint="A, B, export…">
        {(props) => <input {...props} value={form.grade} onChange={(e) => set({ grade: e.target.value })} />}
      </Field>
      <Field label={`Rate paid per ${uom} (${currency})`} hint={fullyRejected ? 'Not needed — nothing accepted' : undefined}>
        {(props) => (
          <input
            {...props}
            inputMode="decimal"
            disabled={fullyRejected}
            value={form.unitCost}
            onChange={(e) => set({ unitCost: e.target.value })}
          />
        )}
      </Field>
      {rejectedMilli > 0 && (
        <Field label="Why was some rejected?" wide>
          {(props) => <input {...props} value={form.reason} onChange={(e) => set({ reason: e.target.value })} />}
        </Field>
      )}
    </FormDialog>
  );
}

function PayLotDialog({
  lot,
  payment,
  onClose,
}: {
  lot: LotRecord;
  payment: LotPaymentStatus;
  onClose: () => void;
}) {
  const productName = useProductName();
  const farmerName = useFarmerName();
  const currency = useCurrency();
  const [amount, setAmount] = useState(payment.outstanding);
  const [method, setMethod] = useState<PaymentMethod>('upi');
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const pay = useAction(
    (body: SettleLotBody) => apiSend<FarmerPaymentRecord>('POST', `procurement/lots/${lot.id}/settle`, body),
    PO_EFFECTS,
    onClose,
  );

  const submit = () => {
    const parsed = parseMoney(amount, 'the amount', true);
    if (!parsed.ok) return setProblem(parsed.error);
    setProblem(null);
    pay.mutate({ amount: parsed.value, method, notes: optionalText(notes) });
  };

  return (
    <FormDialog
      title={`Pay ${farmerName(lot.farmerId)} for ${productName(lot.productId)}`}
      description={
        <p>
          This lot is owed {formatMoney(payment.payable, currency)}; {formatMoney(payment.paid, currency)} paid so far.
          Paying more than what&apos;s outstanding records the rest as an advance to the farmer.
        </p>
      }
      submitLabel="Record payment"
      pending={pay.isPending}
      error={problem ?? pay.error}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field label={`Amount (${currency})`}>
        {(props) => <input {...props} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
      </Field>
      <Field label="Method">
        {(props) => (
          <select {...props} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Notes (optional)" wide>
        {(props) => <input {...props} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

function PickupRow({ pickup, canWrite }: { pickup: PickupRecord; canWrite: boolean }) {
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const vehicleName = useVehicleName();
  const employeeName = useEmployeeName();
  const [open, setOpen] = useState<'complete' | 'cancel' | null>(null);
  const [form, setForm] = useState({ vehicleId: pickup.vehicleId ?? '', driverId: pickup.driverEmployeeId ?? '' });
  const [problem, setProblem] = useState<string | null>(null);
  const close = () => setOpen(null);
  const complete = useAction(
    () =>
      apiSend<PickupRecord>('POST', `procurement/pickups/${pickup.id}/complete`, {
        version: pickup.version,
        vehicleId: form.vehicleId,
        driverEmployeeId: form.driverId,
      }),
    [...PO_EFFECTS, KEYS.logistics],
    close,
  );
  const cancel = useAction(
    () => apiSend<PickupRecord>('POST', `procurement/pickups/${pickup.id}/cancel`, { version: pickup.version }),
    [...PO_EFFECTS, KEYS.logistics],
    close,
  );

  return (
    <li>
      <StatusBadge status={pickup.status} />{' '}
      {pickup.status === 'completed'
        ? `Picked up ${formatDateTime(pickup.pickedUpAt, timeZone)}`
        : pickup.scheduledAt
          ? `Scheduled ${formatDateTime(pickup.scheduledAt, timeZone)}`
          : 'Scheduled, no time set'}
      {pickup.vehicleId && <span className="muted"> · {vehicleName(pickup.vehicleId)}</span>}
      {pickup.driverEmployeeId && <span className="muted"> · {employeeName(pickup.driverEmployeeId)}</span>}
      {canWrite && pickup.status === 'scheduled' && (
        <span className="row-actions" style={{ display: 'inline-flex', marginLeft: 8 }}>
          <button type="button" className="button button-small" onClick={() => setOpen('complete')}>
            Mark picked up
          </button>
          <button type="button" className="button button-small" onClick={() => setOpen('cancel')}>
            Cancel
          </button>
        </span>
      )}
      {open === 'complete' && (
        <FormDialog
          title="Mark as picked up"
          description={<p>Record which vehicle and driver actually collected it.</p>}
          submitLabel="Picked up"
          pending={complete.isPending}
          error={problem ?? complete.error}
          onClose={close}
          onSubmit={() => {
            if (!form.vehicleId || !form.driverId) return setProblem('Choose both the vehicle and the driver.');
            setProblem(null);
            complete.mutate(undefined);
          }}
        >
          <VehicleAndDriverFields
            vehicleId={form.vehicleId}
            driverId={form.driverId}
            optional={false}
            onChange={(patch) =>
              setForm({ vehicleId: patch.vehicleId ?? form.vehicleId, driverId: patch.driverId ?? form.driverId })
            }
          />
        </FormDialog>
      )}
      {open === 'cancel' && (
        <FormDialog
          title="Cancel this pickup?"
          submitLabel="Cancel pickup"
          tone="danger"
          pending={cancel.isPending}
          error={cancel.error}
          onClose={close}
          onSubmit={() => cancel.mutate(undefined)}
        />
      )}
    </li>
  );
}

// ---- Detail ----

function PurchaseOrderDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const { data, error, isPending, refetch } = usePurchaseOrder(id);
  const currency = useCurrency();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const farmerName = useFarmerName();
  const productName = useProductName();
  const productUom = useProductUom();
  const employeeName = useEmployeeName();
  const vehicleName = useVehicleName();
  const agents = useAgents();
  const agentName = (id: string) => agents.data?.find((a) => a.id === id)?.name ?? '—';
  const { data: session } = useSession();
  const canWrite = hasPermission(session, 'procurement:write');
  const canGrade = hasPermission(session, 'procurement:grade');
  const canSettle = hasPermission(session, 'procurement:settle');
  type Open =
    | { kind: 'confirm' | 'cancel' | 'pickup' | 'receive' }
    | { kind: 'grade'; lot: LotRecord }
    | { kind: 'pay'; lot: LotRecord; payment: LotPaymentStatus };
  const [open, setOpen] = useState<Open | null>(null);
  const close = () => setOpen(null);
  const cancel = useAction(
    () =>
      apiSend<PurchaseOrderRecord>('POST', `procurement/purchase-orders/${id}/cancel`, {
        version: data?.order.version,
      }),
    PO_EFFECTS,
    close,
  );

  if (isPending) {
    return (
      <DetailPanel title="Purchase order" onClose={onClose}>
        <SkeletonLines lines={6} />
      </DetailPanel>
    );
  }
  if (error) {
    return (
      <DetailPanel title="Purchase order" onClose={onClose}>
        <ErrorState error={error} onRetry={() => refetch()} />
      </DetailPanel>
    );
  }

  const { order, lots, pickups, payments } = data;
  const plan = [
    order.pickupDate ? formatDate(order.pickupDate.slice(0, 10)) : null,
    order.pickupTime,
  ]
    .filter(Boolean)
    .join(' · ');
  const awaiting = order.status === 'placed' && order.approvalRequestId !== null;
  const priceOf = (productId: string) => order.lines?.find((l) => l.productId === productId)?.indicativePrice;

  return (
    <DetailPanel title={`${formatPoNumber(order.number)} · ${farmerName(order.farmerId)}`} onClose={onClose}>
      <KeyValues
        items={[
          ['Farmer', farmerName(order.farmerId)],
          ['Status', poBadge(order)],
          ['Raised', formatDateTime(order.createdAt, timeZone)],
          ['Pickup', plan || '—'],
          ['Driver', order.plannedDriverId ? employeeName(order.plannedDriverId) : '—'],
          ['Vehicle', order.plannedVehicleId ? vehicleName(order.plannedVehicleId) : '—'],
          ...(order.agentId
            ? ([
                ['Agent', agentName(order.agentId)],
                ['Commission', order.commissionPerKg ? `${formatMoney(order.commissionPerKg, currency)} / kg` : '—'],
              ] as [string, string][])
            : []),
          ...(order.notes ? ([['Notes', order.notes]] as [string, string][]) : []),
        ]}
      />
      {awaiting && (
        <ApprovalGate
          requestId={order.approvalRequestId as string}
          subject="purchase order"
          currency={currency}
          timeZone={timeZone}
          canFinalize={canWrite}
          finalizePath={`procurement/purchase-orders/${order.id}/finalize-confirmation`}
          invalidates={PO_EFFECTS}
        />
      )}
      {canWrite && (order.status === 'placed' || order.status === 'confirmed') && (
        <ActionBar>
          {order.status === 'placed' && !awaiting && (
            <button type="button" className="button button-primary" onClick={() => setOpen({ kind: 'confirm' })}>
              Confirm
            </button>
          )}
          {order.status === 'confirmed' && (
            <>
              <button type="button" className="button button-primary" onClick={() => setOpen({ kind: 'receive' })}>
                Receive goods
              </button>
              <button type="button" className="button" onClick={() => setOpen({ kind: 'pickup' })}>
                Schedule pickup
              </button>
            </>
          )}
          <button type="button" className="button button-danger" onClick={() => setOpen({ kind: 'cancel' })}>
            Cancel
          </button>
        </ActionBar>
      )}

      <h3 className="detail-subhead">Ordered</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Product</th>
              <th className="align-right">Expected</th>
              <th className="align-right">Indicative rate</th>
            </tr>
          </thead>
          <tbody>
            {(order.lines ?? []).map((line) => (
              <tr key={line.id}>
                <td>{productName(line.productId)}</td>
                <td className="align-right">
                  {formatQuantity(line.expectedQuantity, productUom(line.productId))}
                  {line.bags && line.kgPerBag && (
                    <div className="cell-sub">
                      {formatQuantity(line.bags)} {t('bags')} × {formatQuantity(line.kgPerBag)} kg
                    </div>
                  )}
                </td>
                <td className="align-right">{formatMoney(line.indicativePrice, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="detail-subhead">Lots received</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Product</th>
              <th className="align-right">Accepted</th>
              <th className="align-right">Rate</th>
              <th>Paid</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lots.length === 0 && <EmptyRow colSpan={5}>Nothing received yet.</EmptyRow>}
            {lots.map((lot) => {
              const payment = payments.find((p) => p.lotId === lot.id);
              const uom = productUom(lot.productId);
              const owes = payment && Number(payment.outstanding) > 0;
              return (
                <tr key={lot.id}>
                  <td>
                    {productName(lot.productId)} <StatusBadge status={lot.status} />
                    {lot.grade && <div className="cell-sub">Grade {lot.grade}</div>}
                  </td>
                  <td className="align-right">
                    {formatQuantity(lot.acceptedQuantity, uom)}
                    <div className="cell-sub">of {formatQuantity(lot.receivedQuantity, uom)} received</div>
                  </td>
                  <td className="align-right">{lot.unitCost ? formatMoney(lot.unitCost, currency) : '—'}</td>
                  <td>
                    {!payment || Number(payment.payable) === 0 ? (
                      '—'
                    ) : owes ? (
                      <StatusBadge
                        status="unpaid"
                        tone="attention"
                        label={`${formatMoney(payment.outstanding, currency)} due`}
                      />
                    ) : (
                      <StatusBadge status="paid" tone="done" label={`Paid ${formatMoney(payment.paid, currency)}`} />
                    )}
                  </td>
                  <td>
                    <span className="row-actions">
                      {canGrade && lot.status === 'received_ungraded' && (
                        <button type="button" className="button button-small" onClick={() => setOpen({ kind: 'grade', lot })}>
                          Grade
                        </button>
                      )}
                      {canSettle && payment && owes && (
                        <button
                          type="button"
                          className="button button-small"
                          onClick={() => setOpen({ kind: 'pay', lot, payment })}
                        >
                          Pay
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pickups.length > 0 && (
        <>
          <h3 className="detail-subhead">Pickups</h3>
          <ul className="plain-list">
            {pickups.map((pickup) => (
              <PickupRow key={pickup.id} pickup={pickup} canWrite={canWrite} />
            ))}
          </ul>
        </>
      )}

      {open?.kind === 'confirm' && <ConfirmPurchaseOrderDialog po={order} onClose={close} />}
      {open?.kind === 'pickup' && <SchedulePickupDialog po={order} onClose={close} />}
      {open?.kind === 'receive' && <ReceiveGoodsDialog po={order} pickups={pickups} onClose={close} />}
      {open?.kind === 'grade' && (
        <GradeLotDialog lot={open.lot} indicativePrice={priceOf(open.lot.productId)} onClose={close} />
      )}
      {open?.kind === 'pay' && <PayLotDialog lot={open.lot} payment={open.payment} onClose={close} />}
      {open?.kind === 'cancel' && (
        <FormDialog
          title="Cancel this purchase order?"
          description={<p>The farmer should be told separately. This can&apos;t be undone.</p>}
          submitLabel="Cancel purchase order"
          tone="danger"
          pending={cancel.isPending}
          error={cancel.error}
          onClose={close}
          onSubmit={() => cancel.mutate(undefined)}
        />
      )}
    </DetailPanel>
  );
}

const STAGE: Record<ProcurementStage, { label: string; tone: CardTone }> = {
  pending: { label: 'Pending', tone: 'pending' },
  awaiting_approval: { label: 'Awaiting approval', tone: 'pending' },
  in_progress: { label: 'In Progress', tone: 'progress' },
  completed: { label: 'Completed', tone: 'done' },
  cancelled: { label: 'Cancelled', tone: 'bad' },
};

const STAGE_FILTER = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'awaiting_approval', label: 'Awaiting approval' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

/** "Ginger 500 kg", "Onion 10 bags (420 kg)", "+1 more". */
function productSummary(card: ProcurementCard): string {
  const first = card.products[0];
  if (!first) return '';
  const qty = first.bags
    ? `${formatQuantity(first.bags)} bags (${formatQuantity(first.quantity)} ${first.uom})`
    : `${formatQuantity(first.quantity)} ${first.uom}`;
  return `${first.name} ${qty}${card.products.length > 1 ? ` · +${card.products.length - 1}` : ''}`;
}

/** The Procurement list (client design V1.1, screen 3). */
export default function ProcurementPage() {
  const t = useT();
  const [day, setDay] = useState<ProcurementBoardDay>('today');
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [forFarmer, setForFarmer] = useState('');
  useOpenOnNew((params) => {
    setForFarmer(params.get('farmer') ?? '');
    setCreating(true);
  });
  const { data: session } = useSession();
  const canWrite = hasPermission(session, 'procurement:write');
  const board = useProcurementBoard(day, query);
  const cards = (board.data?.items ?? []).filter((c) => stage === 'all' || c.stage === stage);
  const counts = board.data?.counts;

  return (
    <div className="list-split">
      <div className="list-screen">
        <h1 className="page-title visually-hidden">{t('Procurement')}</h1>
        {creating && (
          <NewPurchaseOrderDialog
            initialFarmerId={forFarmer}
            onClose={() => {
              setCreating(false);
              setForFarmer('');
            }}
            onCreated={(po) => {
              setCreating(false);
              setForFarmer('');
              setSelected(po.id);
            }}
          />
        )}
        <DayTabs
          label="Which day"
          value={day}
          onChange={(value) => {
            setDay(value);
            setSelected(null);
          }}
          options={[
            { value: 'today', label: 'Today', count: counts?.today },
            { value: 'tomorrow', label: 'Tomorrow', count: counts?.tomorrow },
            { value: 'all', label: 'All', count: counts?.all },
          ]}
        />
        <SearchFilter
          value={query}
          onChange={setQuery}
          placeholder="Search farmer, product…"
          filter={{ value: stage, options: STAGE_FILTER, onChange: setStage, label: 'Filter by status' }}
        />
        {board.isPending ? (
          <SkeletonLines lines={5} height={64} />
        ) : board.error ? (
          <div className="panel">
            <ErrorState error={board.error} onRetry={() => board.refetch()} />
          </div>
        ) : (
          <div className="card-list" data-updating={board.isPlaceholderData || undefined}>
            {cards.length === 0 && (
              <div className="list-empty">{query || stage !== 'all' ? t('Nothing matches.') : t('No procurement for this day.')}</div>
            )}
            {cards.map((card) => (
              <ListCard
                key={card.id}
                number={formatPoNumber(card.number)}
                title={card.farmerName}
                place={card.farmerPlace}
                detail={productSummary(card)}
                time={clock(card.pickupTime)}
                status={STAGE[card.stage].label}
                tone={STAGE[card.stage].tone}
                person={card.driverName}
                vehicle={card.vehicle}
                initial={card.products[0]?.name ?? card.farmerName}
                selected={selected === card.id}
                onOpen={() => setSelected(card.id)}
              />
            ))}
          </div>
        )}
        {canWrite && <CreateBar label="Create Procurement" onClick={() => setCreating(true)} />}
      </div>
      {selected && <PurchaseOrderDetail key={selected} id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
