// The shape Passport attaches to `request.user` once a JWT is verified.
// Lives outside modules/users/ deliberately — the JWT guard and
// permissions guard in common/ read this shape without importing anything
// from the Users module (Constitution I.4: cross-module coupling happens
// through contracts like this one, not direct reach-in).
export interface AuthContext {
  userId: string;
  tenantId: string;
  /** What this person signs in with: their mobile number (E.164) or email. */
  login: string;
  roles: string[];
  permissions: string[];
}

declare module 'express' {
  interface Request {
    user?: AuthContext;
  }
}
