export type UserStatus = 'active' | 'deactivated';

// The full row, as stored — password_hash included. Nothing in this file
// leaves the repository layer; every response DTO maps through
// PublicUser below instead, so a hash can never accidentally serialize
// into an API response.
export interface UserRecord {
  id: string;
  tenantId: string;
  // A login is a mobile number (E.164), an email, or both — never neither
  // (identity.app_user_has_login).
  email: string | null;
  phone: string | null;
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

/** What someone signs in with, for showing back to them: the phone if there is one. */
export function loginOf(user: Pick<UserRecord, 'email' | 'phone'>): string {
  return user.phone ?? user.email ?? '';
}

/** Who signs in: a mobile number (E.164) or an email address. */
export interface LoginIdentity {
  email?: string | null;
  phone?: string | null;
}
