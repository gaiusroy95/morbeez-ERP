export type ApprovalRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface ApprovalRuleRecord {
  id: string;
  tenantId: string;
  actionType: string;
  thresholdAmount: string; // numeric as string — Constitution III.2
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

export interface ApprovalRoleLimitRecord {
  id: string;
  tenantId: string;
  roleId: string;
  actionType: string | null; // null = wildcard, applies to every action type
  maxAmount: string | null; // null = unlimited
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

export interface ApprovalRequestRecord {
  id: string;
  tenantId: string;
  actionType: string;
  subjectId: string;
  amount: string | null;
  status: ApprovalRequestStatus;
  requestedBy: string;
  decidedBy: string | null;
  decidedViaRoleId: string | null;
  decidedViaDelegationId: string | null;
  decisionNote: string | null;
  decidedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApprovalDelegationRecord {
  id: string;
  tenantId: string;
  roleId: string;
  delegatorUserId: string;
  delegateUserId: string;
  startsAt: Date;
  endsAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  createdBy: string;
}

/** What evaluating a business action against the approval rules produces. */
export type ApprovalEvaluation =
  | { required: false }
  | { required: true; request: ApprovalRequestRecord };
