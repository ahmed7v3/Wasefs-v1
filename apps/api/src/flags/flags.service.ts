import { Inject, Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { flagKeySchema, flagRulesSchema, upsertFlagSchema } from "@wasfa/shared/settings";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";
import { z } from "zod";

import { AuditService } from "../audit/audit.service.js";
import { InvalidationBus } from "../common/invalidation-bus.js";
import { LocalCache } from "../common/local-cache.js";
import { REDIS } from "../common/redis.js";
import { parseWithSchema } from "../common/validation.js";

import { evaluateFlag, type FlagRow } from "./flags.evaluate.js";
import { FlagsRepo } from "./flags.repo.js";

import type { AuthenticatedUser } from "../common/current-user.js";
import type { FastifyRequest } from "fastify";

export const FLAGS_CHANNEL = "flags:invalidate";
export const FLAGS_LOCAL_TTL_MS = 30_000;
/** Decision #11: every non-queue Redis key expires. */
export const FLAGS_REDIS_TTL_SECONDS = 600;
const REDIS_KEY = "flags:v1:all";
const LOCAL_KEY = "all";

const storedFlagsSchema = z.array(
  z.object({ key: z.string(), enabled: z.boolean(), rules: z.unknown() }),
);

export interface FlagWriteContext {
  /** The admin who changes it; null for the system. */
  actorId: string | null;
  /** Adds IP and user agent to the audit row. */
  request?: FastifyRequest;
}

/**
 * Feature flags: stored in `feature_flags`, cached like settings (30 s in process, 10 min in Redis,
 * dropped on every instance by pub/sub when an admin changes one). Redis trouble only costs speed.
 */
@Injectable()
export class FlagsService {
  private readonly local = new LocalCache<FlagRow[]>(FLAGS_LOCAL_TTL_MS);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly repo: FlagsRepo,
    private readonly audit: AuditService,
    private readonly bus: InvalidationBus,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("Flags");
    this.bus.on(FLAGS_CHANNEL, () => this.local.clear());
  }

  async all(): Promise<FlagRow[]> {
    const cached = this.local.get(LOCAL_KEY);
    if (cached !== undefined) return cached;
    const rows = (await this.readShared()) ?? (await this.loadFromDatabase());
    this.local.set(LOCAL_KEY, rows);
    return rows;
  }

  /** Every flag as on/off for this caller. A flag that does not exist is absent, which means off. */
  async evaluateFor(
    user: Pick<AuthenticatedUser, "id" | "orgIds">,
  ): Promise<Record<string, boolean>> {
    const subject = { userId: user.id, orgIds: user.orgIds, plan: null };
    return Object.fromEntries(
      (await this.all()).map((flag) => [flag.key, evaluateFlag(flag, subject)] as const),
    );
  }

  /** Creates or replaces a flag. Invalid key or rules: `VALIDATION_FAILED` with field paths. */
  async set(key: string, input: unknown, ctx: FlagWriteContext): Promise<void> {
    const flagKey = parseWithSchema(flagKeySchema, key);
    const { enabled, rules } = parseWithSchema(upsertFlagSchema, input);
    const before = await this.repo.find(flagKey);

    await this.repo.upsert(flagKey, enabled, rules);
    await this.invalidateEverywhere();
    await this.record(ctx, {
      action: "flag.update",
      targetId: flagKey,
      before,
      after: { key: flagKey, enabled, rules },
    });
  }

  /** Deletes a flag (it evaluates to off from then on). Unknown key: `NOT_FOUND`. */
  async remove(key: string, ctx: FlagWriteContext): Promise<void> {
    const flagKey = parseWithSchema(flagKeySchema, key);
    const before = await this.repo.find(flagKey);
    if (before === undefined || !(await this.repo.remove(flagKey))) {
      throw new AppError(ErrorCode.NOT_FOUND);
    }
    await this.invalidateEverywhere();
    await this.record(ctx, { action: "flag.delete", targetId: flagKey, before });
  }

  private async invalidateEverywhere(): Promise<void> {
    try {
      await this.redis.del(REDIS_KEY);
    } catch (error) {
      this.cacheUnavailable(error);
    }
    this.local.clear();
    await this.bus.publish(FLAGS_CHANNEL, "all");
  }

  private async record(
    ctx: FlagWriteContext,
    entry: { action: string; targetId: string; before?: unknown; after?: unknown },
  ): Promise<void> {
    const full = { ...entry, targetType: "flag" };
    if (ctx.request) await this.audit.recordFor(ctx.request, { ...full, actorId: ctx.actorId });
    else await this.audit.record({ ...full, actorId: ctx.actorId });
  }

  private async loadFromDatabase(): Promise<FlagRow[]> {
    const rows = await this.repo.all();
    for (const row of rows) {
      // Key name only: an unreadable rule set makes that flag evaluate to off, never an error.
      if (!flagRulesSchema.safeParse(row.rules).success) {
        this.logger.warn({ key: row.key }, "Flag rules are invalid, the flag is off");
      }
    }
    try {
      await this.redis.set(REDIS_KEY, JSON.stringify(rows), "EX", FLAGS_REDIS_TTL_SECONDS);
    } catch (error) {
      this.cacheUnavailable(error);
    }
    return rows;
  }

  private async readShared(): Promise<FlagRow[] | undefined> {
    try {
      const raw = await this.redis.get(REDIS_KEY);
      if (raw === null) return undefined;
      const parsed = storedFlagsSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : undefined;
    } catch (error) {
      this.cacheUnavailable(error);
      return undefined;
    }
  }

  private cacheUnavailable(error: unknown): void {
    this.logger.warn({ reason: (error as Error).message }, "Flags cache unavailable");
  }
}
