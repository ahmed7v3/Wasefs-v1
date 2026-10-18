import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adminAlertPrefs,
  adminAlerts,
  alertDeliveries,
  campaignLinks,
  experiments,
  growthEvents,
  growthMailLog,
  growthRules,
  notificationPrefs,
  phiAccessSessions,
  promotions,
  referralCodes,
  referralPrograms,
  userNotes,
  users,
} from "../src/schema/index.js";

import { startTestDb, type TestDb } from "./db-fixture.js";
import { itHasNames, rejection, sqlState, unique, uniqueKey, type NameSpec } from "./schema-kit.js";

/*
 * Phase 3 growth measurement, admin alerts and support tooling (migration 0012). Constraint names
 * are listed by hand; every CHECK is also exercised with a violating row.
 */

const SPEC: NameSpec = {
  checks: [
    "admin_alerts_kind_check",
    "admin_alerts_severity_check",
    "admin_alerts_summary_check",
    "admin_alerts_ref_check",
    "alert_deliveries_channel_check",
    "alert_deliveries_status_check",
    "alert_deliveries_attempts_check",
    "campaign_links_slug_check",
    "campaign_links_target_path_check",
    "campaign_links_utm_check",
    "experiments_key_check",
    "experiments_flag_key_check",
    "experiments_status_check",
    "experiments_variants_check",
    "experiments_min_sample_check",
    "experiments_period_check",
    "growth_events_name_check",
    "growth_events_session_check",
    "growth_events_props_check",
    "growth_mail_log_kind_check",
    "growth_mail_log_period_key_check",
    "growth_rules_key_check",
    "growth_rules_kind_check",
    "growth_rules_condition_check",
    "growth_rules_validity_check",
    "growth_rules_per_owner_limit_check",
    "phi_access_sessions_reason_check",
    "phi_access_sessions_expires_check",
    "user_notes_body_check",
    "notification_prefs_marketing_opt_out_via_check",
    "notification_prefs_marketing_opt_out_pair_check",
  ],
  uniques: [
    "alert_deliveries_alert_admin_channel_key",
    "campaign_links_slug_key",
    "experiments_key_key",
    "growth_rules_key_key",
  ],
  indexes: [
    "admin_alerts_created_idx",
    "admin_alerts_open_idx",
    "admin_alerts_ref_idx",
    "alert_deliveries_admin_inapp_idx",
    "alert_deliveries_pending_idx",
    "growth_events_name_occurred_idx",
    "growth_events_occurred_idx",
    "growth_events_user_occurred_idx",
    "growth_mail_log_user_kind_period_key",
    "growth_mail_log_user_sent_idx",
    "growth_mail_log_sent_idx",
    "phi_access_sessions_admin_user_expires_idx",
    "user_notes_user_created_idx",
  ],
  foreignKeys: [
    ["admin_alert_prefs_user_id_users_id_fk", "cascade"],
    ["admin_alerts_resolved_by_users_id_fk", "set null"],
    ["alert_deliveries_alert_id_admin_alerts_id_fk", "cascade"],
    ["alert_deliveries_admin_user_id_users_id_fk", "cascade"],
    ["campaign_links_referral_code_id_referral_codes_id_fk", "set null"],
    ["campaign_links_created_by_users_id_fk", "set null"],
    ["experiments_created_by_users_id_fk", "set null"],
    ["growth_events_user_id_users_id_fk", "set null"],
    ["growth_mail_log_user_id_users_id_fk", "cascade"],
    ["growth_rules_promotion_id_promotions_id_fk", "set null"],
    ["phi_access_sessions_admin_user_id_users_id_fk", "restrict"],
    ["phi_access_sessions_user_id_users_id_fk", "restrict"],
    ["user_notes_user_id_users_id_fk", "restrict"],
    ["user_notes_author_id_users_id_fk", "set null"],
  ],
};

let fixture: TestDb;

beforeAll(async () => {
  fixture = await startTestDb();
}, 180_000);

