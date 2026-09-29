// Mirrors apps/backend/src/modules/workforce/entities/payroll.entity.ts (the
// /workforce endpoints). Money and quantities are decimal strings.
import type { IsoDateTime } from '../common';

export type EmploymentType = 'permanent' | 'casual' | 'contract';
export type SkillCategory = 'unskilled' | 'semi_skilled' | 'skilled' | 'highly_skilled';
export type PayBasis = 'monthly' | 'daily' | 'hourly' | 'piece';
export type AssignmentKind = 'trip' | 'warehouse' | 'loading' | 'grading' | 'market' | 'other';
export type AssignmentStatus = 'planned' | 'completed' | 'absent' | 'cancelled';
export type IncentiveBasis = 'per_trip' | 'per_unit' | 'attendance';
export type SettlementStatus = 'draft' | 'approved' | 'paid' | 'void';
export type SettlementLineKind = 'basic' | 'incentive' | 'minimum_wage_topup' | 'adjustment' | 'advance_recovery';

export interface PayrollSettings {
  defaultStateCode: string | null;
  minWagePolicy: 'top_up' | 'warn';
  version: number; // 0 = never saved
}

export interface PayRate {
  id: string;
  employeeId: string;
  payBasis: PayBasis;
  rate: string;
  unitLabel: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface WorkerRow {
  employeeId: string;
  name: string;
  roleType: string;
  status: 'active' | 'archived';
  hasLogin: boolean;
  employmentType: EmploymentType;
  skillCategory: SkillCategory;
  workStateCode: string | null;
  joinedOn: string | null;
  leftOn: string | null;
  phone: string | null;
  profileVersion: number; // 0 = no profile saved yet
  currentRate: PayRate | null;
  advanceOutstanding: string;
}

export interface WorkerDetail extends WorkerRow {
  rates: PayRate[];
}

export interface AssignmentRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  workDate: string;
  kind: AssignmentKind;
  status: AssignmentStatus;
  hours: string | null;
  units: string | null;
  tripId: string | null;
  notes: string | null;
  settlementId: string | null;
  settlementNumber: number | null;
  version: number;
}

export interface IncentiveRule {
  id: string;
  name: string;
  roleType: string | null;
  basis: IncentiveBasis;
  threshold: string;
  amount: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface MinimumWageRate {
  id: string;
  stateCode: string;
  skillCategory: SkillCategory;
  dailyRate: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  source: string | null;
}

export interface AdvanceRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  amount: string;
  recovered: string;
  outstanding: string;
  paidOn: string;
  paidFrom: 'bank' | 'cash_on_hand';
  notes: string | null;
}

export interface SettlementLine {
  kind: SettlementLineKind;
  description: string;
  quantity: string | null;
  rate: string | null;
  amount: string; // negative for deductions
  incentiveRuleId: string | null;
  advanceId: string | null;
}

export interface SettlementRecord {
  id: string;
  settlementNumber: number;
  employeeId: string;
  employeeName: string;
  periodStart: string;
  periodEnd: string;
  status: SettlementStatus;
  gross: string;
  deductions: string;
  net: string;
  warnings: string[];
  preparedBy: string;
  preparedByEmail: string | null;
  preparedAt: IsoDateTime;
  approvedByEmail: string | null;
  approvedAt: IsoDateTime | null;
  paidAt: IsoDateTime | null;
  paidFrom: 'bank' | 'cash_on_hand' | null;
  paymentReference: string | null;
  voidedAt: IsoDateTime | null;
  voidReason: string | null;
  version: number;
  lines?: SettlementLine[];
  daysWorked?: number;
}

/** One worker's pay for a period, as the draft would be — before it's saved. */
export interface EarningsPreview {
  employeeId: string;
  employeeName: string;
  periodStart: string;
  periodEnd: string;
  daysWorked: number;
  lines: SettlementLine[];
  gross: string;
  deductions: string;
  net: string;
  warnings: string[];
  assignmentIds: string[];
  blockedBy: string | null; // why no settlement can be drafted (e.g. an overlapping one)
}

// Request bodies.
export interface WorkerProfileBody {
  version: number;
  employmentType: EmploymentType;
  skillCategory: SkillCategory;
  workStateCode?: string | null;
  joinedOn?: string | null;
  leftOn?: string | null;
  phone?: string | null;
}
