import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersRepository } from './repositories/users.repository';
import { AuthSessionsRepository } from './repositories/auth-sessions.repository';
import { PasswordService } from './security/password.service';
import { TokenService } from './security/token.service';
import { PublicUser, toPublicUser } from './entities/user.entity';
import { AuthContext } from '../../common/types/auth-context';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: AuthSessionsRepository,
    private readonly password: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  async login(
    email: string,
    plaintextPassword: string,
    deviceInfo?: string,
  ): Promise<TokenPair> {
    const user = await this.users.findByEmailForLogin(email);

    // Deliberately the same error, same shape, whether the email doesn't
    // exist or the password is wrong — a distinct "no such user" message
    // is a free account-enumeration oracle.
    const invalid = () => new UnauthorizedException('Invalid email or password');

    if (!user) throw invalid();
    if (user.status !== 'active') throw invalid();

    const passwordMatches = await this.password.verify(
      user.passwordHash,
      plaintextPassword,
    );
    if (!passwordMatches) throw invalid();

    const { roles, permissions } = await this.users.findRolesAndPermissions(
      user.tenantId,
      user.id,
    );

    const context: AuthContext = {
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      roles,
      permissions,
    };

    const accessToken = this.tokens.signAccessToken(context);
    const refresh = this.tokens.generateRefreshToken();
    await this.sessions.create(
      user.tenantId,
      user.id,
      refresh.hash,
      deviceInfo,
      refresh.expiresAt,
    );

    return { accessToken, refreshToken: refresh.raw, user: toPublicUser(user) };
  }

  /**
   * Refresh token rotation: the presented token is revoked and a new one
   * issued in the same call, never just re-validated and handed back
   * unchanged. A stolen-but-unused refresh token becomes detectable —
   * if it's ever replayed after rotation, the session it named is already
   * gone.
   */
  async refresh(rawRefreshToken: string, deviceInfo?: string): Promise<TokenPair> {
    const hash = this.tokens.hashRefreshToken(rawRefreshToken);
    const session = await this.sessions.findByRefreshTokenHash(hash);

    const invalid = () => new UnauthorizedException('Invalid or expired refresh token');

    if (!session) throw invalid();
    if (session.revokedAt) throw invalid();
    if (session.expiresAt.getTime() < Date.now()) throw invalid();

    const user = await this.users.findById(session.tenantId, session.userId);
    if (!user || user.status !== 'active') throw invalid();

    await this.sessions.revoke(session.tenantId, session.id);

    const { roles, permissions } = await this.users.findRolesAndPermissions(
      user.tenantId,
      user.id,
    );
    const context: AuthContext = {
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      roles,
      permissions,
    };

    const accessToken = this.tokens.signAccessToken(context);
    const newRefresh = this.tokens.generateRefreshToken();
    await this.sessions.create(
      user.tenantId,
      user.id,
      newRefresh.hash,
      deviceInfo,
      newRefresh.expiresAt,
    );

    return { accessToken, refreshToken: newRefresh.raw, user: toPublicUser(user) };
  }

  async logout(tenantId: string, rawRefreshToken: string): Promise<void> {
    const hash = this.tokens.hashRefreshToken(rawRefreshToken);
    const session = await this.sessions.findByRefreshTokenHash(hash);
    if (session && session.tenantId === tenantId) {
      await this.sessions.revoke(tenantId, session.id);
    }
    // A refresh token that doesn't match this tenant, or doesn't exist at
    // all, is treated as already logged out — not an error a client needs
    // to handle differently.
  }
}