afterAll(async () => {
  await fixture?.stop();
});

const db = () => fixture.handle.db;
const bad = (value: unknown): never => value as never;
const DAY = 86_400_000;

async function one<T>(rows: Promise<T[]>): Promise<T> {
  const [row] = await rows;
  if (!row) throw new Error("insert returned no row");
  return row;
}

const newUser = () =>
  one(
    db()
      .insert(users)
      .values({ name: "Test", email: `${unique("user")}@example.com` })
      .returning(),
  );
const newAlert = (overrides: object = {}) =>
  one(
    db()
      .insert(adminAlerts)
      .values({
        kind: "payment.review_needed",
        summary: "Payment WSO-2026-000001",
        ...overrides,
      } as never)
      .returning(),
  );

const ctx = {} as { admin: typeof users.$inferSelect; user: typeof users.$inferSelect };

beforeAll(async () => {
  ctx.admin = await newUser();
  ctx.user = await newUser();
}, 180_000);

type Case = readonly [constraint: string, run: () => Promise<unknown>];

function checkCases(): Case[] {
  const alert = (overrides: object = {}) =>
    ({
      kind: "payment.review_needed",
      summary: "Payment WSO-2026-000001",
      ...overrides,
    }) as typeof adminAlerts.$inferInsert;
  const delivery = async (overrides: object = {}) =>
    ({
      alertId: (await newAlert()).id,
      adminUserId: ctx.admin.id,
      channel: "in_app",
      ...overrides,
    }) as typeof alertDeliveries.$inferInsert;
  const event = (overrides: object = {}) =>
    ({
      name: "pricing_viewed",
      sessionId: "session-0001",
      ...overrides,
    }) as typeof growthEvents.$inferInsert;
  const rule = (overrides: object = {}) =>
    ({
      key: uniqueKey("rule"),
      name: "Welcome",
      kind: "welcome",
      validityHours: 48,
      ...overrides,
    }) as typeof growthRules.$inferInsert;
  const experiment = (overrides: object = {}) =>
    ({
      key: uniqueKey("exp"),
      name: "Annual first",
      flagKey: "pricing.annual_first",
      variants: [
        { key: "control", weight: 50 },
        { key: "annual", weight: 50 },
      ],
      ...overrides,
    }) as typeof experiments.$inferInsert;
  const phi = (overrides: object = {}) =>
    ({
      adminUserId: ctx.admin.id,
      userId: ctx.user.id,
      reason: "support_request",
      expiresAt: new Date(Date.now() + 30 * 60_000),
      ...overrides,
    }) as typeof phiAccessSessions.$inferInsert;
  const campaign = (overrides: object = {}) =>
    ({ slug: unique("promo"), name: "Spring", ...overrides }) as typeof campaignLinks.$inferInsert;

  return [
    [
      "admin_alerts_kind_check",
      () =>
        db()
          .insert(adminAlerts)
          .values(alert({ kind: "payment.lost" })),
    ],
    [
      "admin_alerts_severity_check",
      () =>
        db()
          .insert(adminAlerts)
          .values(alert({ severity: "panic" })),
    ],
    [
      "admin_alerts_summary_check",
      () =>
        db()
          .insert(adminAlerts)
          .values(alert({ summary: "" })),
    ],
    [
      "admin_alerts_ref_check",
      () =>
        db()
          .insert(adminAlerts)
          .values(alert({ refType: "payment" })),
    ],
    [
      "alert_deliveries_channel_check",
      async () =>
        db()
          .insert(alertDeliveries)
          .values(await delivery({ channel: "sms" })),
    ],
    [
      "alert_deliveries_status_check",
      async () =>
        db()
          .insert(alertDeliveries)
          .values(await delivery({ status: "lost" })),
    ],
    [
      "alert_deliveries_attempts_check",
      async () =>
        db()
          .insert(alertDeliveries)
          .values(await delivery({ attempts: -1 })),
    ],
    [
      "growth_events_name_check",
      () =>
        db()
          .insert(growthEvents)
          .values(event({ name: "page_viewed" })),
    ],
    [
      "growth_events_session_check",
      () =>
        db()
          .insert(growthEvents)
          .values(event({ sessionId: "short" })),
    ],
    [
      "growth_events_props_check",
      () =>
        db()
          .insert(growthEvents)
          .values(event({ props: { note: "x".repeat(2_100) } })),
    ],
    [
      "growth_rules_key_check",
      () =>
        db()
          .insert(growthRules)
          .values(rule({ key: "K" })),
    ],
    [
      "growth_rules_kind_check",
      () =>
        db()
          .insert(growthRules)
          .values(rule({ kind: "gift" })),
    ],
    [
      "growth_rules_condition_check",
      () =>
        db()
          .insert(growthRules)
          .values(rule({ condition: bad([]) })),
    ],
    [
      "growth_rules_validity_check",
      () =>
        db()
          .insert(growthRules)
          .values(rule({ validityHours: 0 })),
    ],
    [
      "growth_rules_per_owner_limit_check",
      () =>
        db()
          .insert(growthRules)
          .values(rule({ perOwnerLimit: 0 })),
    ],
    [
      "experiments_key_check",
      () =>
        db()
          .insert(experiments)
          .values(experiment({ key: "K" })),
    ],
    [
      "experiments_flag_key_check",
      () =>
        db()
          .insert(experiments)
          .values(experiment({ flagKey: "Bad Flag" })),
    ],
    [
      "experiments_status_check",
      () =>
        db()
          .insert(experiments)
          .values(experiment({ status: "live" })),
    ],
    [
      "experiments_variants_check",
      () =>
        db()
          .insert(experiments)
          .values(experiment({ variants: [{ key: "only", weight: 100 }] })),
    ],
    [
      "experiments_min_sample_check",
      () =>
        db()
          .insert(experiments)
          .values(experiment({ minSampleSize: 0 })),
    ],
    [
      "experiments_period_check",
      () =>
        db()
          .insert(experiments)
          .values(experiment({ startedAt: new Date(), endedAt: new Date(Date.now() - DAY) })),
    ],
    [
      "user_notes_body_check",
      () => db().insert(userNotes).values({ userId: ctx.user.id, body: "  " }),
    ],
    [
      "growth_mail_log_kind_check",
      () =>
        db()
          .insert(growthMailLog)
          .values({ userId: ctx.user.id, kind: bad("newsletter"), periodKey: "once" }),
    ],
    [
      "growth_mail_log_period_key_check",
      () => db().insert(growthMailLog).values({ userId: ctx.user.id, kind: "day1_guide", periodKey: "" }),
    ],
    [
      "notification_prefs_marketing_opt_out_via_check",
      async () =>
        db()
          .insert(notificationPrefs)
          .values({
            userId: (await newUser()).id,
            marketingOptedOutAt: new Date(),
            marketingOptedOutVia: bad("telepathy"),
          }),
    ],
    [
      "notification_prefs_marketing_opt_out_pair_check",
      async () =>
        db()
          .insert(notificationPrefs)
          .values({ userId: (await newUser()).id, marketingOptedOutAt: new Date() }),
    ],
    [
      "phi_access_sessions_reason_check",
      () =>
        db()
          .insert(phiAccessSessions)
          .values(phi({ reason: "curiosity" })),
    ],
    [
      "phi_access_sessions_expires_check",
      () =>
        db()
          .insert(phiAccessSessions)
          .values(phi({ expiresAt: new Date(Date.now() - DAY) })),
    ],
    [
      "campaign_links_slug_check",
      () =>
        db()
          .insert(campaignLinks)
          .values(campaign({ slug: "A!" })),
    ],
    [
      "campaign_links_target_path_check",
      () =>
        db()
          .insert(campaignLinks)
          .values(campaign({ targetPath: "//evil.example" })),
    ],
    [
      "campaign_links_utm_check",
      () =>
        db()
          .insert(campaignLinks)
          .values(campaign({ utm: bad([]) })),
    ],
  ];
}

