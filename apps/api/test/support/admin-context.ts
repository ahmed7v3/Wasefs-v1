import { randomUUID } from "node:crypto";

import {
  auditLogs,
  createDb,
  rolePermissions,
  roles,
  seedDefaults,
  sessions,
  users,
  type NewUser,
} from "@wasfa/db";
import { PERMISSION_KEYS, type Permission } from "@wasfa/shared/permissions";
import { Queue } from "bullmq";
import { and, desc, eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { TURNSTILE_VERIFY_URL } from "../../src/auth/turnstile.js";
import { createApp } from "../../src/bootstrap.js";
import { RbacService } from "../../src/rbac/rbac.service.js";

import { AuthHarness, pwnedHandlers, testApiEnv, type Jar } from "./auth-harness.js";
import { startInfra, type TestInfra } from "./infra.js";

import type { ApiEnv } from "../../src/config/env.js";
import type { ModuleMetadata } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

export interface Admin {
  email: string;
  jar: Jar;
  userId: string;
  secret: string;
}

export interface Person {
  email: string;
  jar: Jar;
  userId: string;
}

/** A placeholder for ids that never exist (guards answer before the id is looked at). */
export const MISSING_ID = "018f0000-0000-7000-8000-000000000000";
export const MISSING_FINGERPRINT = "a".repeat(32);

/**
 * Everything an admin integration test needs: Postgres 18 + Redis 8, the real app, an owner
 * database handle, the notifications queue, and shortcuts for "an admin with two-factor on".
 * One instance per test file.
 */
export class AdminTestContext {
  infra!: TestInfra;
  env!: ApiEnv;
  app!: NestFastifyApplication;
  owner!: ReturnType<typeof createDb>;
  redis!: Redis;
  queue!: Queue;
  readonly harness = new AuthHarness(
    () => this.app,
    () => this.owner.db,
  );

  private readonly network = setupServer(
    ...pwnedHandlers(),
    http.post(TURNSTILE_VERIFY_URL, () => HttpResponse.json({ success: true })),
  );
  private roleCounter = 0;

  async start(
    extraImports: ModuleMetadata["imports"] = [],
    envOverrides: Record<string, string | number> = {},
  ): Promise<void> {
    this.infra = await startInfra();
    // Anything but the local test services (MinIO) must have a handler.
    this.network.listen({
      onUnhandledRequest: (request, print) => {
        const host = new URL(request.url).hostname;
        if (host === "localhost" || host === "127.0.0.1") return;
        print.error();
      },
    });
    this.env = testApiEnv(this.infra, envOverrides);
    this.owner = createDb({ url: this.infra.databaseUrl, max: 4 });
    await seedDefaults(this.owner.db);
    this.app = await createApp(this.env, {
      extraImports: [this.harness.mailerModule(), ...extraImports],
      authMailer: false,
    });
    this.redis = new Redis(this.infra.redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue("notifications", { connection: this.redis });
  }

  async stop(): Promise<void> {
    this.network.close();
    await this.queue?.close();
    await this.redis?.quit();
    await this.app?.close();
    await this.owner?.close();
    await this.infra?.stop();
  }

  get rbac(): RbacService {
    return this.app.get(RbacService);
  }

  /** A signed-in user holding `roleKeys`, two-factor on, in a session that went through the TOTP challenge. */
  async admin(...roleKeys: string[]): Promise<Admin> {
    const user = await this.harness.signedInUser();
    for (const roleKey of roleKeys) await this.harness.grantRole(user.userId, roleKey);
    const { secret } = await this.harness.enableTwoFactor(user);
    await this.rbac.bustUser(user.userId);
    return { ...user, secret };
  }

  /** A signed-in user with a platform role but no second factor (the admin routes refuse them). */
  async adminWithoutTwoFactor(roleKey: string): Promise<Person> {
    const user = await this.harness.signedInUser();
    await this.harness.grantRole(user.userId, roleKey);
    await this.rbac.bustUser(user.userId);
    return user;
  }

  /** A role holding every permission except `missing`, so a route needing it must answer 403. */
  async roleLacking(missing: Permission): Promise<string> {
    return this.customRole(PERMISSION_KEYS.filter((permission) => permission !== missing));
  }

  /** Inserts a custom role straight into the database and returns its key. */
  async customRole(permissions: readonly Permission[]): Promise<string> {
    const key = `test_role_${++this.roleCounter}_${randomUUID().slice(0, 6)}`;
    await this.owner.db.insert(roles).values({ key, nameAr: key, nameEn: key, isSystem: false });
    if (permissions.length > 0) {
      await this.owner.db
        .insert(rolePermissions)
        .values(permissions.map((permission) => ({ roleKey: key, permission })));
    }
    return key;
  }

  /** Makes the user's last proof of identity older than any freshness window. */
  async makeSessionStale(userId: string, minutes = 60): Promise<void> {
    await this.owner.db
      .update(sessions)
      .set({ reauthAt: new Date(Date.now() - minutes * 60_000) })
      .where(eq(sessions.userId, userId));
  }

  /** A user row inserted directly (no sign-in), e.g. a phone-only account. */
  async insertUser(values: Partial<NewUser> & { name: string; email: string }): Promise<string> {
    const [row] = await this.owner.db.insert(users).values(values).returning({ id: users.id });
    if (!row) throw new Error("user insert failed");
    return row.id;
  }

  async auditRowsFor(action: string, targetId: string) {
    return this.owner.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, action), eq(auditLogs.targetId, targetId)))
      .orderBy(desc(auditLogs.createdAt));
  }

  /** Mail jobs addressed to `to`; waits for the first one to appear. */
  async jobsFor(to: string) {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const jobs = await this.queue.getJobs(["waiting", "active", "delayed", "completed"]);
      const found = jobs.filter((job) => (job.data as { to?: string }).to === to);
      if (found.length > 0) return found;
      if (Date.now() > deadline) throw new Error("no job was queued");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async noJobsFor(to: string): Promise<boolean> {
    const jobs = await this.queue.getJobs(["waiting", "active", "delayed", "completed", "failed"]);
    return jobs.every((job) => (job.data as { to?: string }).to !== to);
  }
}
