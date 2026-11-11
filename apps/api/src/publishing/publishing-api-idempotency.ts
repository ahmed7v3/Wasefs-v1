import { createHash } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { PUBLISHING_DEFAULTS } from "@wasfa/shared/publishing";

import { validationFailed } from "./publishing-api-errors.js";
import { PublishingApiRepo } from "./publishing-api.repo.js";

/*
 * `Idempotency-Key` (docs/PUBLISHING-API.md §4.1): the same key with the same request replays the stored
 * answer for 24 h, the same key with a different request is IDEMPOTENCY_MISMATCH. Only a status and the
 * JSON answer are stored. A request that fails releases its key, so the integrator can fix the request
 * and retry under the same key.
 */

const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export const IDEMPOTENCY_TTL_MS = PUBLISHING_DEFAULTS.idempotencyTtlHours * 3_600_000;

/** Stable JSON: object keys sorted, so field order in the request body does not change the hash. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** The request's identity: what it asks for (method, route template and body), never headers or time. */
export function requestHash(method: string, route: string, body: unknown): string {
  return createHash("sha256")
    .update(`${method}\n${route}\n${canonicalJson(body)}`)
    .digest("hex");
}

export function parseIdempotencyKey(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined || value.trim() === "") {
    throw validationFailed({
      "Idempotency-Key":
        "this request creates something: send a unique Idempotency-Key header (8-128 chars of A-Z a-z 0-9 . _ : -)",
    });
  }
  if (!KEY_PATTERN.test(value.trim())) {
    throw validationFailed({ "Idempotency-Key": "8-128 characters of A-Z a-z 0-9 . _ : -" });
  }
  return value.trim();
}

export interface StoredAnswer {
  status: number;
  body: unknown;
}

export interface IdempotentResult extends StoredAnswer {
  replayed: boolean;
}

@Injectable()
export class PublishingIdempotencyService {
  constructor(private readonly repo: PublishingApiRepo) {}

  async run(
    keyId: string,
    idemKey: string,
    hash: string,
    handler: () => Promise<StoredAnswer>,
  ): Promise<IdempotentResult> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - IDEMPOTENCY_TTL_MS);
    const first = await this.repo.claimIdempotency(keyId, idemKey, hash, now, cutoff);
    if (!first) {
      const stored = await this.repo.findIdempotency(keyId, idemKey);
      // The row vanished between the claim and the read (released by a failed first attempt): retry the claim once.
      if (stored === undefined) return this.run(keyId, idemKey, hash, handler);
      if (stored.requestHash !== hash) throw new AppError(ErrorCode.IDEMPOTENCY_MISMATCH);
      if (stored.status === null) {
        // The first request is still running: never run it twice.
        throw new AppError(ErrorCode.CONFLICT, {
          details: { reason: "idempotent_request_in_progress", retry_after_seconds: 2 },
        });
      }
      return { status: stored.status, body: stored.response, replayed: true };
    }
    try {
      const answer = await handler();
      await this.repo.completeIdempotency(keyId, idemKey, answer.status, answer.body);
      return { ...answer, replayed: false };
    } catch (error) {
      await this.repo.releaseIdempotency(keyId, idemKey);
      throw error;
    }
  }
}
