import { Injectable } from "@nestjs/common";
import { localDayBounds } from "@wasfa/shared/content";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { formatPublishingKey } from "@wasfa/shared/publishing";
import {
  type PublishingKey,
  type PublishingKeyInput,
  type PublishingKeyIssued,
} from "@wasfa/shared/schemas/admin-publishing-keys";

import { isValidAllowEntry } from "./publishing-ip.js";
import { generateKeyId, generateSecret, hashSecret } from "./publishing-key-crypto.js";
import { PublishingKeyService } from "./publishing-key.service.js";
import {
  PublishingKeysRepo,
  type KeyPatch,
  type KeyUsage,
  type KeyWithOwner,
} from "./publishing-keys.repo.js";

import type { PublishingKeyPatch } from "./publishing-key-patch.js";
import type { AuditScope } from "../audit/audited.decorator.js";
import type { AuthenticatedUser } from "../common/current-user.js";
import type { PublishingApiKeyRow } from "@wasfa/db";

/** Fields of a key that may appear in `audit_logs`: never the secret, hashes or ids (UUIDs get mangled by the redactor). */
export const PUBLISHING_KEY_AUDIT_FIELDS = [
  "name",
  "environment",
  "scopes",
  "canPublish",
  "allowedTypes",
  "allowedCategorySlugs",
  "dailyPublishCap",
  "requestsPerMinute",
  "ipAllowCount",
  "expiresAt",
  "revokedAt",
  "rotationGraceUntil",
  "changed",
] as const;

const USAGE_ZONE = "Africa/Cairo";
const DAY_MS = 86_400_000;
const EMPTY_USAGE: KeyUsage = {
  requestsToday: 0,
  errorsToday: 0,
  itemsCreatedToday: 0,
  publishedToday: 0,
};

/** The audit view of a key row: what changed hands, never anything that authenticates. */
export function auditView(row: PublishingApiKeyRow): Record<string, unknown> {
  return {
    name: row.name,
    environment: row.environment,
    scopes: row.scopes,
    canPublish: row.canPublish,
    allowedTypes: row.allowedTypes,
    allowedCategorySlugs: row.allowedCategorySlugs,
    dailyPublishCap: row.dailyPublishCap,
    requestsPerMinute: row.requestsPerMinute,
    ipAllowCount: row.ipAllowList.length,
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    rotationGraceUntil: row.prevValidUntil?.toISOString() ?? null,
  };
}

export function toKeyView(
  { row, ownerName }: KeyWithOwner,
  usage: KeyUsage,
  now: Date,
): PublishingKey {
  return {
    id: row.id,
    name: row.name,
    environment: row.environment,
    prefix: `wsk_${row.environment}_${row.keyId}`,
    last4: row.last4,
    scopes: row.scopes as PublishingKey["scopes"],
    canPublish: row.canPublish,
    allowedTypes: row.allowedTypes as PublishingKey["allowedTypes"],
    allowedCategorySlugs: row.allowedCategorySlugs,
    defaultAuthorId: row.defaultAuthorId,
    defaultFeaturedMediaId: row.defaultFeaturedMediaId,
    dailyPublishCap: row.dailyPublishCap,
    requestsPerMinute: row.requestsPerMinute,
    ipAllowList: row.ipAllowList,
    ownerUserId: row.ownerUserId,
    ownerName,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    rotationGraceUntil:
      row.prevValidUntil !== null && row.prevValidUntil.getTime() > now.getTime()
        ? row.prevValidUntil.toISOString()
        : null,
    usage,
  };
}

function invalid(field: string, reason: string): AppError {
  return new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: [`${field}:${reason}`] } });
}

/** Admin management of Publishing API keys (permission `content.api_keys`, fresh auth on writes). */
@Injectable()
export class AdminPublishingKeysService {
  constructor(
    private readonly repo: PublishingKeysRepo,
    private readonly keys: PublishingKeyService,
  ) {}

  async list(): Promise<{ items: PublishingKey[] }> {
    const now = new Date();
    const rows = await this.repo.list();
    const usage = await this.repo.usageSince(
      rows.map((entry) => entry.row.id),
      localDayBounds(now, USAGE_ZONE).start,
    );
    return {
      items: rows.map((entry) => toKeyView(entry, usage.get(entry.row.id) ?? EMPTY_USAGE, now)),
    };
  }

