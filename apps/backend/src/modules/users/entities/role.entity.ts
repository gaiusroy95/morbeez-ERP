export interface RoleRecord {
  id: string;
  tenantId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PermissionRecord {
  id: string;
  code: string;
  description: string;
}

export interface RoleWithPermissions extends RoleRecord {
  permissions: string[]; // permission codes
}
