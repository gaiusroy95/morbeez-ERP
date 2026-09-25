import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'requiredPermissions';

// Declares the permission codes a route needs, read by PermissionsGuard.
// The route handler itself never checks request.user.permissions directly
// — authorization logic lives in exactly one place (Constitution V.2:
// checked in one shared middleware/guard layer, not reimplemented per
// endpoint).
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
