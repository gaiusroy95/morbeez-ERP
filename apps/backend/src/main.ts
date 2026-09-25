import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// API process entrypoint. The worker process (worker/main.ts) is deployed
// separately so a slow batch job never degrades order-booking latency
// (System Architecture, BE.5).
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
