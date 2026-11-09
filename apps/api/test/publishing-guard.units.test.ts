import { randomBytes } from "node:crypto";

import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { formatPublishingKey } from "@wasfa/shared/publishing";
import { lastValueFrom, of, throwError } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import {
  derivePepper,
  generateKeyId,
  generateSecret,
  hashSecret,
} from "../src/publishing/publishing-key-crypto.js";
import { PublishingKeyGuard } from "../src/publishing/publishing-key.guard.js";
import { PublishingKeyService } from "../src/publishing/publishing-key.service.js";
import { PUBLISHING_REQUEST_KEY } from "../src/publishing/publishing-principal.js";
import {
  PublishingRequestLogInterceptor,
  PublishingRequestLogger,
} from "../src/publishing/publishing-request-log.js";

import type { ApiEnv } from "../src/config/env.js";
import type { RequestLogEntry } from "../src/publishing/publishing-keys.repo.js";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import type { PublishingApiKeyRow } from "@wasfa/db";

const ENCRYPTION_KEY = randomBytes(32);
const env = {
  ENCRYPTION_KEY: ENCRYPTION_KEY.toString("base64"),
  TRUST_PROXY: [],
} as unknown as ApiEnv;
const PEPPER = derivePepper(ENCRYPTION_KEY);
const NOW = Date.now();

function makeRow(overrides: Partial<PublishingApiKeyRow> = {}) {
  const keyId = generateKeyId();
  const secret = generateSecret();
  const row: PublishingApiKeyRow = {
    id: "00000000-0000-7000-8000-000000000001",
    keyId,
    environment: "live",
    secretHash: hashSecret(PEPPER, secret),
    prevSecretHash: null,
    prevValidUntil: null,
    last4: secret.slice(-4),
    name: "agent",
    ownerUserId: "00000000-0000-7000-8000-000000000002",
    scopes: ["content:write"],
    canPublish: false,
    allowedTypes: [],
    allowedCategorySlugs: [],
    defaultAuthorId: null,
    defaultFeaturedMediaId: null,
    dailyPublishCap: null,
    requestsPerMinute: 2,
    ipAllowList: [],
    createdAt: new Date(NOW - 1000),
    expiresAt: new Date(NOW + 86_400_000),
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  };
  return { row, raw: formatPublishingKey("live", keyId, secret) };
}

function setup(row: PublishingApiKeyRow | undefined, scopes: string[] = ["content:write"]) {
  const counts = new Map<string, number>();
  const redis = {
    incr: vi.fn((key: string) => {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return Promise.resolve(counts.get(key));
    }),
    expire: vi.fn(() => Promise.resolve(1)),
  };
  const repo = {
    findByKeyId: vi.fn((keyId: string) => Promise.resolve(row?.keyId === keyId ? row : undefined)),
    touchLastUsed: vi.fn(() => Promise.resolve()),
    insertRequest: vi.fn<(entry: RequestLogEntry) => Promise<void>>(() => Promise.resolve()),
  };
  const logger = { setContext: vi.fn(), warn: vi.fn() };
  const bus = { on: vi.fn(), publish: vi.fn(() => Promise.resolve()) };
  const keys = new PublishingKeyService(
    repo as never,
    redis as never,
    bus as never,
    logger as never,
    env,
  );
  const requestLog = new PublishingRequestLogger(repo as never, logger as never);
  const reflector = { getAllAndOverride: () => scopes };
  const guard = new PublishingKeyGuard(reflector as never, keys, requestLog, env);
  return { guard, repo, redis, requestLog };
}

function context(authorization: string | undefined, ip = "203.0.113.9") {
  const headers: Record<string, string> = {};
  const responseHeaders: Record<string, string> = {};
  const request: Record<string, unknown> = {
    headers: { ...(authorization === undefined ? {} : { authorization }), ...headers },
    method: "POST",
    routeOptions: { url: "/publishing/v1/articles/:id/publish" },
    socket: { remoteAddress: ip },
    ip,
  };
  const reply = {
    statusCode: 200,
    header: (name: string, value: string) => {
      responseHeaders[name] = value;
      return reply;
    },
  };
  const ctx = {
    getType: () => "http",
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
  } as unknown as ExecutionContext;
  return { ctx, request, reply, responseHeaders };
}

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    return error as AppError;
  }
  throw new Error("expected a rejection");
}

