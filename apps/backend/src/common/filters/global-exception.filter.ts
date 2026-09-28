import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { buildErrorEnvelope } from './error-envelope';

// Every unhandled error in the app passes through here exactly once. The
// client gets the sanitized envelope (Constitution IV.6); the full error —
// stack trace included — goes to the structured logger, correlated by the
// same request id, so nothing observable to a client is ever the only copy
// of the diagnostic information.
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(GlobalExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { id?: string }>();
    const requestId = request.id ?? 'unknown';

    const { status, code, message, details } = this.classify(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error({ err: exception, requestId }, 'Unhandled exception');
    } else {
      this.logger.warn({ err: exception, requestId }, message);
    }

    response
      .status(status)
      .json(buildErrorEnvelope(code, message, requestId, details));
  }

  private classify(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message ??
            exception.message);

      return {
        status,
        code: HttpStatus[status] ?? 'HTTP_ERROR',
        message: Array.isArray(message) ? message.join('; ') : message,
        details: Array.isArray(message) ? { validation: message } : undefined,
      };
    }

    // The ledger's period lock (money.assert_period_open, SQLSTATE MZ001):
    // whichever module's posting ran into a closed period, the person gets
    // the database's own explanation, not a 500.
    if (isPgError(exception) && exception.code === 'MZ001') {
      return { status: HttpStatus.CONFLICT, code: 'PERIOD_CLOSED', message: exception.message };
    }

    // An error we didn't anticipate is exactly the case Constitution IV.6
    // exists for — the client still gets a stable, opaque shape.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    };
  }
}

function isPgError(value: unknown): value is { code: string; message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}
