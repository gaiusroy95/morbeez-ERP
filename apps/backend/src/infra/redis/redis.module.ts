import { Module } from '@nestjs/common';

// Redis connection (Amazon ElastiCache) — cache, rate limits, and the
// job queue share this cluster (System Architecture, DB.5).
@Module({})
export class RedisModule {}
