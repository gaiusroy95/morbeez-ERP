// AI recommendations: what the AI suggests, with its evidence, and what the
// owner decided (AI System design, DR/REC/EVAL). Money is a decimal string.
// Mirrored in packages/shared-types/src/ai.

import type { Confidence } from '../math/forecast';

export type RecommendationType = 'pricing' | 'procurement' | 'logistics_route' | 'logistics_load' | 'customer_terms' | 'exception' | 'order';
export const RECOMMENDATION_TYPES: RecommendationType[] = ['pricing', 'procurement', 'logistics_route', 'logistics_load', 'customer_terms', 'exception', 'order'];
export type RecommendationDecision = 'accepted' | 'modified' | 'dismissed' | 'expired';
export type RecommendationStatus = 'open' | RecommendationDecision;

/** Who may decide each type: the owner holds all of these; delegating one is granting it (DR.2). */
export const DECIDE_PERMISSION: Record<RecommendationType, string> = {
  pricing: 'ai:decide:pricing',
  procurement: 'ai:decide:procurement',
  logistics_route: 'ai:decide:logistics',
  logistics_load: 'ai:decide:logistics',
  customer_terms: 'ai:decide:customers',
  exception: 'ai:decide:exceptions',
  // A customer's order (owner Phase 8): the customer's, like their terms.
  order: 'ai:decide:customers',
};

export interface Evidence {
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
  disabledTypes: RecommendationType[];
  version: number;
}

/** A recommendation as a producer builds it, before it's stored. */
export interface Draft {
  type: RecommendationType;
  subjectKind: string;
  subjectId: string | null;
  targetDate: string | null;
  title: string;
  proposal: Record<string, unknown> & { action: string; compare?: Record<string, unknown> };
  evidence: Evidence[];
  explanation: string;
  expectedImpact: string | null;
  confidence: Confidence;
  sensitive: boolean;
  producer: string;
  expiresAt: Date;
}

export interface RecommendationRecord {
  id: string;
  runId: string;
  type: RecommendationType;
  subjectKind: string;
  subjectId: string | null;
  subjectName: string | null;
  targetDate: string | null;
  title: string;
  proposal: Record<string, unknown>;
  evidence: Evidence[];
  explanation: string;
  expectedImpact: string | null;
  confidence: Confidence;
  sensitive: boolean;
  producer: string;
  expiresAt: Date;
  createdAt: Date;
  status: RecommendationStatus;
  decision: {
    decision: RecommendationDecision;
    decidedByEmail: string | null;
    decidedAt: Date;
    submitted: Record<string, unknown> | null;
    reason: string | null;
    resultRef: Record<string, unknown> | null;
  } | null;
}

export interface RunSummary {
  runId: string;
  startedAt: Date;
  finishedAt: Date;
  produced: Record<string, number>;
  suppressed: Record<string, string>;
  byEmail: string | null;
}

export interface Scorecard {
  since: string;
  byType: { type: RecommendationType; shown: number; accepted: number; modified: number; dismissed: number; expired: number; open: number }[];
  buying: {
    scored: number;
    wapeFollowed: number | null; // accepted or modified
    wapeNotFollowed: number | null; // dismissed, expired or left open
    withinTenPct: number; // days the forecast landed within 10% of what sold
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

/** AI Pricing (owner Phase 8; requirements Part 15): each product's price against what it costs to sell. */
export interface PricingRow {
  productId: string;
  name: string;
  uom: string;
  /** Null: no list price set yet. */
  currentPrice: string | null;
  /** Free stock and what it cost; null without costed stock. */
  stockQty: string | null;
  unitCost: string | null;
  /** Cost + spoilage + delivery = sustainable; + target margin = target. Null without costed stock. */
  buildUp: { shrinkRate: number; spoilage: string; delivery: string | null; sustainable: string; target: string } | null;
  standing: 'no_price' | 'no_cost' | 'below_cost' | 'below_sustainable' | 'below_target' | 'on_target';
  /** What today's price keeps over the sustainable price, %. */
  marginPct: number | null;
  realized: { low: string; high: string; average: string; lines: number } | null;
  /** An open price suggestion for it. */
  suggestionId: string | null;
}

export interface PricingBoard {
  asOf: string;
  currency: string;
  targetMarginPct: string;
  /** Delivering a kilo over the last 30 days — trip expenses and fuel over kilos delivered. */
  deliveryPerKg: string | null;
  deliveryWindow: { from: string; to: string; cost: string; kg: string };
  rows: PricingRow[];
}

/** AI Calling (owner Phase 8; requirements Part 21–23): today's calls, made by a person until AI voice arrives. */
export interface CallItem {
  /** payment: money fallen due; order: their usual order not placed; quantity: an order to confirm. */
  kind: 'payment' | 'order' | 'quantity';
  customerId: string;
  name: string;
  phone: string | null;
  place: string | null;
  amount: string | null;
  dueDate: string | null;
  overdueDays: number | null;
  recommendationId: string | null;
  /** The suggestion's title, for an order or a quantity to confirm. */
  about: string | null;
}

export interface CallList {
  /** Automated calls: Twilio set up on the server and turned on by the business; else these are for the owner to make. */
  voice: 'ready' | 'off' | 'not_set_up';
  date: string;
  calls: CallItem[];
}

export interface CustomerProfitReport {
  from: string;
  to: string;
  currency: string;
  costOfCapitalPct: string;
  rows: CustomerProfitRow[];
  totals: { revenue: string; grossMargin: string; deliveryCost: string; creditCost: string; contribution: string };
}
