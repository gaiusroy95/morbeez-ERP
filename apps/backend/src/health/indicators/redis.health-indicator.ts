import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { RedisService } from '../../infra/redis/redis.service';

// @nestjs/terminus 10 API — see database.health-indicator.ts.
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(private readonly redis: RedisService) {
    super();
  }

  async check(key = 'redis'): Promise<HealthIndicatorResult> {
    try {
      await this.redis.isHealthy();
      return this.getStatus(key, true);
    } catch (err) {
      throw new HealthCheckError('Redis check failed', this.getStatus(key, false, { message: (err as Error).message }));
    }
  }
}
