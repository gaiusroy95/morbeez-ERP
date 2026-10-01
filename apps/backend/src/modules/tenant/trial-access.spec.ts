import { CallHandler, ExecutionContext, HttpException } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { accessOf } from './entities/tenant.entity';
import { TrialAccessInterceptor } from './trial-access.interceptor';
import { TenantService } from './tenant.service';

const day = 86_400_000;
const now = new Date('2026-10-01T10:00:00Z');
const at = (days: number) => new Date(now.getTime() + days * day);

describe('accessOf', () => {
  it('counts the days left in a trial, today included', () => {
    expect(accessOf({ trialEndsAt: at(30), subscribedUntil: null }, now)).toMatchObject({ state: 'trial', trialDaysLeft: 30 });
    expect(accessOf({ trialEndsAt: at(0.5), subscribedUntil: null }, now)).toMatchObject({ state: 'trial', trialDaysLeft: 1 });
  });

  it('ends when the trial does, unless paid', () => {
    expect(accessOf({ trialEndsAt: at(-1), subscribedUntil: null }, now).state).toBe('ended');
    expect(accessOf({ trialEndsAt: at(-1), subscribedUntil: at(-2) }, now).state).toBe('ended');
    expect(accessOf({ trialEndsAt: at(-1), subscribedUntil: at(20) }, now).state).toBe('active');
  });

  it('a business with no dates has no limit', () => {
    expect(accessOf({ trialEndsAt: null, subscribedUntil: null }, now).state).toBe('unlimited');
  });
});

describe('TrialAccessInterceptor', () => {
  const run = async (state: string, method: string, path: string, tenantId: string | null = 't1') => {
    const tenants = { access: jest.fn().mockResolvedValue({ state }) } as unknown as TenantService;
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ method, path, user: tenantId ? { tenantId } : undefined }) }),
    } as unknown as ExecutionContext;
    const next: CallHandler = { handle: () => of('handled') };
    return lastValueFrom(new TrialAccessInterceptor(tenants).intercept(context, next));
  };

  it('after the trial, reads still work and writes get a 402', async () => {
    await expect(run('ended', 'GET', '/orders')).resolves.toBe('handled');
    const err = await run('ended', 'POST', '/orders').catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(402);
  });

  it('signing out and changing a password still work', async () => {
    await expect(run('ended', 'POST', '/auth/logout')).resolves.toBe('handled');
    await expect(run('ended', 'POST', '/users/me/change-password')).resolves.toBe('handled');
  });

  it('writes are fine during a trial, when paid, and without a signed-in tenant', async () => {
    await expect(run('trial', 'POST', '/orders')).resolves.toBe('handled');
    await expect(run('active', 'PATCH', '/orders/1')).resolves.toBe('handled');
    await expect(run('ended', 'POST', '/tenants', null)).resolves.toBe('handled');
  });
});
