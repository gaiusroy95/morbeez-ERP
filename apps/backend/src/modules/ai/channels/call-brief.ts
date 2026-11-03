// What a call is about, as Sarvam's voice agent is told it, and what comes
// back (AI Calling; requirements Part 23; the client: a conversation, not
// press 1 / press 2). The facts — the amount due, the order and its lines —
// are fixed by code when the call is placed (REC.1); the agent holds the
// conversation in the customer's language and reports what was agreed, in
// the output variables named here. The agent itself is set up in Sarvam's
// workspace to this contract: docs/integrations/sarvam-voice-agent.md.

import { Language } from '../../../common/languages';

export type CallPurpose = 'payment_reminder' | 'order_reminder' | 'order_confirm' | 'quantity_confirm' | 'follow_up';
export type CallStatus = 'queued' | 'completed' | 'no_answer' | 'busy' | 'failed';

/** What the agent reports, as its `call_outcome` output variable (an enum in Sarvam). */
export const CALL_OUTCOMES = ['confirmed', 'change_requested', 'will_pay', 'already_paid', 'call_later', 'not_interested', 'wrong_person', 'no_decision'] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/** Sarvam's names for the languages (its initial_language_name). */
export const LANGUAGE_NAME: Record<Language, string> = { en: 'English', ml: 'Malayalam', kn: 'Kannada', ta: 'Tamil' };

/**
 * The agent's input variables: every one a string, empty when it isn't
 * this call's — the agent's instructions say what to do with each purpose.
 */
export interface CallBrief {
  business_name: string;
  customer_name: string;
  call_purpose: CallPurpose;
  customer_language: string;
  amount_due: string;
  due_since: string;
  order_number: string;
  delivery_date: string;
  order_lines: string;
  order_total: string;
  usual_order: string;
  topic: string;
}

export interface BriefLine {
  name: string;
  quantity: string;
  uom: string;
  unitPrice?: string | null;
}

const inr = (v: string | number) => `${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })} rupees`;
const qty = (q: string, uom: string) => `${Number(Number(q).toFixed(3)).toLocaleString('en-IN')} ${uom}`;

/** "20 kg Tomato at 30 rupees per kg; 5 kg Onion at 40 rupees per kg". */
export function linesInWords(lines: BriefLine[], withPrices: boolean): string {
  return lines.map((l) => `${qty(l.quantity, l.uom)} ${l.name}${withPrices && l.unitPrice ? ` at ${inr(l.unitPrice)} per ${l.uom}` : ''}`).join('; ');
}

export function briefFor(
  purpose: CallPurpose,
  lang: Language,
  f: { business: string; customer: string; amountDue?: string; dueSince?: string | null; orderNumber?: string; deliveryDate?: string | null; lines?: BriefLine[]; orderTotal?: string; topic?: string },
): CallBrief {
  const orderCall = purpose === 'order_confirm' || purpose === 'quantity_confirm';
  return {
    business_name: f.business.trim().replace(/\.+$/, ''),
    customer_name: f.customer,
    call_purpose: purpose,
    customer_language: LANGUAGE_NAME[lang],
    amount_due: purpose === 'payment_reminder' && f.amountDue ? inr(f.amountDue) : '',
    due_since: purpose === 'payment_reminder' && f.dueSince ? f.dueSince : '',
    order_number: orderCall ? (f.orderNumber ?? '') : '',
    delivery_date: (orderCall || purpose === 'order_reminder') && f.deliveryDate ? f.deliveryDate : '',
    order_lines: orderCall ? linesInWords(f.lines ?? [], true) : '',
    order_total: orderCall && f.orderTotal ? inr(f.orderTotal) : '',
    usual_order: purpose === 'order_reminder' ? linesInWords(f.lines ?? [], false) : '',
    topic: purpose === 'follow_up' ? (f.topic ?? '').trim() : '',
  };
}

const PURPOSE_WORDS: Record<CallPurpose, string> = {
  payment_reminder: 'Payment reminder',
  order_reminder: "Tomorrow's order",
  order_confirm: 'Confirm a new order',
  quantity_confirm: 'Confirm quantities and prices',
  follow_up: 'Follow-up',
};

/** What the call is about, in one line — shown before it's placed, and kept with it. */
export function describeBrief(b: CallBrief): string {
  const about =
    b.call_purpose === 'payment_reminder'
      ? `${b.amount_due} due${b.due_since ? ` since ${b.due_since}` : ''}`
      : b.call_purpose === 'order_reminder'
        ? `their usual order${b.delivery_date ? ` for ${b.delivery_date}` : ''}: ${b.usual_order}`
        : b.call_purpose === 'follow_up'
          ? b.topic
          : `order ${b.order_number}${b.delivery_date ? ` for ${b.delivery_date}` : ''}: ${b.order_lines}${b.order_total ? ` (${b.order_total})` : ''}`;
  return `${PURPOSE_WORDS[b.call_purpose]} — ${about}${/[.!?]$/.test(about) ? '' : '.'} The agent speaks ${b.customer_language}.`;
}

// ---- What Sarvam reports when the call ends ----

export interface CallResult {
  attemptId: string | null;
  status: CallStatus;
  durationSeconds: number | null;
  interactionId: string | null;
  error: string | null;
  outcome: CallOutcome | null;
  summary: string | null;
  details: Record<string, unknown> | null;
  transcript: { role: 'agent' | 'user'; text: string }[] | null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The agent's outcome, when it's one of ours; anything else is "no decision". */
export function outcomeOf(v: unknown): CallOutcome | null {
  const s = str(v)?.toLowerCase().replace(/[\s-]+/g, '_') ?? null;
  if (s === null) return null;
  return (CALL_OUTCOMES as readonly string[]).includes(s) ? (s as CallOutcome) : 'no_decision';
}

/** Sarvam's instant-outbound webhook, read defensively: connected → completed. */
export function resultOf(payload: unknown): CallResult {
  const p = obj(payload);
  const raw = str(p.status);
  const status: CallStatus = raw === 'connected' ? 'completed' : raw === 'no_answer' ? 'no_answer' : raw === 'busy' ? 'busy' : 'failed';
  const vars = p.final_agent_variables && typeof p.final_agent_variables === 'object' ? obj(p.final_agent_variables) : null;
  const turns = Array.isArray(p.interaction_transcript) ? p.interaction_transcript : null;
  const duration = typeof p.duration === 'number' && Number.isFinite(p.duration) ? Math.round(p.duration) : null;
  return {
    attemptId: str(p.attempt_id),
    status,
    durationSeconds: duration,
    interactionId: str(p.interaction_id),
    error: status === 'failed' ? (str(p.failure_reason) ?? 'The call could not be placed') : null,
    outcome: vars ? outcomeOf(vars.call_outcome) : null,
    summary: vars ? (str(vars.call_summary)?.slice(0, 1000) ?? null) : null,
    details: vars,
    transcript: turns
      ? turns
          .map((t) => obj(t))
          .filter((t) => str(t.en_text))
          .slice(0, 200)
          .map((t) => ({ role: t.role === 'agent' ? ('agent' as const) : ('user' as const), text: (str(t.en_text) as string).slice(0, 2000) }))
      : null,
  };
}
