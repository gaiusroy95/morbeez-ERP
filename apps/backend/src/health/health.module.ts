import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { DatabaseHealthIndicator } from './indicators/database.health-indicator';
import { RedisHealthIndicator } from './indicators/redis.health-indicator';

// Infrastructure, not a bounded context — deliberately not under
// src/modules/, which is reserved for the 14 contexts in the Domain Model.
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [DatabaseHealthIndicator, RedisHealthIndicator],
})
export class HealthModule {}
