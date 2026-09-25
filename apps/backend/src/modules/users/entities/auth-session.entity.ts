export interface AuthSessionRecord {
  id: string;
  tenantId: string;
  userId: string;
  refreshTokenHash: string;
  deviceInfo: string | null;
  issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}
