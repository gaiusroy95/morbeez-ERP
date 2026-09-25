import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { Env } from './config/env.validation';

// API process entrypoint. The worker process (worker/main.ts) is deployed
// separately so a slow batch job never degrades order-booking latency
// (System Architecture, BE.5).
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  // Structured logging takes over from Nest's default console logger
  // immediately — every line from here on, including framework startup
  // logs, goes through pino.
  app.useLogger(app.get(Logger));

  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.use(helmet());
  app.enableCors({
    origin: config.get('CORS_ORIGIN', { infer: true }).split(','),
    credentials: true,
  });

  // Lets the process finish in-flight requests and close database/Redis
  // connections cleanly on SIGTERM (Constitution VII — a container
  // orchestrator's stop signal should never just kill connections mid-write).
  app.enableShutdownHooks();

  if (config.get('API_DOCS_ENABLED', { infer: true })) {
    // Contract-first source of truth (Constitution IV.1). This generates
    // the document from the code as a starting point; the spec is expected
    // to diverge intentionally as the API is designed ahead of
    // implementation, not the other way around.
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Morbeez API')
        .setDescription('Morbeez ERP backend — internal and partner API')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(config.get('PORT', { infer: true }));
}
bootstrap();
