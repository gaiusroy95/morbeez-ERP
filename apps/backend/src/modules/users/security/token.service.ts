import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { Env } from '../../../config/env.validation';
import { AuthContext } from '../../../common/types/auth-context';

export interface AccessTokenPayload {
  sub: string; // user id
  tenantId: string;
  email: string;
  roles: string[];
  permissions: string[];
}

@Injectable()
export class TokenService {
  // Roles/permissions are embedded in the access token at issuance, not
  // looked up per-request — the tradeoff is explicit: a permission change
  // takes effect within one access-token TTL, not instantly. Acceptable
  // because that TTL is short (see ACCESS_TOKEN_TTL_SECONDS).
  private static readonly ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
  private static readonly REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  signAccessToken(context: AuthContext): string {
    const payload: AccessTokenPayload = {
      sub: context.userId,
      tenantId: context.tenantId,
      email: context.email,
      roles: context.roles,
      permissions: context.permissions,
    };
    return this.jwt.sign(payload, {
      secret: this.config.get('JWT_SECRET', { infer: true }),
      expiresIn: TokenService.ACCESS_TOKEN_TTL_SECONDS,
    });
  }

  /**
   * A refresh token is high-entropy random data, not a JWT — it carries no
   * claims of its own and is meaningless outside a lookup against
   * auth_session, which is exactly what makes it revocable (Constitution
   * V.7). Only its hash is ever persisted; the raw value exists for the
   * few milliseconds between generation and the response leaving the
   * server.
   */
  generateRefreshToken(): { raw: string; hash: string; expiresAt: Date } {
    const raw = randomBytes(48).toString('base64url');
    return {
      raw,
      hash: this.hashRefreshToken(raw),
      expiresAt: new Date(Date.now() + TokenService.REFRESH_TOKEN_TTL_MS),
    };
  }

  hashRefreshToken(raw: string): string {
    // SHA-256, not argon2: this input is already ~384 bits of real entropy
    // (unlike a human password), so a slow, memory-hard KDF buys nothing
    // and would make every refresh call unnecessarily expensive.
    return createHash('sha256').update(raw).digest('hex');
  }
}
