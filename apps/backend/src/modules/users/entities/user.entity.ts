export type UserStatus = 'active' | 'deactivated';

// The full row, as stored — password_hash included. Nothing in this file
// leaves the repository layer; every response DTO maps through
// PublicUser below instead, so a hash can never accidentally serialize
// into an API response.
export interface UserRecord {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type PublicUser = Omit<UserRecord, 'passwordHash'>;

export function toPublicUser(user: UserRecord): PublicUser {
  const { passwordHash: _passwordHash, ...publicUser } = user;
  return publicUser;
}
