import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { from, Observable, switchMap } from 'rxjs';
import { Env } from '../../config/env.validation';
import { RateLimiterService } from './rate-limiter.service';

/**
 * A per-tenant request budget on every authenticated route (Constitution
 * IV.7): one tenant's runaway integration or script can't slow down
 * everyone else's dispatch hour. An interceptor rather than a guard,
 * because it has to run after JwtAuthGuard has put the tenant on the
 * request; unauthenticated routes (login, signup, refresh) carry their own
 * per-IP limits in AuthService/TenantController.
 */
@Injectable()
export class TenantRateLimitInterceptor implements NestInterceptor {
  constructor(
    private readonly limiter: RateLimiterService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const tenantId = context.switchToHttp().getRequest<{ user?: { tenantId?: string } }>().user?.tenantId;
    if (!tenantId) return next.handle();
    const max = this.config.get('TENANT_RATE_LIMIT_PER_MINUTE', { infer: true });
    return from(
      this.limiter.consume(`tenant:${tenantId}`, { max, windowSeconds: 60 }, 'Your business is sending requests faster than the service allows.'),
    ).pipe(switchMap(() => next.handle()));
  }
}
