import { randomUUID } from "node:crypto";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import {
  createDb,
  growthEvents,
  growthMailLog,
  notificationPrefs,
  personalOffers,
  plans,
  pruneGrowthData,
  runMigrations,
  rxAnalyses,
  seedDefaults,
  siteSettings,
  subscriptions,
  unsubscribeToken,
  users,
  verifyUnsubscribeToken,
} from "@wasfa/db";
import { emailSendPayloadSchema, type EmailSendInput } from "@wasfa/shared/email";
import { eq } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { growthLifecycleJob } from "../src/jobs/growth.job.js";
import { renderEmail } from "../src/notifications/templates/index.js";

import type { WorkerEnv } from "../src/config/env.js";
import type { PaymentsRuntime } from "../src/payments/runtime.js";

/*
 * The conversion engine's worker side (GROWTH §6, Task 3.14): offers by rule, lifecycle mail only
 * with consent, at most once per kind and period, never in the first day, under the weekly cap,
 * silent after a last call; a working unsubscribe link and header in every mail; retention.
 */

let postgres: StartedPostgreSqlContainer;
let db: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });
const DAY = 86_400_000;
const KEY = Buffer.alloc(32, 7);
let sent: Array<{ payload: EmailSendInput; jobId: string }> = [];

const payments = {
  webOrigin: "https://wasfa.example",
  enqueueEmail: async (payload: EmailSendInput, jobId: string) => {
    sent.push({ payload, jobId });
  },
} as unknown as PaymentsRuntime;
const env = {
  API_PUBLIC_URL: "https://api.wasfa.example",
  ENCRYPTION_KEY: KEY.toString("base64"),
} as unknown as WorkerEnv;

const run = (now = new Date()) =>
  growthLifecycleJob({}, { db: db.db, logger, payments, env }, now);

async function user(options: { daysOld: number; consent?: boolean; verified?: boolean }) {
  const id = randomUUID();
  const createdAt = new Date(Date.now() - options.daysOld * DAY);
  await db.db.insert(users).values({
    id,
    name: "Test Person",
    email: `${id.slice(0, 8)}@example.com`,
    emailVerified: options.verified ?? true,
    locale: "ar",
    createdAt,
  });
  if (options.consent ?? true) {
    await db.db.insert(notificationPrefs).values({ userId: id, marketingOptedInAt: createdAt });
  }
  return id;
}

async function doneAnalyses(userId: string, count: number) {
  for (let index = 0; index < count; index++) {
    await db.db.insert(rxAnalyses).values({
      ownerUserId: userId,
      createdBy: userId,
      status: "done",
      mode: "balanced",
      skillVersion: "test@1",
      routeVersion: 1,
      inputSha256: randomUUID().replaceAll("-", "").padEnd(64, "0"),
      result: { items: [{}, {}] },
      finishedAt: new Date(),
    });
  }
}

const mailsTo = (userId: string) =>
  sent.filter((mail) => mail.jobId.startsWith(`lifecycle-${userId}-`));

beforeAll(async () => {
  postgres = await new PostgreSqlContainer("postgres:18-alpine").start();
  db = createDb({ url: postgres.getConnectionUri(), max: 3 });
  await runMigrations(db.db);
  await seedDefaults(db.db);
}, 180_000);

afterAll(async () => {
  await db?.close();
  await postgres?.stop();
});

beforeEach(async () => {
  sent = [];
  await db.db
    .insert(siteSettings)
    .values({ key: "growth", value: {} })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value: {} } });
});

