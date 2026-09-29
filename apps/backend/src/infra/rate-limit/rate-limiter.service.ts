import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

export interface Limit {
  /** Most hits allowed in one window. */
  max: number;
  windowSeconds: number;
}

/**
 * Fixed-window counters for rate limits (Constitution IV.7, Security Audit
 * SA-02). Redis holds them so every API instance shares one count; while
 * Redis is unreachable the counters fall back to this process's memory —
 * weaker (per instance), but a limit that silently disappears whenever
 * Redis blips is exactly the gap this exists to close.
 */
@Injectable()
export class RateLimiterService {
  private readonly memory = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly redis: RedisService) {}

  /** Counts one hit against `key` and throws 429 once it's over the limit. */
  async consume(key: string, limit: Limit, message: string): Promise<void> {
    const { count, retryAfter } = await this.increment(key, limit.windowSeconds);
    if (count > limit.max) throw tooMany(message, retryAfter);
  }

  /** Throws 429 if `key` is already at its limit, without counting a hit. */
  async assertUnder(key: string, limit: Limit, message: string): Promise<void> {
    const { count, retryAfter } = await this.peek(key);
    if (count >= limit.max) throw tooMany(message, retryAfter);
  }

  /** Counts one hit without checking — e.g. a failed login, checked next time. */
  async record(key: string, windowSeconds: number): Promise<void> {
    await this.increment(key, windowSeconds);
  }

  async reset(key: string): Promise<void> {
    this.memory.delete(key);
    const client = this.redisReady();
    if (client) await client.del(prefixed(key)).catch(() => undefined);
  }

  private async increment(key: string, windowSeconds: number): Promise<{ count: number; retryAfter: number }> {
    const client = this.redisReady();
    if (client) {
      try {
        const k = prefixed(key);
        const [[, count], [, ttl]] = (await client.multi().incr(k).ttl(k).exec()) as [[null, number], [null, number]];
        if (ttl < 0) await client.expire(k, windowSeconds);
        return { count, retryAfter: ttl < 0 ? windowSeconds : ttl };
      } catch {
        // fall through to memory
      }
    }
    const now = Date.now();
    const entry = this.memory.get(key);
    if (!entry || entry.resetAt <= now) {
      this.memory.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      this.sweep(now);
      return { count: 1, retryAfter: windowSeconds };
    }
    entry.count += 1;
    return { count: entry.count, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }

  private async peek(key: string): Promise<{ count: number; retryAfter: number }> {
    const client = this.redisReady();
    if (client) {
      try {
        const k = prefixed(key);
        const [[, count], [, ttl]] = (await client.multi().get(k).ttl(k).exec()) as [[null, string | null], [null, number]];
        return { count: Number(count ?? 0), retryAfter: Math.max(ttl, 0) };
      } catch {
        // fall through to memory
      }
    }
    const entry = this.memory.get(key);
    if (!entry || entry.resetAt <= Date.now()) return { count: 0, retryAfter: 0 };
    return { count: entry.count, retryAfter: Math.ceil((entry.resetAt - Date.now()) / 1000) };
  }

  private redisReady() {
    const client = this.redis.getClient();
    return client?.status === 'ready' ? client : null;
  }

  /** Keeps the fallback map from growing without bound under a flood of distinct keys. */
  private sweep(now: number): void {
    if (this.memory.size < 10_000) return;
    for (const [k, v] of this.memory) if (v.resetAt <= now) this.memory.delete(k);
  }
}

const prefixed = (key: string) => `ratelimit:${key}`;

function tooMany(message: string, retryAfterSeconds: number): HttpException {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return new HttpException(`${message} Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, HttpStatus.TOO_MANY_REQUESTS);
}
