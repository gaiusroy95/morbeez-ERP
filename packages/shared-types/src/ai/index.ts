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
  kind: 'payment' | 'order' | 'quantity';
  customerId: string;
  name: string;
  phone: string | null;
  place: string | null;
  amount: string | null;
  dueDate: IsoDate | null;
  overdueDays: number | null;
  recommendationId: string | null;
  about: string | null;
}

export interface CallList {
  voice: 'coming';
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