describe("Phase 3 growth schema: names", () => {
  itHasNames(db, SPEC);

  it("exercises every CHECK with a violating row (no check is only named, never tried)", () => {
    const covered = new Set(checkCases().map(([name]) => name));
    expect(SPEC.checks.filter((name) => !covered.has(name))).toEqual([]);
  });
});

describe("Phase 3 growth schema: CHECK constraints", () => {
  const names = checkCases().map(([name]) => name);
  it.each(names.map((name, index) => [name, index] as const))("%s", async (name, index) => {
    const entry = checkCases()[index];
    expect(entry?.[0]).toBe(name);
    expect(await rejection(() => entry?.[1]() ?? Promise.resolve())).toBe(name);
  });

  it("accepts every growth event name the funnel defines, an own-site redirect path and a valid variant list", async () => {
    const { GROWTH_EVENT_NAMES } = await import("@wasfa/shared/growth");
    await db()
      .insert(growthEvents)
      .values(
        GROWTH_EVENT_NAMES.map((name) => ({
          name,
          sessionId: "session-0001",
          props: { kind: "x" },
        })),
      );
    await db()
      .insert(campaignLinks)
      .values({ slug: unique("promo"), name: "A", targetPath: "/pricing?x=1" });
    await db()
      .insert(campaignLinks)
      .values({ slug: unique("promo"), name: "B", targetPath: "/" });
  });

  it("accepts every alert kind of BILLING §10, with dots", async () => {
    const { ALERT_KINDS } = await import("@wasfa/shared/billing");
    for (const kind of ALERT_KINDS) {
      await newAlert({ kind });
    }
  });
});

