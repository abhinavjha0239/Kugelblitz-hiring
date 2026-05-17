import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';

/**
 * Global exception filter with production-safe behavior:
 *
 *   1. Stack traces are logged ONLY for 5xx errors. 4xx exceptions are
 *      expected (validation, auth, scope rejection) — log them at warn level
 *      with status + path + message; no stack noise.
 *
 *   2. The `errors` payload is forwarded to the client only when it looks
 *      like a class-validator error array (BadRequestException with
 *      `errors`/`message` array). Anything else gets dropped — TypeORM
 *      QueryFailedError, raw DB error fields, internal stack details
 *      never reach the client.
 *
 *   3. 5xx responses include a stable `errorId` (UUID). The same id is
 *      logged alongside the stack so an operator can grep server logs
 *      from a single client-side complaint.
 *
 *   4. Non-`HttpException` errors and TypeORM errors are coerced to a
 *      generic `Internal server error` client-side. Server logs still get
 *      the original message + stack.
 */

const TYPEORM_ERROR_NAMES = new Set<string>([
  'QueryFailedError',
  'EntityNotFoundError',
  'EntityPropertyNotFoundError',
  'EntityColumnNotFound',
  'TypeORMError',
  'ConnectionNotFoundError',
  'CannotExecuteNotConnectedError',
]);

function isValidationErrorPayload(errors: unknown): boolean {
  // class-validator emits an array of strings via NestJS ValidationPipe.
  return Array.isArray(errors) && errors.every((e) => typeof e === 'string');
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const inProd = process.env.NODE_ENV === 'production';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let clientMessage = 'Internal server error';
    let clientErrors: any = null;
    let serverLogMessage = '';
    let serverLogStack: string | undefined;
    const errorId = randomUUID();

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exResponse = exception.getResponse();
      if (typeof exResponse === 'string') {
        clientMessage = exResponse;
      } else if (exResponse && typeof exResponse === 'object') {
        const obj = exResponse as Record<string, any>;
        // class-validator passes its findings as `message: string[]`. We
        // surface those as `errors` for the client and a short message.
        if (Array.isArray(obj.message)) {
          clientErrors = obj.message;
          clientMessage = 'Validation failed';
        } else {
          clientMessage = obj.message || clientMessage;
        }
        // Pass `errors` only if it's the validation-error shape; never
        // forward arbitrary nested objects (could carry DB internals).
        if (obj.errors !== undefined) {
          clientErrors = isValidationErrorPayload(obj.errors) ? obj.errors : clientErrors;
        }
      }
      serverLogMessage = `${status} ${req.method} ${req.originalUrl} :: ${clientMessage}`;
    } else if (exception instanceof Error) {
      // Unknown / non-HTTP error. Don't leak the message to the client in
      // production — the message often contains DB column names or paths.
      const errName = exception.constructor.name;
      const isTypeOrm = TYPEORM_ERROR_NAMES.has(errName);
      serverLogMessage = `${status} ${req.method} ${req.originalUrl} :: ${errName}: ${exception.message}`;
      serverLogStack = exception.stack;
      if (!inProd && !isTypeOrm) {
        // Dev — show the message so we can debug.
        clientMessage = exception.message || clientMessage;
      }
      // Prod and TypeORM errors fall through with the generic message.
    } else {
      serverLogMessage = `${status} ${req.method} ${req.originalUrl} :: non-Error thrown: ${String(exception)}`;
    }

    // Log gating: 5xx gets stack at error level; 4xx gets one warn line.
    if (status >= 500) {
      this.logger.error(`[errorId=${errorId}] ${serverLogMessage}`, serverLogStack);
    } else if (status >= 400) {
      this.logger.warn(`${serverLogMessage}`);
    }

    const body: Record<string, any> = {
      success: false,
      statusCode: status,
      message: clientMessage,
      errors: clientErrors,
      timestamp: new Date().toISOString(),
    };
    // Surface errorId for 5xx so users can quote it in support tickets.
    if (status >= 500) body.errorId = errorId;

    response.status(status).json(body);
  }
}