describe("PublishingKeyGuard authentication", () => {
  it("answers every credential problem with the same 401", async () => {
    const good = makeRow();
    const revoked = makeRow({ revokedAt: new Date(NOW - 1) });
    const expired = makeRow({ expiresAt: new Date(NOW - 1) });
    const wrongSecret = formatPublishingKey("live", good.row.keyId, generateSecret());
    const wrongEnvironment = formatPublishingKey("test", good.row.keyId, "x".repeat(48));
    const unknown = formatPublishingKey("live", generateKeyId(), generateSecret());

    const cases: { row: PublishingApiKeyRow; header: string | undefined }[] = [
      { row: good.row, header: undefined },
      { row: good.row, header: "Basic abc" },
      { row: good.row, header: "Bearer not-a-key" },
      { row: good.row, header: `Bearer ${unknown}` },
      { row: good.row, header: `Bearer ${wrongSecret}` },
      { row: good.row, header: `Bearer ${wrongEnvironment}` },
      { row: revoked.row, header: `Bearer ${revoked.raw}` },
      { row: expired.row, header: `Bearer ${expired.raw}` },
    ];
    const bodies = new Set<string>();
    for (const entry of cases) {
      const { guard } = setup(entry.row);
      const { ctx } = context(entry.header);
      const error = await rejection(guard.canActivate(ctx));
      expect(error.code).toBe(ErrorCode.AUTH_REQUIRED);
      expect(error.httpStatus).toBe(401);
      bodies.add(
        JSON.stringify({ code: error.code, status: error.httpStatus, details: error.details }),
      );
    }
    expect(bodies.size).toBe(1);
  });

  it("attaches the principal on success and throttles last_used_at", async () => {
    const { row, raw } = makeRow();
    const { guard, repo } = setup(row);
    const first = context(`Bearer ${raw}`);
    await expect(guard.canActivate(first.ctx)).resolves.toBe(true);
    expect(first.request[PUBLISHING_REQUEST_KEY]).toMatchObject({
      keyId: row.id,
      keyName: "agent",
      ownerUserId: row.ownerUserId,
      scopes: ["content:write"],
      canPublish: false,
      requestsPerMinute: 2,
    });
    expect(first.responseHeaders["RateLimit-Limit"]).toBe("2");
    expect(first.responseHeaders["RateLimit-Remaining"]).toBe("1");
    expect(Number(first.responseHeaders["RateLimit-Reset"])).toBeGreaterThan(0);
    await guard.canActivate(context(`Bearer ${raw}`).ctx);
    expect(repo.touchLastUsed).toHaveBeenCalledTimes(1);
  });

  it("accepts the previous secret during a rotation grace and refuses it afterwards", async () => {
    const oldSecret = generateSecret();
    const keyId = generateKeyId();
    const base = makeRow({
      keyId,
      prevSecretHash: hashSecret(PEPPER, oldSecret),
      prevValidUntil: new Date(NOW + 3_600_000),
    });
    const { guard } = setup(base.row);
    await expect(
      guard.canActivate(context(`Bearer ${formatPublishingKey("live", keyId, oldSecret)}`).ctx),
    ).resolves.toBe(true);
    const lapsed = makeRow({
      keyId,
      prevSecretHash: hashSecret(PEPPER, oldSecret),
      prevValidUntil: new Date(NOW - 1),
    });
    const { guard: lapsedGuard } = setup(lapsed.row);
    const error = await rejection(
      lapsedGuard.canActivate(
        context(`Bearer ${formatPublishingKey("live", keyId, oldSecret)}`).ctx,
      ),
    );
    expect(error.code).toBe(ErrorCode.AUTH_REQUIRED);
  });
});

