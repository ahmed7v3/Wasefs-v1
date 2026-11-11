import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { parsePublishingKey } from "@wasfa/shared/publishing";

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
    let attempt: Awaited<ReturnType<PublishingKeyService["authenticateAttempt"]>> = { row: null, knownKeyId: null };
    try {
      if (match?.[1]) attempt = await this.keys.authenticateAttempt(match[1], now);
    } catch (error) {
      const app = error instanceof AppError ? error : new AppError(ErrorCode.UPSTREAM_UNAVAILABLE);
      this.requestLog.record(this.requestLog.entryFor(request, null, app.httpStatus, startedAt, app.code));
      throw app;
    }
    const row = attempt.row;
    const reject = (error: AppError, keyId: string | null = row?.id ?? attempt.knownKeyId): never => {
      this.requestLog.record(
        this.requestLog.entryFor(request, keyId, error.httpStatus, startedAt, error.code),
      );
      throw error;
    };

    if (row === null) {
      void reply.header("WWW-Authenticate", "Bearer");
      return reject(new AppError(ErrorCode.AUTH_REQUIRED), attempt.knownKeyId);
    }

    if (!ipAllowed(clientIp(request, this.trust), row.ipAllowList)) {
      reject(new AppError(ErrorCode.FORBIDDEN, { details: { reason: "ip_not_allowed" } }));
    }

    let rate: Awaited<ReturnType<PublishingKeyService["consumeRate"]>> = { limit: row.requestsPerMinute, remaining: 0, resetSeconds: 1, retryAfterSeconds: 1, allowed: false };
    try { rate = await this.keys.consumeRate(row, now); }
    catch (error) { reject(error instanceof AppError ? error : new AppError(ErrorCode.UPSTREAM_UNAVAILABLE)); }
    void reply.header("RateLimit-Limit", String(rate.limit));
    void reply.header("RateLimit-Remaining", String(rate.remaining));
    void reply.header("RateLimit-Reset", String(rate.resetSeconds));
    if (!rate.allowed) {
      void reply.header("Retry-After", String(rate.retryAfterSeconds));
      reject(new AppError(ErrorCode.RATE_LIMITED, { details: { retryAfter: rate.retryAfterSeconds } }));
    }

    const timestampHeader = request.headers["x-wasfa-timestamp"];
    const signatureHeader = request.headers["x-wasfa-signature"];
    const invalidSignature = () => reject(new AppError(ErrorCode.INVALID_SIGNATURE));
    if (timestampHeader !== undefined || signatureHeader !== undefined || row.requireSignature) {
      if (typeof timestampHeader !== "string" || typeof signatureHeader !== "string" || !/^[0-9]{10}$/.test(timestampHeader) || !/^v1=[0-9a-f]{64}$/.test(signatureHeader)) return invalidSignature();
      const seconds = Number(timestampHeader);
      if (Math.abs(Math.floor(startedAt / 1000) - seconds) > 300) return invalidSignature();
      const parsedSecret = parsePublishingKey(match?.[1] ?? "");
      if (!parsedSecret) return invalidSignature();
      const bodyHash = request.publishingRawBodyHash ?? createHash("sha256").digest("hex");
      const expected = createHmac("sha256", parsedSecret.secret).update(`${timestampHeader}\n${request.method}\n${request.raw.url}\n${bodyHash}`).digest();
      const given = Buffer.from(signatureHeader.slice(3), "hex");
      if (!timingSafeEqual(expected, given)) return invalidSignature();
      let replayAllowed = false;
      try { replayAllowed = await this.keys.consumeReplay(row.id, signatureHeader.slice(3)); }
      catch (error) { reject(error instanceof AppError ? error : new AppError(ErrorCode.UPSTREAM_UNAVAILABLE)); }
      if (!replayAllowed) return invalidSignature();
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

    const routeTemplate = request.routeOptions.url;
    if (request.method === "POST" && (routeTemplate === "/publishing/v1/media" || routeTemplate === "/publishing/v1/media/fetch")) {
      let media: Awaited<ReturnType<PublishingKeyService["consumeMedia"]>> = { allowed: false, retryAfter: 1 };
      try { media = await this.keys.consumeMedia(row.id, now); }
      catch (error) { reject(error instanceof AppError ? error : new AppError(ErrorCode.UPSTREAM_UNAVAILABLE)); }
      if (!media.allowed) {
        void reply.header("Retry-After", String(media.retryAfter));
        reject(new AppError(ErrorCode.RATE_LIMITED, { details: { retryAfter: media.retryAfter } }));
      }
    }
    const lease = randomUUID();
    let acquired = false;
    try { acquired = await this.keys.acquireConcurrency(row.id, lease, startedAt); }
    catch (error) { reject(error instanceof AppError ? error : new AppError(ErrorCode.UPSTREAM_UNAVAILABLE)); }
    if (!acquired) {
      void reply.header("Retry-After", "1");
      reject(new AppError(ErrorCode.RATE_LIMITED, { details: { retryAfter: 1 } }));
    }
    request.publishingLease = lease;
    request.publishingStartedAt = startedAt;
    this.keys.touchLastUsed(row, now);
    (request as unknown as Record<string, unknown>)[PUBLISHING_REQUEST_KEY] = toPrincipal(row);
    return true;
  }
}
