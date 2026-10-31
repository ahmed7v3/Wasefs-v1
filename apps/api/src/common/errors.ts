import { createHash } from "node:crypto";

import {
  Catch,
  HttpException,
  Inject,
  Injectable,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { errorEvents } from "@wasfa/db";
import { AppError, ErrorCode, isAppError, type ErrorLocale } from "@wasfa/shared/errors";
import { newErrorRef } from "@wasfa/shared/ids";
import { redactText } from "@wasfa/shared/redact";
import { PinoLogger } from "nestjs-pino";

import { DB, type DbHandle } from "./database.js";

import type { FastifyReply, FastifyRequest } from "fastify";

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  401: ErrorCode.AUTH_REQUIRED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  429: ErrorCode.RATE_LIMITED,
};

function statusOf(error: unknown): number | undefined {
  if (error instanceof HttpException) return error.getStatus();
  // Fastify's own errors (body too large, bad JSON, unsupported media type) carry `statusCode`.
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === "number" ? status : undefined;
}

/** Maps anything thrown to an `AppError`; returns `undefined` for unexpected (5xx) errors. */
export function toAppError(error: unknown): AppError | undefined {
  if (isAppError(error)) return error;
  const status = statusOf(error);
  if (status === undefined || status >= 500) return undefined;
  const code = STATUS_TO_CODE[status] ?? ErrorCode.VALIDATION_FAILED;
  return new AppError(code, { httpStatus: status, cause: error });
}

export function requestLocale(request: FastifyRequest): ErrorLocale {
  const header = request.headers["accept-language"];
  return typeof header === "string" && /^en\b/i.test(header.trim()) ? "en" : "ar";
}

function routeOf(request: FastifyRequest): string {
  // The route pattern (`/users/:id`), not the raw URL, so ids and query strings are not stored.
  return request.routeOptions.url ?? "(unmatched)";
}

/** Persists unexpected errors to `error_events` under a user-visible `WSF-XXXX-XXXX` ref. */
@Injectable()
export class ErrorReporter {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("ErrorReporter");
  }

  async report(error: unknown, request: FastifyRequest, code: ErrorCode): Promise<string> {
    return this.record(error, {
      route: routeOf(request),
      method: request.method,
      requestId: String(request.id),
      code,
    });
  }

  /** The same row for a failure that has no HTTP request (a queue job, a WhatsApp turn). */
  async record(
    error: unknown,
    meta: {
      route: string;
      method: string;
      requestId: string;
      code: string;
      userId?: string | undefined;
      context?: Record<string, unknown>;
    },
  ): Promise<string> {
    const ref = newErrorRef();
    const err = error instanceof Error ? error : new Error("Non-Error value thrown");
    const { route } = meta;
    const stack = err.stack ? redactText(err.stack) : null;
    const firstFrame = err.stack?.split("\n").find((line) => line.trim().startsWith("at ")) ?? "";
    const fingerprint = createHash("sha256")
      .update(`${err.name}|${meta.method}|${route}|${firstFrame.trim()}`)
      .digest("hex")
      .slice(0, 32);
    const row = {
      ref,
      fingerprint,
      code: meta.code,
      route,
      method: meta.method,
      userId: meta.userId ?? null,
      requestId: meta.requestId,
      message: redactText(err.message).slice(0, 2_000),
      context: {
        errorName: err.name,
        appCode: isAppError(err) ? err.code : null,
        ...meta.context,
      },
      stack: stack?.slice(0, 16_000) ?? null,
    };
    this.logger.error(
      { ref, fingerprint, route, err: { name: err.name, message: row.message } },
      "Unexpected error",
    );
    try {
      await this.handle.db.insert(errorEvents).values(row);
    } catch (dbError) {
      // Never let reporting failure mask the original error; the log line above still has the ref.
      this.logger.error(
        { ref, dbError: dbError instanceof Error ? dbError.message : "unknown" },
        "Failed to store error event",
      );
    }
    return ref;
  }
}

/**
 * The maintenance 503 is an answer, not a failure: reporting it would write an `error_events` row
 * (and a log line with a ref) for every request while the site is in maintenance.
 */
function isExpected(error: AppError): boolean {
  return error.httpStatus < 500 || error.details?.["reason"] === "maintenance";
}

/** Single place that turns any error into the client-safe `{ code, message, details?, ref? }`. */
export async function sendError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
  reporter: ErrorReporter,
): Promise<void> {
  const locale = requestLocale(request);
  const known = toAppError(error);
  if (known && isExpected(known)) {
    await reply.status(known.httpStatus).send(known.toResponse(locale));
    return;
  }
  const appError = known ?? new AppError(ErrorCode.INTERNAL, { cause: error });
  const ref = await reporter.report(error, request, appError.code);
  await reply.status(appError.httpStatus).send(appError.toResponse(locale, ref));
}

@Catch()
@Injectable()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly reporter: ErrorReporter) {}

  async catch(error: unknown, host: ArgumentsHost): Promise<void> {
    const http = host.switchToHttp();
    await sendError(
      error,
      http.getRequest<FastifyRequest>(),
      http.getResponse<FastifyReply>(),
      this.reporter,
    );
  }
}
