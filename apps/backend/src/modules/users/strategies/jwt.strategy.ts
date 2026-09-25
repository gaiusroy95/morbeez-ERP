import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Env } from '../../../config/env.validation';
import { AuthContext } from '../../../common/types/auth-context';
import { AccessTokenPayload } from '../security/token.service';

// Runs on every request behind JwtAuthGuard. Its return value becomes
// request.user (Constitution IV.2: tenant identity comes from the
// verified token, never from a client-supplied field) — this is the one
// place in the whole app where a client-presented value becomes a
// trusted tenant_id.
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService<Env, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', { infer: true }),
    });
  }

  validate(payload: AccessTokenPayload): AuthContext {
    return {
      userId: payload.sub,
      tenantId: payload.tenantId,
      email: payload.email,
      roles: payload.roles,
      permissions: payload.permissions,
    };
  }
}
