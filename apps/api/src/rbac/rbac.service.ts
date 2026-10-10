import { Inject, Injectable } from "@nestjs/common";
import { PERMISSION_KEYS, isPermission, type Permission } from "@wasfa/shared/permissions";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { REDIS } from "../common/redis.js";

import { RbacRepo } from "./rbac.repo.js";

/** The role that holds every permission, including ones added later. */
export const SUPER_ADMIN_ROLE = "super_admin";
export const ACCESS_CACHE_TTL_SECONDS = 5 * 60;
const EPOCH_KEY = "rbac:epoch";

export interface AccessProfile {
  roles: string[];
  /** Everything the user may do, as catalog keys. Complete for `super_admin`. */
  permissions: Permission[];
  isSuperAdmin: boolean;
  /** Organizations the user belongs to (any member role). */
  orgIds: string[];
}

/**
 * Resolves what a user may do. The database is the authority; Redis keeps the answer for 5 minutes
 * and is cleared whenever it could change: call `bustUser` after any change to a user's roles or
 * organization memberships, `bustRole` after editing a role's permissions, `bustAll` after a bulk
 * change. A Redis outage only makes lookups slower, never wrong.
 */
@Injectable()
export class RbacService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly repo: RbacRepo,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("Rbac");
  }

  async resolve(userId: string): Promise<AccessProfile> {
    const epoch = await this.epoch();
    const key = `rbac:${epoch}:u:${userId}`;
    const cached = await this.readCache(key);
    if (cached) return cached;

    const roles = await this.repo.roleKeys(userId);
    const isSuperAdmin = roles.includes(SUPER_ADMIN_ROLE);
    // Stale strings in `role_permissions` (a permission removed from the catalog) grant nothing.
    const granted = isSuperAdmin
      ? PERMISSION_KEYS
      : [...new Set(await this.repo.permissionsOf(roles))].filter(isPermission);
    const profile: AccessProfile = {
      roles,
      permissions: granted,
      isSuperAdmin,
      orgIds: await this.repo.orgIds(userId),
    };
    await this.writeCache(key, profile);
    return profile;
  }

  async bustUser(userId: string): Promise<void> {
    try {
      const epoch = await this.epoch();
      await this.redis.del(`rbac:${epoch}:u:${userId}`);
    } catch (error) {
      this.cacheUnavailable(error);
    }
  }

  /** Everyone holding `roleKey` (after its permissions or membership changed). */
  async bustRole(roleKey: string): Promise<void> {
    for (const userId of await this.repo.userIdsWithRole(roleKey)) await this.bustUser(userId);
  }

  /** Invalidates every cached profile at once by moving to a new epoch. */
  async bustAll(): Promise<void> {
    try {
      await this.redis.incr(EPOCH_KEY);
    } catch (error) {
      this.cacheUnavailable(error);
    }
  }

  private async epoch(): Promise<string> {
    try {
      return (await this.redis.get(EPOCH_KEY)) ?? "0";
    } catch (error) {
      this.cacheUnavailable(error);
      return "0";
    }
  }

  private async readCache(key: string): Promise<AccessProfile | null> {
    try {
      const raw = await this.redis.get(key);
      return raw === null ? null : (JSON.parse(raw) as AccessProfile);
    } catch (error) {
      this.cacheUnavailable(error);
      return null;
    }
  }

  private async writeCache(key: string, profile: AccessProfile): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(profile), "EX", ACCESS_CACHE_TTL_SECONDS);
    } catch (error) {
      this.cacheUnavailable(error);
    }
  }

  private cacheUnavailable(error: unknown): void {
    this.logger.warn({ reason: (error as Error).message }, "Access cache unavailable");
  }
}
