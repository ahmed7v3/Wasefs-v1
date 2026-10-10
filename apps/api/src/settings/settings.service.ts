import { Inject, Injectable } from "@nestjs/common";
import {
  SETTINGS_REGISTRY,
  SETTING_KEYS,
  isSettingKey,
  settingDefault,
  type SettingKey,
  type SettingValue,
} from "@wasfa/shared/settings";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { AuditService } from "../audit/audit.service.js";
import { InvalidationBus } from "../common/invalidation-bus.js";
import { LocalCache } from "../common/local-cache.js";
import { REDIS } from "../common/redis.js";
import { parseWithSchema } from "../common/validation.js";

import { SettingsRepo } from "./settings.repo.js";

import type { FastifyRequest } from "fastify";

export const SETTINGS_CHANNEL = "settings:invalidate";
/** In-process layer: the longest a change can stay invisible when pub/sub is down. */
export const SETTINGS_LOCAL_TTL_MS = 30_000;
/** Decision #11: every non-queue Redis key expires. */
export const SETTINGS_REDIS_TTL_SECONDS = 600;
const redisKey = (key: SettingKey) => `settings:v1:${key}`;

export interface SettingWriteContext {
  /** The admin who changes it; null for the system (seed, tests). */
  actorId: string | null;
  /** Adds IP and user agent to the audit row. */
  request?: FastifyRequest;
}

/**
 * Typed access to `site_settings`. Reads go through three layers, each optional for correctness:
 * an in-process cache (30 s), Redis (10 min), then the database, and a missing or unreadable row
 * yields the code default (AGENT 5.9). A change drops all layers on every instance (`set`). Redis
 * trouble only costs speed: it is never allowed to fail a request.
 */
@Injectable()
export class SettingsService {
  private readonly local = new LocalCache<unknown>(SETTINGS_LOCAL_TTL_MS);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly repo: SettingsRepo,
    private readonly audit: AuditService,
    private readonly bus: InvalidationBus,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("Settings");
    this.bus.on(SETTINGS_CHANNEL, (message) => {
      if (isSettingKey(message)) this.local.delete(message);
      else this.local.clear();
    });
  }

  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    const cached = this.local.get(key);
    if (cached !== undefined) return cached as SettingValue<K>;
    const value = await this.load(key);
    this.local.set(key, value);
    return value;
  }

  async getMany<K extends SettingKey>(keys: readonly K[]): Promise<{ [P in K]: SettingValue<P> }> {
    const entries = await Promise.all(keys.map(async (key) => [key, await this.get(key)] as const));
    return Object.fromEntries(entries) as { [P in K]: SettingValue<P> };
  }

  /**
   * Validates against the registry (invalid: `VALIDATION_FAILED` with field paths), stores, drops
   * every cache layer on every instance and writes the audit row. Returns the stored value.
   */
  async set<K extends SettingKey>(
    key: K,
    value: unknown,
    ctx: SettingWriteContext,
  ): Promise<SettingValue<K>> {
    const parsed = parseWithSchema(SETTINGS_REGISTRY[key].schema, value) as SettingValue<K>;
    const stored = await this.repo.find(key);
    const before = stored === undefined ? undefined : this.parseStored(key, stored.value);

    await this.repo.upsert(key, parsed, ctx.actorId);
    await this.dropShared(key);
    this.local.delete(key);
    await this.bus.publish(SETTINGS_CHANNEL, key);

    const entry = {
      action: "setting.update",
      targetType: "setting",
      targetId: key,
      before: before ?? settingDefault(key),
      after: parsed,
    };
    if (ctx.request) await this.audit.recordFor(ctx.request, { ...entry, actorId: ctx.actorId });
    else await this.audit.record({ ...entry, actorId: ctx.actorId });
    return parsed;
  }

  /**
   * Drops the cached copy of one key (all keys when omitted) on this instance and in Redis. For
   * code that changed the table without `set`, such as tests.
   */
  async invalidate(key?: SettingKey): Promise<void> {
    if (key === undefined) {
      this.local.clear();
      for (const each of SETTING_KEYS) await this.dropShared(each);
      return;
    }
    this.local.delete(key);
    await this.dropShared(key);
  }

  private async load<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    const cached = await this.readShared(key);
    if (cached !== undefined) return cached;

    const stored = await this.repo.find(key);
    if (stored === undefined) return settingDefault(key);
    const parsed = this.parseStored(key, stored.value);
    if (parsed === undefined) {
      // Key name only: the stored value may hold anything an admin typed.
      this.logger.warn({ key }, "Stored setting is invalid, using the default");
      return settingDefault(key);
    }
    await this.writeShared(key, parsed);
    return parsed;
  }

  private parseStored<K extends SettingKey>(key: K, raw: unknown): SettingValue<K> | undefined {
    const result = SETTINGS_REGISTRY[key].schema.safeParse(raw);
    return result.success ? (result.data as SettingValue<K>) : undefined;
  }

  private async readShared<K extends SettingKey>(key: K): Promise<SettingValue<K> | undefined> {
    try {
      const raw = await this.redis.get(redisKey(key));
      return raw === null ? undefined : this.parseStored(key, JSON.parse(raw));
    } catch (error) {
      this.cacheUnavailable(error);
      return undefined;
    }
  }

  private async writeShared(key: SettingKey, value: unknown): Promise<void> {
    try {
      await this.redis.set(redisKey(key), JSON.stringify(value), "EX", SETTINGS_REDIS_TTL_SECONDS);
    } catch (error) {
      this.cacheUnavailable(error);
    }
  }

  private async dropShared(key: SettingKey): Promise<void> {
    try {
      await this.redis.del(redisKey(key));
    } catch (error) {
      this.cacheUnavailable(error);
    }
  }

  private cacheUnavailable(error: unknown): void {
    this.logger.warn({ reason: (error as Error).message }, "Settings cache unavailable");
  }
}
