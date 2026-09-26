import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { DatabaseService } from '../../infra/database/database.service';

// @nestjs/terminus 10 API (the project is on Nest 10): extend
// HealthIndicator and throw HealthCheckError to report "down".
@Injectable()
export class DatabaseHealthIndicator extends HealthIndicator {
  constructor(private readonly db: DatabaseService) {
    super();
  }

  async check(key = 'database'): Promise<HealthIndicatorResult> {
    try {
      await this.db.isHealthy();
      return this.getStatus(key, true);
    } catch (err) {
      throw new HealthCheckError('Database check failed', this.getStatus(key, false, { message: (err as Error).message }));
    }
  }
}
