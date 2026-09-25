import { Injectable } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { DatabaseService } from '../../infra/database/database.service';

@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    private readonly db: DatabaseService,
    private readonly indicatorService: HealthIndicatorService,
  ) {}

  async check(key = 'database'): Promise<HealthIndicatorResult> {
    const indicator = this.indicatorService.check(key);
    try {
      await this.db.isHealthy();
      return indicator.up();
    } catch (err) {
      return indicator.down({ message: (err as Error).message });
    }
  }
}
