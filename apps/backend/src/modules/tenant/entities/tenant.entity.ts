export interface TenantRecord {
  id: string;
  name: string;
  plan: string;
  currency: string;
  timezone: string;
  taxRegistration: string | null;
  branding: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
