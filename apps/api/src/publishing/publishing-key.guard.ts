import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { clientIp, compileTrust, type TrustFn } from "../common/client-ip.js";
import { API_ENV } from "../config/config.module.js";

import { ipAllowed } from "./publishing-ip.js";
import { PublishingKeyService, toPrincipal } from "./publishing-key.service.js";
import { PUBLISHING_REQUEST_KEY, PUBLISHING_SCOPES_KEY } from "./publishing-principal.js";
import { PublishingRequestLogger } from "./publishing-request-log.js";

import type { ApiEnv } from "../config/env.js";
import type { PublishingScope } from "@wasfa/shared/publishing";
import type { FastifyReply, FastifyRequest } from "fastify";

const BEARER = /^Bearer\s+(\S+)$/i;

/**
 * Authenticates a Publishing API call (docs/PUBLISHING-API.md section 3): Bearer key, IP allow-list,
 * per-key rate limit, scopes. A missing, malformed, unknown, wrong, revoked or expired key all get the
 * same `401 AUTH_REQUIRED` (no oracle on which part was wrong). Maintenance mode needs no code here:
 * the global `MaintenanceGuard` already answers 503 to every route that is not allow-listed.
 */
@Injectable()
export class PublishingKeyGuard implements CanActivate {
  private readonly trust: TrustFn;

  constructor(
    private readonly reflector: Reflector,
    private readonly keys: PublishingKeyService,
    private readonly requestLog: PublishingRequestLogger,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    this.trust = compileTrust(env.TRUST_PROXY);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const startedAt = Date.now();
    const now = new Date(startedAt);

    const header = request.headers.authorization;
    const match = typeof header === "string" ? BEARER.exec(header) : null;
    const row = match?.[1] ? await this.keys.authenticate(match[1], now) : null;
    if (!row) {
      void reply.header("WWW-Authenticate", "Bearer");
      throw new AppError(ErrorCode.AUTH_REQUIRED);
    }

    const reject = (error: AppError): never => {
      this.requestLog.record(
        this.requestLog.entryFor(request, row.id, error.httpStatus, startedAt, error.code),
      );
      throw error;
    };

    if (!ipAllowed(clientIp(request, this.trust), row.ipAllowList)) {
      reject(new AppError(ErrorCode.FORBIDDEN, { details: { reason: "ip_not_allowed" } }));
    }

    const rate = await this.keys.consumeRate(row, now);
    void reply.header("RateLimit-Limit", String(rate.limit));
    void reply.header("RateLimit-Remaining", String(rate.remaining));
    void reply.header("RateLimit-Reset", String(rate.resetSeconds));
    if (!rate.allowed) {
      void reply.header("Retry-After", String(rate.resetSeconds));
      reject(new AppError(ErrorCode.RATE_LIMITED, { details: { retryAfter: rate.resetSeconds } }));
    }

    const required =
      this.reflector.getAllAndOverride<PublishingScope[] | undefined>(PUBLISHING_SCOPES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const missing = required.filter((scope) => !row.scopes.includes(scope));
    if (missing.length > 0) {
      reject(new AppError(ErrorCode.SCOPE_REQUIRED, { details: { required: missing } }));
    }

    this.keys.touchLastUsed(row, now);
    (request as unknown as Record<string, unknown>)[PUBLISHING_REQUEST_KEY] = toPrincipal(row);
    return true;
  }
}