describe("Phase 3 growth schema: unique constraints", () => {
  it("growth mail log: one mail per user, kind and period", async () => {
    const user = await newUser();
    const row = { userId: user.id, kind: "day3_value" as const, periodKey: "once" };
    await db().insert(growthMailLog).values(row);
    expect(await rejection(() => db().insert(growthMailLog).values(row))).toBe(
      "growth_mail_log_user_kind_period_key",
    );
    await db()
      .insert(growthMailLog)
      .values({ ...row, periodKey: "2026-11" });
  });

  it("alert deliveries: one per alert, admin and channel", async () => {
    const alert = await newAlert();
    const row = { alertId: alert.id, adminUserId: ctx.admin.id, channel: "email" as const };
    await db().insert(alertDeliveries).values(row);
    expect(await rejection(() => db().insert(alertDeliveries).values(row))).toBe(
      "alert_deliveries_alert_admin_channel_key",
    );
    await db()
      .insert(alertDeliveries)
      .values({ ...row, channel: "telegram" });
    await db()
      .insert(alertDeliveries)
      .values({ ...row, adminUserId: ctx.user.id });
  });

  it("campaign links, experiments and growth rules: unique key / slug", async () => {
    const slug = unique("promo");
    await db().insert(campaignLinks).values({ slug, name: "A" });
    expect(await rejection(() => db().insert(campaignLinks).values({ slug, name: "B" }))).toBe(
      "campaign_links_slug_key",
    );
    const experiment = {
      key: uniqueKey("exp"),
      name: "E",
      flagKey: "pricing.test",
      variants: [
        { key: "a", weight: 50 },
        { key: "b", weight: 50 },
      ],
    };
    await db().insert(experiments).values(experiment);
    expect(await rejection(() => db().insert(experiments).values(experiment))).toBe(
      "experiments_key_key",
    );
    const rule = { key: uniqueKey("rule"), name: "R", kind: "welcome" as const, validityHours: 48 };
    await db().insert(growthRules).values(rule);
    expect(await rejection(() => db().insert(growthRules).values(rule))).toBe(
      "growth_rules_key_key",
    );
  });

  it("admin alert preferences: one row per admin, WhatsApp off by default", async () => {
    await db().insert(adminAlertPrefs).values({ userId: ctx.admin.id });
    const [prefs] = await db()
      .select()
      .from(adminAlertPrefs)
      .where(eq(adminAlertPrefs.userId, ctx.admin.id));
    expect(prefs).toMatchObject({
      inAppEnabled: true,
      emailEnabled: true,
      telegramEnabled: true,
      whatsappEnabled: false,
      mutedKinds: [],
    });
    expect(
      await sqlState(
        db().execute(sql`insert into admin_alert_prefs (user_id) values (${ctx.admin.id})`),
      ),
    ).toBe("23505");
  });
});

