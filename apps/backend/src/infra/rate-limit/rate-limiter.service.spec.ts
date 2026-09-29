import { HttpException } from '@nestjs/common';
import { RateLimiterService } from './rate-limiter.service';
import { RedisService } from '../redis/redis.service';

// Redis down (status not 'ready'): the counters must still work, in memory
// (Security Audit SA-02) — a limit that disappears with Redis is no limit.
describe('RateLimiterService without Redis', () => {
  const redis = { getClient: () => ({ status: 'reconnecting' }) } as unknown as RedisService;
  let limiter: RateLimiterService;
  beforeEach(() => (limiter = new RateLimiterService(redis)));

  it('consume allows up to the limit, then answers 429 with when to retry', async () => {
    for (let i = 0; i < 3; i++) await limiter.consume('k', { max: 3, windowSeconds: 600 }, 'Slow down.');
    const err = await limiter.consume('k', { max: 3, windowSeconds: 600 }, 'Slow down.').catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    expect((err as HttpException).message).toBe('Slow down. Try again in 10 minutes.');
  });

  it('record counts without refusing; assertUnder refuses once the count reaches the limit; reset clears it', async () => {
    const limit = { max: 2, windowSeconds: 60 };
    await limiter.assertUnder('fails', limit, 'Locked.');
    await limiter.record('fails', 60);
    await limiter.record('fails', 60);
    await expect(limiter.assertUnder('fails', limit, 'Locked.')).rejects.toBeInstanceOf(HttpException);
    await limiter.reset('fails');
    await expect(limiter.assertUnder('fails', limit, 'Locked.')).resolves.toBeUndefined();
  });

  it('keys are counted separately', async () => {
    await limiter.consume('a', { max: 1, windowSeconds: 60 }, 'x');
    await expect(limiter.consume('b', { max: 1, windowSeconds: 60 }, 'x')).resolves.toBeUndefined();
  });

  it('a window that has passed starts again', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await limiter.consume('w', { max: 1, windowSeconds: 60 }, 'x');
    now.mockReturnValue(1_000_000 + 61_000);
    await expect(limiter.consume('w', { max: 1, windowSeconds: 60 }, 'x')).resolves.toBeUndefined();
    now.mockRestore();
  });
});
