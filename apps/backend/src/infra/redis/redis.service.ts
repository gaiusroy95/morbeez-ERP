import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Env } from '../../config/env.validation';

// One client, three jobs — cache, rate limits, and the job queue share this
// connection, matching how it's actually deployed (System Architecture,
// DB.5). Namespacing by purpose is the caller's responsibility (key
// prefixes), not this service's.
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client!: Redis;

  constructor(private readonly config: ConfigService<Env, true>) {}

  onModuleInit(): void {
    this.client = new Redis(this.config.get('REDIS_URL', { infer: true }), {
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  getClient(): Redis {
    return this.client;
  }

  async isHealthy(): Promise<boolean> {
    const pong = await this.client.ping();
    return pong === 'PONG';
  }
}