  /**
   * Creates a key owned by the acting admin. `canPublish` needs the acting admin to hold
   * `content.publish` themselves (a key must never out-rank the person who made it). A key with the
   * `content:publish` scope but `canPublish = false` is allowed: it can call the publish endpoints but
   * the server downgrades the request to a draft or review (docs section 8).
   */
  async create(
    actor: AuthenticatedUser,
    input: PublishingKeyInput,
    audit: AuditScope,
  ): Promise<PublishingKeyIssued> {
    if (input.canPublish && !actor.isSuperAdmin && !actor.permissions.includes("content.publish")) {
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: "content_publish_required" } });
    }
    await this.validateReferences(input);

    const now = new Date();
    const secret = generateSecret();
    let keyId = generateKeyId();
    while ((await this.repo.findByKeyId(keyId)) !== undefined) keyId = generateKeyId();

    const row = await this.repo.insert({
      keyId,
      environment: input.environment,
      secretHash: hashSecret(this.keys.pepperOf(), secret),
      last4: secret.slice(-4),
      name: input.name,
      ownerUserId: actor.id,
      scopes: [...input.scopes],
      canPublish: input.canPublish,
      allowedTypes: [...input.allowedTypes],
      allowedCategorySlugs: input.allowedCategorySlugs,
      defaultAuthorId: input.defaultAuthorId,
      defaultFeaturedMediaId: input.defaultFeaturedMediaId,
      dailyPublishCap: input.dailyPublishCap,
      requestsPerMinute: input.requestsPerMinute,
      ipAllowList: input.ipAllowList,
      expiresAt: new Date(now.getTime() + input.expiresInDays * DAY_MS),
    });
    audit.targetId = row.id;
    audit.after = auditView(row);
    return {
      key: toKeyView({ row, ownerName: actor.name }, EMPTY_USAGE, now),
      secret: formatPublishingKey(row.environment, row.keyId, secret),
    };
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    patch: PublishingKeyPatch,
    audit: AuditScope,
  ): Promise<PublishingKey> {
    const current = await this.require(id);
    if (current.row.revokedAt !== null) throw invalid("key", "revoked");
    if (
      patch.canPublish === true &&
      !actor.isSuperAdmin &&
      !actor.permissions.includes("content.publish")
    ) {
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: "content_publish_required" } });
    }
    await this.validateReferences(patch);

    const row = await this.repo.update(id, patch as KeyPatch);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    await this.keys.invalidate(row.keyId);
    audit.targetId = id;
    audit.before = auditView(current.row);
    audit.after = { ...auditView(row), changed: Object.keys(patch) };
    return this.view({ row, ownerName: current.ownerName });
  }

  async revoke(id: string, audit: AuditScope): Promise<PublishingKey> {
    const current = await this.require(id);
    const row =
      current.row.revokedAt === null ? await this.repo.revoke(id, new Date()) : current.row;
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    // Immediate on this instance; the others drop the cached row through the bus (15 s TTL as the fallback).
    await this.keys.invalidate(row.keyId);
    audit.targetId = id;
    audit.before = auditView(current.row);
    audit.after = auditView(row);
    return this.view({ row, ownerName: current.ownerName });
  }

  /** New secret; the old one keeps working for `graceHours` (0 = cut over at once). */
  async rotate(id: string, graceHours: number, audit: AuditScope): Promise<PublishingKeyIssued> {
    const current = await this.require(id);
    if (current.row.revokedAt !== null) throw invalid("key", "revoked");
    const now = new Date();
    const secret = generateSecret();
    const row = await this.repo.rotate(id, {
      secretHash: hashSecret(this.keys.pepperOf(), secret),
      last4: secret.slice(-4),
      graceUntil: graceHours > 0 ? new Date(now.getTime() + graceHours * 3_600_000) : null,
    });
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    await this.keys.invalidate(row.keyId);
    audit.targetId = id;
    audit.before = auditView(current.row);
    audit.after = auditView(row);
    return {
      key: await this.view({ row, ownerName: current.ownerName }, now),
      secret: formatPublishingKey(row.environment, row.keyId, secret),
    };
  }

  async requests(id: string, limit: number) {
    await this.require(id);
    const rows = await this.repo.recentRequests(id, limit);
    return {
      items: rows.map((row) => ({
        at: row.at.toISOString(),
        method: row.method,
        route: row.route,
        status: row.status,
        latencyMs: row.latencyMs,
        errorCode: row.errorCode,
        itemId: row.itemId,
      })),
    };
  }

  private async require(id: string): Promise<KeyWithOwner> {
    const found = await this.repo.findById(id);
    if (!found) throw new AppError(ErrorCode.NOT_FOUND);
    return found;
  }

  private async view(entry: KeyWithOwner, now: Date = new Date()): Promise<PublishingKey> {
    const usage = await this.repo.usageSince([entry.row.id], localDayBounds(now, USAGE_ZONE).start);
    return toKeyView(entry, usage.get(entry.row.id) ?? EMPTY_USAGE, now);
  }

  private async validateReferences(
    input: Partial<
      Pick<PublishingKeyInput, "defaultAuthorId" | "defaultFeaturedMediaId" | "ipAllowList">
    >,
  ): Promise<void> {
    for (const entry of input.ipAllowList ?? []) {
      if (!isValidAllowEntry(entry)) throw invalid("ipAllowList", "invalid_ip_or_cidr");
    }
    if (input.defaultAuthorId && !(await this.repo.personExists(input.defaultAuthorId))) {
      throw invalid("defaultAuthorId", "not_found");
    }
    if (
      input.defaultFeaturedMediaId &&
      !(await this.repo.mediaIsReady(input.defaultFeaturedMediaId))
    ) {
      throw invalid("defaultFeaturedMediaId", "not_ready_image");
    }
  }
}
