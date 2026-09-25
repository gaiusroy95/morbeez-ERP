import { Injectable } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { RedisService } from '../../infra/redis/redis.service';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly redis: RedisService,
    private readonly indicatorService: HealthIndicatorService,
  ) {}

  async check(key = 'redis'): Promise<HealthIndicatorResult> {
    const indicator = this.indicatorService.check(key);
    try {
      await this.redis.isHealthy();
      return indicator.up();
    } catch (err) {
      return indicator.down({ message: (err as Error).message });
    }
  }
}
