import { compareMoney, normalizeMoney, subtractMoney } from '../../common/money';
import { BackhaulPaymentMethod, BackhaulRecord, BackhaulStep } from './entities/backhaul.entity';
import { ChecklistItem } from './entities/trip-reconciliation.entity';

/** A backhaul's steps, in order (client spec §17). */
export const BACKHAUL_STEPS: BackhaulStep[] = ['pickup_reached', 'loaded', 'drop_reached', 'completed'];

const STEP_AT: Record<BackhaulStep, keyof BackhaulRecord> = {
  pickup_reached: 'pickupReachedAt',
  loaded: 'loadedAt',
  drop_reached: 'dropReachedAt',
  completed: 'completedAt',
};

const STEP_NAME: Record<BackhaulStep, string> = {
  pickup_reached: 'Pickup reached',
  loaded: 'Load complete',
  drop_reached: 'Drop reached',
  completed: 'Complete backhaul',
};

const METHOD_NAME: Record<BackhaulPaymentMethod, string> = { cash: 'cash', upi: 'UPI', bank_transfer: 'bank transfer' };

const rupees = (amount: string) => `₹${normalizeMoney(amount)}`;
export const routeOf = (b: Pick<BackhaulRecord, 'pickupPlace' | 'dropPlace'>) => `${b.pickupPlace} → ${b.dropPlace}`;

export function stepAt(b: BackhaulRecord, step: BackhaulStep): Date | null {
  return b[STEP_AT[step]] as Date | null;
}

/** The step an accepted backhaul is at next; null when it isn't under way. */
export function nextStepOf(b: BackhaulRecord): BackhaulStep | null {
  if (b.status !== 'accepted') return null;
  return BACKHAUL_STEPS.find((s) => stepAt(b, s) === null) ?? null;
}

/**
 * Why [step] can't be recorded now, or null when it can. A step already
 * recorded is no problem: it's the same request again (a retry). The load
 * needs its photo first, and so does completing it at the drop.
 */
export function stepProblemOf(b: BackhaulRecord, step: BackhaulStep): string | null {
  if (stepAt(b, step) !== null) return null;
  if (b.status === 'offered') return 'Accept the backhaul first';
  if (b.status !== 'accepted') return `This backhaul was ${b.status}`;
  const next = nextStepOf(b) as BackhaulStep;
  if (next !== step) return `${STEP_NAME[next]} comes first`;
  if (step === 'loaded' && b.photos.load === 0) return 'Take a photo of the load first';
  if (step === 'completed' && b.photos.drop === 0) return 'Take a photo at the drop first';
  return null;
}

/**
 * When a step (or the payment) happened: the phone's time when it sent one
 * (it may have been offline), never later than now and never before what was
 * recorded last — so the backhaul's timeline reads in order.
 */
export function happenedAt(b: BackhaulRecord, phoneAt: string | undefined, now = new Date()): Date {
  const latest = [b.acceptedAt, ...BACKHAUL_STEPS.map((s) => stepAt(b, s))]
    .filter((d): d is Date => d !== null)
    .reduce((a, d) => (d > a ? d : a), new Date(0));
  const at = phoneAt ? new Date(Math.min(Date.parse(phoneAt), now.getTime())) : now;
  return at < latest ? latest : at;
}

/** What keeps the vehicle from being back (Return): a backhaul not yet answered, or under way. */
export function returnHoldOf(backhauls: BackhaulRecord[]): string | null {
  const open = backhauls.find((b) => b.status === 'offered');
  if (open) return `Accept or skip the backhaul ${routeOf(open)} first`;
  const running = backhauls.find((b) => b.status === 'accepted');
  if (running) return `Finish the backhaul ${routeOf(running)} first`;
  return null;
}

/** What keeps the driver from handing over: Return's holds, and a backhaul done but not paid. */
export function handoverHoldOf(backhauls: BackhaulRecord[]): string | null {
  const unpaid = backhauls.find((b) => b.status === 'completed' && b.payment === null);
  return returnHoldOf(backhauls) ?? (unpaid ? `Record the payment for the backhaul ${routeOf(unpaid)} first` : null);
}

/**
 * The owner's backhaul check before closing (client spec §16: done, or
 * validly skipped, and paid): null when the trip had none. A skip with its
 * reason passes; one never answered, one left half-done, rent not received
 * or received short is an exception.
 */
export function backhaulCheckOf(backhauls: BackhaulRecord[]): ChecklistItem | null {
  const live = backhauls.filter((b) => b.status !== 'cancelled');
  if (live.length === 0) return null;
  const problems: string[] = [];
  const fine: string[] = [];
  for (const b of live) {
    const route = routeOf(b);
    if (b.status === 'offered') problems.push(`${route}: never accepted or skipped`);
    else if (b.status === 'accepted') problems.push(`${route}: started but not completed`);
    else if (b.status === 'skipped') fine.push(`${route}: skipped (${b.skipReason})`);
    else if (b.payment === null) problems.push(`${route}: rent of ${rupees(b.rent)} not received`);
    else {
      const short = subtractMoney(b.rent, b.payment.amount);
      if (compareMoney(short, '0') > 0) {
        problems.push(`${route}: received ${rupees(b.payment.amount)} of ${rupees(b.rent)} rent (${rupees(short)} short)`);
      } else {
        fine.push(`${route}: ${rupees(b.payment.amount)} received by ${METHOD_NAME[b.payment.method]}`);
      }
    }
  }
  return problems.length === 0
    ? { area: 'backhaul', status: 'pass', detail: `${fine.join('; ')}.` }
    : { area: 'backhaul', status: 'exception', detail: `${[...problems, ...fine].join('; ')}.` };
}
