export interface AuthSessionRecord {
  id: string;
  tenantId: string;
  userId: string;
  refreshTokenHash: string;
  deviceInfo: string | null;
  issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  /** Every session rotated from one login shares this (Security Audit SA-04). */
  familyId: string;
  /** When this session was exchanged for its successor; null if revoked another way. */
  rotatedAt: Date | null;
  /** The driver app's install id, when it sent one (DRV.11). */
  deviceId: string | null;
}
