// Mirrors apps/backend/src/modules/ai/entities/ai.entity.ts (the /ai
// endpoints) and the map pins under /logistics/pins. Money is a decimal string.
import type { IsoDate, IsoDateTime } from '../common';

export type AiRecommendationType = 'pricing' | 'procurement' | 'logistics_route' | 'logistics_load' | 'customer_terms' | 'exception' | 'order';
export type AiConfidence = 'solid' | 'rough_guide' | 'early_estimate';
export type AiDecision = 'accepted' | 'modified' | 'dismissed' | 'expired';
export type AiStatus = 'open' | AiDecision;

export const AI_DECIDE_PERMISSION: Record<AiRecommendationType, string> = {
  pricing: 'ai:decide:pricing',
  procurement: 'ai:decide:procurement',
  logistics_route: 'ai:decide:logistics',
  logistics_load: 'ai:decide:logistics',
  customer_terms: 'ai:decide:customers',
  exception: 'ai:decide:exceptions',
  order: 'ai:decide:customers',
};

export interface AiEvidence {
  fact: string;
  value?: string;
  source?: { kind: string; ids?: string[]; label?: string };
}

export interface AiSettings {
  targetMarginPct: string;
  maxPriceMovePct: string;
  minCustomerMarginPct: string;
  costOfCapitalPct: string;
  defaultCostPerKm: string;
  disabledTypes: AiRecommendationType[];
  version: number;
}

export interface AiRecommendation {
  id: string;
  runId: string;
  type: AiRecommendationType;
  subjectKind: string;
  subjectId: string | null;
  subjectName: string | null;
  targetDate: IsoDate | null;
  title: string;
  // Shape depends on proposal.action — see the owner app's action dialogs.
  proposal: Record<string, unknown> & { action: string; compare?: Record<string, unknown> };
  evidence: AiEvidence[];
  explanation: string;
  expectedImpact: string | null;
  confidence: AiConfidence;
  sensitive: boolean;
  producer: string;
  expiresAt: IsoDateTime;
  createdAt: IsoDateTime;
  status: AiStatus;
  decision: {
    decision: AiDecision;
    decidedByEmail: string | null;
    decidedAt: IsoDateTime;
    submitted: Record<string, unknown> | null;
    reason: string | null;
    resultRef: Record<string, unknown> | null;
  } | null;
}

export interface AiRunSummary {
  runId: string;
  startedAt: IsoDateTime;
  finishedAt: IsoDateTime;
  produced: Record<string, number>;
  suppressed: Record<string, string>;
  byEmail: string | null;
}

export interface AiScorecard {
  since: IsoDate;
  byType: { type: AiRecommendationType; shown: number; accepted: number; modified: number; dismissed: number; expired: number; open: number }[];
  buying: {
    scored: number;
    wapeFollowed: number | null;
    wapeNotFollowed: number | null;
    withinTenPct: number;
    backtest: { wape: number | null; bias: number | null; days: number; products: number };
  };
  pricing: { scored: number; realizedVsSuggestedPct: number | null };
}

export interface CustomerProfitRow {
  customerId: string;
  customerName: string;
  invoices: number;
  revenue: string;
  cogs: string;
  grossMargin: string;
  grossMarginPct: number | null;
  deliveryCost: string;
  creditCost: string;
  crateLossesAbsorbed: string;
  financeChargeIncome: string;
  crateRecoveries: string;
  contribution: string;
  contributionPct: number | null;
  averageDaysToPay: number | null;
  paymentTermsDays: number;
}

export interface CustomerProfitReport {
  from: IsoDate;
  to: IsoDate;
  currency: string;
  costOfCapitalPct: string;
  rows: CustomerProfitRow[];
  totals: { revenue: string; grossMargin: string; deliveryCost: string; creditCost: string; contribution: string };
}

// ---- AI Pricing and AI Calling (owner Phase 8) ----

export type PriceStanding = 'no_price' | 'no_cost' | 'below_cost' | 'below_sustainable' | 'below_target' | 'on_target';