describe("lifecycle mail", () => {
  it("sends the day-1 guide once, only with consent and a verified address", async () => {
    const consenting = await user({ daysOld: 1.5 });
    const silent = await user({ daysOld: 1.5, consent: false });
    const unverified = await user({ daysOld: 1.5, verified: false });
    await run();
    await run();
    expect(mailsTo(consenting)).toHaveLength(1);
    expect(mailsTo(consenting)[0]?.payload).toMatchObject({ template: "lifecycle_mail", kind: "day1_guide" });
    expect(mailsTo(silent)).toHaveLength(0);
    expect(mailsTo(unverified)).toHaveLength(0);
  });

  it("never mails in the first hours, and respects the weekly cap", async () => {
    const fresh = await user({ daysOld: 0.5 });
    await run();
    expect(mailsTo(fresh)).toHaveLength(0);

    const capped = await user({ daysOld: 3.5 });
    await doneAnalyses(capped, 1);
    await db.db.insert(growthMailLog).values({ userId: capped, kind: "value_recap", periodKey: "manual" });
    await run();
    expect(mailsTo(capped)).toHaveLength(0);
  });

  it("creates the welcome offer on day 6 for an active free user and mails it once", async () => {
    const id = await user({ daysOld: 6.5 });
    await doneAnalyses(id, 3);
    await run();
    const offers = await db.db.select().from(personalOffers).where(eq(personalOffers.ownerUserId, id));
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ kind: "welcome", ruleKey: "welcome_offer" });
    const mail = mailsTo(id).find((entry) => (entry.payload as { kind?: string }).kind === "day6_offer");
    expect(mail?.payload).toMatchObject({ params: { percent: "20" } });
    await run();
    expect(mailsTo(id).filter((entry) => (entry.payload as { kind?: string }).kind === "day6_offer")).toHaveLength(1);
    expect(await db.db.select().from(personalOffers).where(eq(personalOffers.ownerUserId, id))).toHaveLength(1);
  });

  it("does not offer a welcome to someone who already paid", async () => {
    const id = await user({ daysOld: 6.5 });
    await doneAnalyses(id, 3);
    const [plus] = await db.db.select().from(plans).where(eq(plans.key, "plus"));
    if (!plus) throw new Error("plan missing");
    await db.db.insert(subscriptions).values({
      ownerUserId: id,
      planId: plus.id,
      status: "active",
      source: "paid",
      currentPeriodStart: new Date(Date.now() - DAY),
      currentPeriodEnd: new Date(Date.now() + 20 * DAY),
    });
    await run();
    expect(await db.db.select().from(personalOffers).where(eq(personalOffers.ownerUserId, id))).toHaveLength(0);
  });

  it("sends the last call at expiry + 30 days, then stays silent for 90 days", async () => {
    const id = await user({ daysOld: 120 });
    const [plus] = await db.db.select().from(plans).where(eq(plans.key, "plus"));
    if (!plus) throw new Error("plan missing");
    await db.db.insert(subscriptions).values({
      ownerUserId: id,
      planId: plus.id,
      status: "expired",
      source: "paid",
      currentPeriodStart: new Date(Date.now() - 61 * DAY),
      currentPeriodEnd: new Date(Date.now() - 31 * DAY),
    });
    await run();
    expect(mailsTo(id).map((entry) => (entry.payload as { kind?: string }).kind)).toContain("last_call");
    const [prefs] = await db.db.select().from(notificationPrefs).where(eq(notificationPrefs.userId, id));
    expect(prefs?.marketingSilencedUntil?.getTime()).toBeGreaterThan(Date.now() + 89 * DAY);
  });

  it("stops everything with the kill switch", async () => {
    await db.db
      .update(siteSettings)
      .set({ value: { killSwitch: true } })
      .where(eq(siteSettings.key, "growth"));
    const id = await user({ daysOld: 1.5 });
    await run();
    expect(mailsTo(id)).toHaveLength(0);
  });
});

describe("the mail itself", () => {
  it("carries a working unsubscribe link and the one-click headers", async () => {
    const id = await user({ daysOld: 1.5 });
    await run();
    const payload = emailSendPayloadSchema.parse(mailsTo(id)[0]?.payload);
    if (payload.template !== "lifecycle_mail") throw new Error("wrong template");
    const token = new URL(payload.unsubscribeUrl).searchParams.get("token") ?? "";
    expect(verifyUnsubscribeToken(KEY, token)).toBe(id);
    expect(token).toBe(unsubscribeToken(KEY, id));
    expect(new URL(payload.oneClickUrl).origin).toBe("https://api.wasfa.example");

    const rendered = renderEmail({
      template: "lifecycle_mail",
      locale: "ar",
      name: "Test",
      kind: payload.kind,
      params: payload.params,
      link: payload.link,
      unsubscribeUrl: payload.unsubscribeUrl,
      oneClickUrl: payload.oneClickUrl,
    });
    expect(rendered.headers).toEqual({
      "List-Unsubscribe": `<${payload.oneClickUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(rendered.html).toContain(payload.unsubscribeUrl.replaceAll("&", "&amp;"));
  });
});

describe("retention", () => {
  it("deletes growth events and mail log rows older than 13 months", async () => {
    const id = await user({ daysOld: 500 });
    const old = new Date(Date.now() - 400 * DAY);
    await db.db.insert(growthEvents).values({ name: "pricing_viewed", sessionId: "srv:old-session", userId: id, occurredAt: old });
    await db.db.insert(growthMailLog).values({ userId: id, kind: "day1_guide", periodKey: "old", sentAt: old });
    const deleted = await pruneGrowthData(db.db, new Date());
    expect(deleted.events).toBeGreaterThanOrEqual(1);
    expect(deleted.mailLog).toBeGreaterThanOrEqual(1);
  });
});
