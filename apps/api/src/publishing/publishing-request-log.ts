import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { catchError, finalize, tap, throwError, type Observable } from "rxjs";

import { toAppError } from "../common/errors.js";

import { PublishingKeyService } from "./publishing-key.service.js";
import { PublishingKeysRepo, type RequestLogEntry } from "./publishing-keys.repo.js";
import { PUBLISHING_REQUEST_KEY, type PublishingPrincipal } from "./publishing-principal.js";

import type { FastifyReply, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by a Publishing API handler that created or touched one item; goes into the request log. */
    publishingItemId?: string;
    publishingLease?: string;
    publishingStartedAt?: number;
  }
}

/**
 * Appends to `publishing_api_requests` (docs section 10): method, route TEMPLATE (never the URL: ids and
 * query strings stay out), status, latency, error code, item id, idempotency key. Never bodies.
 * Fire and forget: a failing insert is logged and swallowed, the response is never affected.
 */
@Injectable()
export class PublishingRequestLogger {
  constructor(
    private readonly repo: PublishingKeysRepo,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("PublishingRequestLog");
  }

  record(entry: RequestLogEntry): void {
    this.repo.insertRequest(entry).catch((error: unknown) => {
      this.logger.warn({ errorClass: error instanceof Error ? error.name : "unknown" }, "Publishing request log write failed");
    });
  }

  /** Builds the entry from the live request; guard rejections (403/429) use it directly too. */
  entryFor(
    request: FastifyRequest,
    keyId: string | null,
    status: number,
    startedAt: number,
    errorCode: string | null,
  ): RequestLogEntry {
    const idempotency = request.headers["idempotency-key"];
    return {
      keyId,
      method: request.method,
      route: request.routeOptions.url ?? "(unmatched)",
      status,
      latencyMs: Math.max(0, Date.now() - startedAt),
      errorCode,
      itemId: request.publishingItemId ?? null,
      idempotencyKey: typeof idempotency === "string" ? idempotency.slice(0, 128) : null,
    };
  }
}

/**
 * Covers every route that uses `@PublishingAuth()` (the decorator attaches it). Guard rejections never
 * reach an interceptor, so the guard records those itself through `PublishingRequestLogger`.
 */
@Injectable()
export class PublishingRequestLogInterceptor implements NestInterceptor {
  constructor(private readonly log: PublishingRequestLogger, private readonly keys: PublishingKeyService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const principal = (request as unknown as Record<string, PublishingPrincipal | undefined>)[
      PUBLISHING_REQUEST_KEY
    ];
    if (!principal) return next.handle();
    const startedAt = request.publishingStartedAt ?? Date.now();
    const leaseToken = request.publishingLease;
    const leaseTimer = leaseToken
      ? setInterval(() => void this.keys.renewConcurrency(principal.keyId, leaseToken, Date.now()), 60_000)
      : undefined;
    return next.handle().pipe(
      tap(() => {
        this.log.record(
          this.log.entryFor(request, principal.keyId, reply.statusCode, startedAt, null),
        );
      }),
      catchError((error: unknown) => {
        const app = toAppError(error);
        this.log.record(
          this.log.entryFor(
            request,
            principal.keyId,
            app?.httpStatus ?? 500,
            startedAt,
            app?.code ?? null,
          ),
        );
        return throwError(() => error);
      }),
      finalize(() => {
        if (leaseTimer) clearInterval(leaseTimer);
        if (leaseToken) void this.keys.releaseConcurrency(principal.keyId, leaseToken);
      }),
    );
  }
}