describe("Phase 3 growth schema: foreign-key behaviour", () => {
  it("deleting an alert removes its deliveries", async () => {
    const alert = await newAlert();
    await db()
      .insert(alertDeliveries)
      .values({ alertId: alert.id, adminUserId: ctx.admin.id, channel: "in_app" });
    await db().execute(sql`delete from admin_alerts where id = ${alert.id}`);
    expect(
      await db().select().from(alertDeliveries).where(eq(alertDeliveries.alertId, alert.id)),
    ).toEqual([]);
  });

  it("notes and PHI access windows pin their users: neither the subject nor the admin can be deleted", async () => {
    const subject = await newUser();
    const admin = await newUser();
    await db()
      .insert(userNotes)
      .values({ userId: subject.id, authorId: admin.id, body: "called, no answer" });
    await db()
      .insert(phiAccessSessions)
      .values({
        adminUserId: admin.id,
        userId: subject.id,
        reason: "dispute",
        expiresAt: new Date(Date.now() + 30 * 60_000),
      });
    expect(await sqlState(db().execute(sql`delete from users where id = ${subject.id}`))).toBe(
      "23001",
    );
    expect(await sqlState(db().execute(sql`delete from users where id = ${admin.id}`))).toBe(
      "23001",
    );
  });

  it("a deleted promotion or referral code detaches rules and campaign links instead of removing them", async () => {
    const promotion = await one(
      db()
        .insert(promotions)
        .values({ name: "P", titleAr: "ا", titleEn: "a", kind: "percent", value: 1_000 })
        .returning(),
    );
    const rule = await one(
      db()
        .insert(growthRules)
        .values({
          key: uniqueKey("rule"),
          name: "R",
          kind: "winback",
          validityHours: 24,
          promotionId: promotion.id,
        })
        .returning(),
    );
    await db().execute(sql`delete from promotions where id = ${promotion.id}`);
    const [keptRule] = await db().select().from(growthRules).where(eq(growthRules.id, rule.id));
    expect(keptRule?.promotionId).toBeNull();

    const program = await one(
      db()
        .insert(referralPrograms)
        .values({ key: uniqueKey("prog"), kind: "partner", nameAr: "ا", nameEn: "a" })
        .returning(),
    );
    const code = await one(
      db()
        .insert(referralCodes)
        .values({ code: "GRW00001", kind: "campaign", programId: program.id })
        .returning(),
    );
    const link = await one(
      db()
        .insert(campaignLinks)
        .values({ slug: unique("promo"), name: "L", referralCodeId: code.id })
        .returning(),
    );
    await db().execute(sql`delete from referral_codes where id = ${code.id}`);
    const [keptLink] = await db().select().from(campaignLinks).where(eq(campaignLinks.id, link.id));
    expect(keptLink?.referralCodeId).toBeNull();
  });

  it("a user's events survive the user's anonymization path (user_id set null)", async () => {
    const user = await newUser();
    const event = await one(
      db()
        .insert(growthEvents)
        .values({ name: "referral_signup", sessionId: "session-0002", userId: user.id })
        .returning(),
    );
    await db().execute(sql`delete from users where id = ${user.id}`);
    const [kept] = await db().select().from(growthEvents).where(eq(growthEvents.id, event.id));
    expect(kept?.userId).toBeNull();
  });
});