export interface PricingRow {
  productId: string;
  name: string;
  uom: string;
  currentPrice: string | null;
  stockQty: string | null;
  unitCost: string | null;
  buildUp: { shrinkRate: number; spoilage: string; delivery: string | null; sustainable: string; target: string } | null;
  standing: PriceStanding;
  marginPct: number | null;
  realized: { low: string; high: string; average: string; lines: number } | null;
  suggestionId: string | null;
}

export interface PricingBoard {
  asOf: IsoDate;
  currency: string;
  targetMarginPct: string;
  deliveryPerKg: string | null;
  deliveryWindow: { from: IsoDate; to: IsoDate; cost: string; kg: string };
  rows: PricingRow[];
}

export interface CallItem {
  /** payment: money fallen due; order: their usual order not placed; quantity: an order far from usual; new_order: an order placed in the last day. */
  kind: 'payment' | 'order' | 'quantity' | 'new_order';
  customerId: string;
  name: string;
  phone: string | null;
  place: string | null;
  /** Asked not to be called by the AI agent. */
  doNotCall: boolean;
  amount: string | null;
  dueDate: IsoDate | null;
  overdueDays: number | null;
  recommendationId: string | null;
  orderId: string | null;
  about: string | null;
}

export interface CallList {
  /** AI calls: Sarvam Voice Agents set up on the server and turned on by the business; else these are for the owner to make. */
  voice: 'ready' | 'off' | 'not_set_up';
  date: IsoDate;
  calls: CallItem[];
}

export interface PlacePin {
  kind: 'customer' | 'farmer' | 'depot';
  refId: string | null;
  name: string;
  latitude: string | null;
  longitude: string | null;
}

// ---- The AI's channels to customers: WhatsApp orders, automated calls ----

export interface IntegrationSettings {
  whatsappPhoneNumberId: string | null;
  whatsappReply: boolean;
  callsEnabled: boolean;
  version: number;
}

/** GET integrations — what this server has keys for, and the business's choices. */
export interface IntegrationsStatus {
  publicApiUrl: string | null;
  whatsapp: { receives: boolean; replies: boolean; webhookUrl: string | null; messagesLast7Days: number };
  reader: { sarvam: boolean; model: string | null };
  calls: { ready: boolean; fromNumber: string | null; callsLast7Days: number };
  settings: IntegrationSettings;
}

export type InboundStatus = 'received' | 'suggested' | 'no_customer' | 'no_order' | 'not_text' | 'failed';

/** GET ai/whatsapp/messages — a message a customer sent, and what came of it. */
export interface InboundMessage {
  id: string;
  channel: 'whatsapp';
  fromPhone: string;
  senderName: string | null;
  customerId: string | null;
  customerName: string | null;
  messageType: string;
  body: string;
  receivedAt: IsoDateTime;
  status: InboundStatus;
  reader: 'sarvam' | 'rules' | null;
  extraction: { delivery?: string; lines?: { productId: string; quantity: number; said: string }[]; notUnderstood?: string[] } | null;
  recommendationId: string | null;
  note: string | null;
  repliedAt: IsoDateTime | null;
}

export type CallPurpose = 'payment_reminder' | 'order_reminder' | 'order_confirm' | 'quantity_confirm' | 'follow_up';
export type VoiceCallStatus = 'queued' | 'completed' | 'no_answer' | 'busy' | 'failed';
export type CallOutcome = 'confirmed' | 'change_requested' | 'will_pay' | 'already_paid' | 'call_later' | 'not_interested' | 'wrong_person' | 'no_decision';

/** What Sarvam's voice agent was told (its input variables). */
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

/** GET ai/calls/voice — a call the AI agent made, and what came of it. */
export interface VoiceCall {
  id: string;
  customerId: string;
  customerName: string;
  purpose: CallPurpose;
  language: string;
  toPhone: string;
  brief: CallBrief;
  orderId: string | null;
  topic: string | null;
  status: VoiceCallStatus;
  outcome: CallOutcome | null;
  summary: string | null;
  /** Everything the agent collected (its output variables): requested_changes, promised_payment_date, callback_time, … */
  details: Record<string, unknown> | null;
  transcript: { role: 'agent' | 'user'; text: string }[] | null;
  endedAt: IsoDateTime | null;
  durationSeconds: number | null;
  error: string | null;
  requestedBy: string | null;
  createdAt: IsoDateTime;
}
