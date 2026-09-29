import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.validation';
import { randomBytes } from 'crypto';
import { RateLimiterService } from '../../infra/rate-limit/rate-limiter.service';
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
    private readonly limiter: RateLimiterService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** A real argon2 hash of nothing anyone knows — verified against when the email has no account, so both paths cost the same (Security Audit SA-13). */
  private dummyHash?: Promise<string>;
  private dummy(): Promise<string> {
    return (this.dummyHash ??= this.password.hash(randomBytes(24).toString('base64url')));
  }

  async login(
    email: string,
    plaintextPassword: string,
    deviceInfo?: string,
    ip?: string,
    deviceId?: string,
  ): Promise<TokenPair> {
    // Brute-force limits (Security Audit SA-02). Failures are counted per
    // account from this IP (so one person mistyping can't lock the real
    // owner out from elsewhere) and per account from anywhere (so guessing
    // spread across many IPs still runs out).
    const account = email.trim().toLowerCase();
    const failKeys = [`login-fail:${account}:${ip ?? '-'}`, `login-fail:${account}`];
    if (ip) {
      const max = this.config.get('LOGIN_ATTEMPTS_PER_IP_PER_MINUTE', { infer: true });
      await this.limiter.consume(`login-ip:${ip}`, { max, windowSeconds: 60 }, 'Too many sign-in attempts from this network.');
    }
    await this.limiter.assertUnder(failKeys[0], FAILS_PER_ACCOUNT_AND_IP, 'Too many failed sign-ins for this account.');
    await this.limiter.assertUnder(failKeys[1], FAILS_PER_ACCOUNT, 'Too many failed sign-ins for this account.');

    const user = await this.users.findByEmailForLogin(email);

    // Deliberately the same error, same shape, whether the email doesn't
    // exist or the password is wrong — a distinct "no such user" message
    // is a free account-enumeration oracle.
    const invalid = async () => {
      await this.limiter.record(failKeys[0], FAILS_PER_ACCOUNT_AND_IP.windowSeconds);
      await this.limiter.record(failKeys[1], FAILS_PER_ACCOUNT.windowSeconds);
      return new UnauthorizedException('Invalid email or password');
    };

    // Hash something either way, so an unknown email takes as long as a known one.
    const passwordMatches = await this.password.verify(user?.passwordHash ?? (await this.dummy()), plaintextPassword);
    if (!user || user.status !== 'active' || !passwordMatches) throw await invalid();
    await this.limiter.reset(failKeys[0]);

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
    await this.sessions.create(user.tenantId, user.id, refresh.hash, deviceInfo, refresh.expiresAt, {
      deviceId: deviceId ?? null,
    });

    return { accessToken, refreshToken: refresh.raw, user: toPublicUser(user) };
  }

  /**
   * Refresh token rotation: the presented token is exchanged for a new one,
   * exactly once (Security Audit SA-04). If a token that was already
   * rotated away comes back, two parties hold this login: the whole family
   * of sessions descended from it is revoked, cutting off the thief along
   * with the real user, who signs in again. The one exception is a short
   * grace window, so a client's own parallel requests that refreshed at the
   * same moment each get a token instead of logging the person out.
   */
  async refresh(rawRefreshToken: string, deviceInfo?: string, ip?: string): Promise<TokenPair> {
    if (ip) await this.limiter.consume(`refresh-ip:${ip}`, REFRESH_PER_IP, 'Too many requests from this network.');
    const hash = this.tokens.hashRefreshToken(rawRefreshToken);
    const session = await this.sessions.findByRefreshTokenHash(hash);

    const invalid = () => new UnauthorizedException('Invalid or expired refresh token');

    if (!session) throw invalid();
    if (session.expiresAt.getTime() < Date.now()) throw invalid();

    const user = await this.users.findById(session.tenantId, session.userId);
    if (!user || user.status !== 'active') throw invalid();
    const newRefresh = this.tokens.generateRefreshToken();
    const successor = { userId: user.id, refreshTokenHash: newRefresh.hash, deviceInfo, expiresAt: newRefresh.expiresAt };

    const rotated = session.revokedAt ? null : await this.sessions.rotate(session.tenantId, session.id, successor);
    if (!rotated) {
      // Already exchanged — by a parallel request a moment ago, or by someone else.
      const latest = await this.sessions.findByRefreshTokenHash(hash);
      if (!latest?.rotatedAt) throw invalid(); // revoked by logout or a password change
      if (Date.now() - latest.rotatedAt.getTime() > REFRESH_GRACE_MS) {
        await this.sessions.revokeFamily(latest.tenantId, latest.familyId);
        throw invalid();
      }
      // Within the grace window: a sibling token, unless the family was already cut off.
      if (!(await this.sessions.familyIsLive(latest.tenantId, latest.familyId))) throw invalid();
      await this.sessions.create(user.tenantId, user.id, newRefresh.hash, deviceInfo, newRefresh.expiresAt, {
        familyId: latest.familyId,
        deviceId: await this.sessions.deviceOf(latest.tenantId, latest.id),
      });
    }

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

const FAILS_PER_ACCOUNT_AND_IP = { max: 10, windowSeconds: 15 * 60 };
const FAILS_PER_ACCOUNT = { max: 30, windowSeconds: 60 * 60 };
const REFRESH_PER_IP = { max: 120, windowSeconds: 60 };
/** How long a just-rotated token still refreshes, for a client's own simultaneous requests. */
const REFRESH_GRACE_MS = 10_000;
