export const VALID_ROLE_TYPES = ['driver', 'warehouse', 'procurement', 'finance', 'other'] as const;
export type EmployeeRoleType = (typeof VALID_ROLE_TYPES)[number];

export type EmployeeStatus = 'active' | 'archived';

export interface EmploymentTerms {
  salary?: number;
  hourlyRate?: number;
  joiningDate?: string;
}

export interface EmployeeRecord {
  id: string;
  tenantId: string;
  userId: string | null; // not every employee has a login (Domain Model, Workforce)
  name: string;
  roleType: EmployeeRoleType;
  employmentTerms: EmploymentTerms;
  status: EmployeeStatus;
  /** The highest delegation level the owner has made this person eligible for (1–4); null: not eligible. */
  delegationLevel: number | null;
  /** Eligibility is a standing permission: authorized at that level on every trip they drive, no per-trip approval. */
  standingDelegation: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}
