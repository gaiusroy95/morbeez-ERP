import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';

// Background worker process. Drains the job queue (System Architecture,
// Section 06) — notifications, PDF generation, route optimization batches,
// bulk imports. Deployed as its own container, separate from the API
// process (System Architecture, BE.5).
async function bootstrap() {
  await NestFactory.createApplicationContext(AppModule);
}
bootstrap();