describe("PublishingKeyGuard authorisation and limits", () => {
  it("answers 403 SCOPE_REQUIRED with the missing scopes", async () => {
    const { row, raw } = makeRow();
    const { guard, repo } = setup(row, ["content:write", "content:publish"]);
    const error = await rejection(guard.canActivate(context(`Bearer ${raw}`).ctx));
    expect(error.code).toBe(ErrorCode.SCOPE_REQUIRED);
    expect(error.httpStatus).toBe(403);
    expect(error.details).toEqual({ required: ["content:publish"] });
    expect(repo.insertRequest).toHaveBeenCalledWith(
      expect.objectContaining({ status: 403, errorCode: "SCOPE_REQUIRED" }),
    );
  });

  it("answers 403 FORBIDDEN when the client IP is not on the allow-list", async () => {
    const { row, raw } = makeRow({ ipAllowList: ["198.51.100.0/24"] });
    const { guard } = setup(row);
    const error = await rejection(guard.canActivate(context(`Bearer ${raw}`, "203.0.113.9").ctx));
    expect(error.code).toBe(ErrorCode.FORBIDDEN);
    await expect(guard.canActivate(context(`Bearer ${raw}`, "198.51.100.77").ctx)).resolves.toBe(
      true,
    );
  });

  it("answers 429 with RateLimit and Retry-After headers once the window is used up", async () => {
    const { row, raw } = makeRow();
    const { guard } = setup(row);
    await guard.canActivate(context(`Bearer ${raw}`).ctx);
    await guard.canActivate(context(`Bearer ${raw}`).ctx);
    const third = context(`Bearer ${raw}`);
    const error = await rejection(guard.canActivate(third.ctx));
    expect(error.code).toBe(ErrorCode.RATE_LIMITED);
    expect(error.httpStatus).toBe(429);
    expect(third.responseHeaders["RateLimit-Limit"]).toBe("2");
    expect(third.responseHeaders["RateLimit-Remaining"]).toBe("0");
    expect(Number(third.responseHeaders["Retry-After"])).toBeGreaterThan(0);
  });

  it("fails open when Redis is down", async () => {
    const { row, raw } = makeRow();
    const { guard, redis } = setup(row);
    redis.incr.mockRejectedValueOnce(new Error("down"));
    await expect(guard.canActivate(context(`Bearer ${raw}`).ctx)).resolves.toBe(true);
  });
});

describe("PublishingRequestLogInterceptor", () => {
  function run(
    handler: CallHandler,
    options: { url?: string; headers?: Record<string, string>; itemId?: string } = {},
  ) {
    const { row } = makeRow();
    const { requestLog, repo } = setup(row);
    const { ctx, request, reply } = context(undefined);
    request.url = options.url ?? "/publishing/v1/articles/abc123?secret=1";
    request.headers = options.headers ?? {};
    request.body = { body_markdown: "private article text" };
    request.publishingItemId = options.itemId;
    request[PUBLISHING_REQUEST_KEY] = { keyId: row.id };
    reply.statusCode = 201;
    const interceptor = new PublishingRequestLogInterceptor(requestLog);
    return { result: lastValueFrom(interceptor.intercept(ctx, handler)), repo };
  }

  it("records the route template, never the URL, and no body", async () => {
    const { result, repo } = run(
      { handle: () => of("ok") },
      { headers: { "idempotency-key": "cover-1" }, itemId: "cnt_1" },
    );
    await result;
    expect(repo.insertRequest).toHaveBeenCalledTimes(1);
    const entry = repo.insertRequest.mock.calls[0]?.[0] as RequestLogEntry;
    expect(entry).toMatchObject({
      method: "POST",
      route: "/publishing/v1/articles/:id/publish",
      status: 201,
      errorCode: null,
      itemId: "cnt_1",
      idempotencyKey: "cover-1",
    });
    const text = JSON.stringify(entry);
    expect(text).not.toContain("abc123");
    expect(text).not.toContain("secret=1");
    expect(text).not.toContain("private article text");
  });

  it("records the status and error code of a failing handler and rethrows", async () => {
    const { result, repo } = run({
      handle: () => throwError(() => new AppError(ErrorCode.NOT_FOUND)),
    });
    await expect(result).rejects.toBeInstanceOf(AppError);
    expect(repo.insertRequest).toHaveBeenCalledWith(
      expect.objectContaining({ status: 404, errorCode: "NOT_FOUND" }),
    );
  });

  it("never fails the response when the log write fails", async () => {
    const { row } = makeRow();
    const { requestLog, repo } = setup(row);
    repo.insertRequest.mockRejectedValueOnce(new Error("db down"));
    const { ctx, request } = context(undefined);
    request[PUBLISHING_REQUEST_KEY] = { keyId: row.id };
    const interceptor = new PublishingRequestLogInterceptor(requestLog);
    await expect(
      lastValueFrom(interceptor.intercept(ctx, { handle: () => of("fine") })),
    ).resolves.toBe("fine");
  });
});
