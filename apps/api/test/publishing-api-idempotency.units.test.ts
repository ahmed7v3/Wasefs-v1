import { ErrorCode } from "@wasfa/shared/errors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  IDEMPOTENCY_TTL_MS,
  PublishingIdempotencyService,
  canonicalJson,
  parseIdempotencyKey,
  requestHash,
} from "../src/publishing/publishing-api-idempotency.js";

import type { PublishingApiRepo } from "../src/publishing/publishing-api.repo.js";

/** An in-memory stand-in for the idempotency table with the real repo's claim and expiry semantics. */
function memoryRepo() {
  const rows = new Map<
    string,
    { hash: string; status: number | null; response: unknown; at: Date }
  >();
  const id = (keyId: string, key: string) => `${keyId}|${key}`;
  return {
    rows,
    claimIdempotency: vi.fn((keyId: string, key: string, hash: string, now: Date, cutoff: Date) => {
      const existing = rows.get(id(keyId, key));
      if (existing && existing.at < cutoff) rows.delete(id(keyId, key));
      if (rows.has(id(keyId, key))) return Promise.resolve(false);
      rows.set(id(keyId, key), { hash, status: null, response: null, at: now });
      return Promise.resolve(true);
    }),
    findIdempotency: vi.fn((keyId: string, key: string) => {
      const row = rows.get(id(keyId, key));
      return Promise.resolve(
        row ? { requestHash: row.hash, status: row.status, response: row.response } : undefined,
      );
    }),
    completeIdempotency: vi.fn((keyId: string, key: string, status: number, response: unknown) => {
      const row = rows.get(id(keyId, key));
      if (row) Object.assign(row, { status, response });
      return Promise.resolve();
    }),
    releaseIdempotency: vi.fn((keyId: string, key: string) => {
      rows.delete(id(keyId, key));
      return Promise.resolve();
    }),
  };
}

const KEY = "018f0000-0000-7000-8000-0000000000aa";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-09T10:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const repo = memoryRepo();
  return { repo, service: new PublishingIdempotencyService(repo as unknown as PublishingApiRepo) };
}

describe("PublishingIdempotencyService", () => {
  it("the same key and body replays the stored answer without running the handler again", async () => {
    const { service } = setup();
    const handler = vi.fn(() => Promise.resolve({ status: 201, body: { id: "a" } }));
    const hash = requestHash("POST", "/articles", { title: "x" });
    const first = await service.run(KEY, "create-0001", hash, handler);
    const second = await service.run(KEY, "create-0001", hash, handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ status: 201, body: { id: "a" }, replayed: false });
    expect(second).toEqual({ status: 201, body: { id: "a" }, replayed: true });
  });

  it("the same key with a different body is IDEMPOTENCY_MISMATCH (409) and runs nothing", async () => {
    const { service } = setup();
    const handler = vi.fn(() => Promise.resolve({ status: 201, body: {} }));
    await service.run(KEY, "create-0001", requestHash("POST", "/articles", { a: 1 }), handler);
    await expect(
      service.run(KEY, "create-0001", requestHash("POST", "/articles", { a: 2 }), handler),
    ).rejects.toMatchObject({ code: ErrorCode.IDEMPOTENCY_MISMATCH, httpStatus: 409 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("keys are per API key: two keys may use the same header value", async () => {
    const { service } = setup();
    const handler = vi.fn(() => Promise.resolve({ status: 201, body: {} }));
    const hash = requestHash("POST", "/articles", {});
    await service.run(KEY, "shared-key-1", hash, handler);
    await service.run("018f0000-0000-7000-8000-0000000000bb", "shared-key-1", hash, handler);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("a request that is still running is not run twice", async () => {
    const { service } = setup();
    let release: () => void = () => undefined;
    const slow = () =>
      new Promise<{ status: number; body: unknown }>((resolve) => {
        release = () => {
          resolve({ status: 201, body: {} });
        };
      });
    const hash = requestHash("POST", "/articles", {});
    const running = service.run(KEY, "create-0001", hash, slow);
    await expect(
      service.run(KEY, "create-0001", hash, () => Promise.resolve({ status: 201, body: {} })),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    release();
    await running;
  });

  it("a failed request releases its key so the fixed request can retry under it", async () => {
    const { service, repo } = setup();
    const hash = requestHash("POST", "/articles", {});
    await expect(
      service.run(KEY, "create-0001", hash, () => Promise.reject(new Error("422"))),
    ).rejects.toThrow("422");
    expect(repo.rows.size).toBe(0);
    const retry = await service.run(
      KEY,
      "create-0001",
      requestHash("POST", "/articles", { fixed: 1 }),
      () => Promise.resolve({ status: 201, body: { ok: true } }),
    );
    expect(retry.replayed).toBe(false);
  });

  it("expires after 24 hours: the key can be reused with a different body", async () => {
    const { service } = setup();
    const handler = vi.fn(() => Promise.resolve({ status: 201, body: { n: 1 } }));
    await service.run(KEY, "create-0001", requestHash("POST", "/articles", { a: 1 }), handler);
    vi.advanceTimersByTime(IDEMPOTENCY_TTL_MS - 1_000);
    await expect(
      service.run(KEY, "create-0001", requestHash("POST", "/articles", { a: 2 }), handler),
    ).rejects.toMatchObject({ code: ErrorCode.IDEMPOTENCY_MISMATCH });
    vi.advanceTimersByTime(2_000);
    const again = await service.run(
      KEY,
      "create-0001",
      requestHash("POST", "/articles", { a: 2 }),
      handler,
    );
    expect(again.replayed).toBe(false);
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe("request identity", () => {
  it("canonicalJson ignores key order and undefined", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }], e: undefined })).toBe(
      '{"a":[{"c":3,"d":2}],"b":1}',
    );
  });

  it("requestHash is stable across key order and differs by body, method and route", () => {
    expect(requestHash("POST", "/articles", { a: 1, b: 2 })).toBe(
      requestHash("POST", "/articles", { b: 2, a: 1 }),
    );
    expect(requestHash("POST", "/articles", { a: 1 })).not.toBe(
      requestHash("POST", "/articles", { a: 2 }),
    );
    expect(requestHash("POST", "/articles", {})).not.toBe(requestHash("POST", "/media", {}));
  });
});

describe("parseIdempotencyKey", () => {
  it("is required and well formed", () => {
    expect(() => parseIdempotencyKey(undefined)).toThrowError(
      expect.objectContaining({ code: ErrorCode.VALIDATION_FAILED }),
    );
    expect(() => parseIdempotencyKey("short")).toThrow();
    expect(() => parseIdempotencyKey("has space in it")).toThrow();
    expect(parseIdempotencyKey(" cover-kb-1042-v1 ")).toBe("cover-kb-1042-v1");
  });
});
