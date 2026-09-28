// Mirrors ApprovalRequestRecord in apps/backend/src/modules/approvals/entities/approval.entity.ts.
// An order or purchase order over its approval threshold carries one of
// these until someone with a high enough limit decides it.
import type { IsoDateTime } from '../common';

export type ApprovalRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface ApprovalRequestRecord {
  id: string;
  actionType: string;
  subjectId: string;
  amount: string | null;
  status: ApprovalRequestStatus;
  requestedBy: string;
  decidedBy: string | null;
  decisionNote: string | null;
  decidedAt: IsoDateTime | null;
  version: number;
  createdAt: IsoDateTime;
}
