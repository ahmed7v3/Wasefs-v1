import { Inject, Injectable } from "@nestjs/common";
import { siteSettings } from "@wasfa/db";
import {
  DEFAULT_ACCESS_SETTINGS,
  DEFAULT_AUTH_SETTINGS,
  accessSettingsSchema,
  authSettingsSchema,
  type AccessSettings,
  type AuthSettings,
} from "@wasfa/shared/auth-settings";
import { inArray } from "drizzle-orm";

import { DB, type DbHandle } from "../common/database.js";

const TTL_MS = 15_000;

interface Snapshot {
  at: number;
  auth: AuthSettings;
  access: AccessSettings;
}

/**
 * Reads the `auth` and `access` site settings straight from the database with a short in-process
 * cache. Task 1.8's `SettingsService` (Redis cache, pub/sub invalidation) replaces this; until then
 * a missing or malformed row falls back to the safe defaults instead of failing a login.
 */
@Injectable()
export class AuthSettingsReader {
  private snapshot: Snapshot | undefined;

  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** Drops the cache; tests and the future settings writer call this after a change. */
  invalidate(): void {
    this.snapshot = undefined;
  }

  async auth(): Promise<AuthSettings> {
    return (await this.load()).auth;
  }

  async access(): Promise<AccessSettings> {
    return (await this.load()).access;
  }

  private async load(): Promise<Snapshot> {
    if (this.snapshot && Date.now() - this.snapshot.at < TTL_MS) return this.snapshot;
    const rows = await this.handle.db
      .select()
      .from(siteSettings)
      .where(inArray(siteSettings.key, ["auth", "access"]));
    const value = (key: string) => rows.find((row) => row.key === key)?.value;
    const auth = authSettingsSchema.safeParse(value("auth") ?? {});
    const access = accessSettingsSchema.safeParse(value("access") ?? {});
    this.snapshot = {
      at: Date.now(),
      auth: auth.success ? auth.data : DEFAULT_AUTH_SETTINGS,
      access: access.success ? access.data : DEFAULT_ACCESS_SETTINGS,
    };
    return this.snapshot;
  }
}
