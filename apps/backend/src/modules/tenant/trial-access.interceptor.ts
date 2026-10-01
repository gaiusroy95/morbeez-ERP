import { CallHandler, ExecutionContext, HttpException, HttpStatus, Injectable, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { from, Observable, switchMap } from 'rxjs';
import { TenantService } from './tenant.service';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Writes a business may still make once its trial has ended: leaving, and
// looking after its own sign-in. Everything else waits for a subscription.
const ALWAYS_ALLOWED = [/^\/auth\/logout$/, /^\/users\/me\/change-password$/];

/**
 * Read-only after the free trial: when a business's trial is over and
 * nothing is paid, every signed-in write is refused with 402 and the
 * reason; every read still works, so nobody is locked out of their own
 * books. An interceptor, like TenantRateLimitInterceptor, so it runs after
 * JwtAuthGuard has put the tenant on the request; unauthenticated routes
 * (login, signup) have no tenant and pass.
 */
@Injectable()
export class TrialAccessInterceptor implements NestInterceptor {
  constructor(private readonly tenants: TenantService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const tenantId = request.user?.tenantId;
    if (!tenantId || READS.has(request.method)) return next.handle();
    const path = request.path.replace(/\/+$/, '');
    if (ALWAYS_ALLOWED.some((pattern) => pattern.test(path))) return next.handle();

    return from(this.tenants.access(tenantId)).pipe(
      switchMap((access) => {
        if (access.state === 'ended') {
          throw new HttpException(
            'Your free trial has ended. Your data is safe and you can still see everything; subscribe to add or change anything again.',
            HttpStatus.PAYMENT_REQUIRED,
          );
        }
        return next.handle();
      }),
    );
  }
}
