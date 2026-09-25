import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { Env } from '../../config/env.validation';

// Structured (JSON) logs in every environment but local dev, where
// pino-pretty makes them human-readable instead. Every request gets a
// correlation id (req.id) that the global exception filter reuses in the
// error envelope, so a support conversation about "request abc123" and a
// log search for the same id are the same lookup.
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const nodeEnv = config.get('NODE_ENV', { infer: true });
        const isDev = nodeEnv === 'development';

        return {
          pinoHttp: {
            level: config.get('LOG_LEVEL', { infer: true }),
            transport: isDev
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
            redact: {
              // Never let a request/response log line leak a credential
              // (Constitution V.4/V.5's spirit — audit and observability
              // logs are not exempt from the same discipline).
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.body.password',
                'req.body.jwt_secret',
                'res.headers["set-cookie"]',
              ],
              censor: '[redacted]',
            },
            customProps: (req) => ({
              tenantId: (req as { tenantId?: string }).tenantId,
            }),
          },
        };
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
