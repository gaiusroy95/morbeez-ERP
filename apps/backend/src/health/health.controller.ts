import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { DatabaseHealthIndicator } from './indicators/database.health-indicator';
import { RedisHealthIndicator } from './indicators/redis.health-indicator';

// Excluded from the public OpenAPI document (Constitution IV.1 covers the
// business contract; a load balancer's health probe isn't part of it).
@ApiExcludeController()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: DatabaseHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  // Liveness: is the process itself alive. No dependency checks — a
  // struggling database should trigger readiness failures, not restart
  // the process that would otherwise recover once the database does.
  @Get()
  liveness(): { status: string } {
    return { status: 'ok' };
  }

  // Readiness: can this instance actually serve traffic right now. What a
  // load balancer / orchestrator should gate routing on.
  @Get('ready')
  @HealthCheck()
  readiness() {
    return this.health.check([
      () => this.db.check(),
      () => this.redis.check(),
    ]);
  }
}
