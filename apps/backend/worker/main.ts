import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from '../src/app.module';

// Background worker process. Drains the job queue (System Architecture,
// Section 06) — notifications, PDF generation, route optimization batches,
// bulk imports. Deployed as its own container, separate from the API
// process (System Architecture, BE.5). Same module graph as the API
// process, so it gets the same config validation, database/Redis
// connections, and structured logging for free.
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
}
bootstrap();
