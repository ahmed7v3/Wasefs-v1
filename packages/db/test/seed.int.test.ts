import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PERMISSION_KEYS, SYSTEM_ROLE_KEYS } from "@wasfa/shared/permissions";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  creditPackPrices,
  creditPacks,
  paymentMethods,
  payoutMethods,
  planEntitlements,
  planPrices,
  plans,
  referralPrograms,
  rewardRules,
  rolePermissions,
  roles,
  siteSettings,
  taxRules,
} from "../src/schema/index.js";
import { DEFAULT_SITE_SETTINGS, SYSTEM_ROLE_SEEDS, seedDefaults } from "../src/seed-data.js";

import { startTestDb, type TestDb } from "./db-fixture.js";

let fixture: TestDb;

beforeAll(async () => {
  fixture = await startTestDb();
}, 180_000);

afterAll(async () => {
  await fixture?.stop();
});

async function snapshot() {
  const { db } = fixture.handle;
  return {
    settings: await db.select().from(siteSettings).orderBy(asc(siteSettings.key)),
    roles: await db.select().from(roles).orderBy(asc(roles.key)),
    permissions: await db
      .select()
      .from(rolePermissions)
      .orderBy(asc(rolePermissions.roleKey), asc(rolePermissions.permission)),
  };
}

describe("seedDefaults", () => {
  it("is idempotent: a second run inserts nothing and changes nothing", async () => {
    const first = await seedDefaults(fixture.handle.db);
    expect(first.settings).toBe(DEFAULT_SITE_SETTINGS.length);
    expect(first.roles).toBe(SYSTEM_ROLE_KEYS.length);
    expect(first.rolePermissions).toBeGreaterThan(0);

    const before = await snapshot();
    expect(before.settings.map((row) => row.key)).toEqual(
      expect.arrayContaining(DEFAULT_SITE_SETTINGS.map((row) => row.key)),
    );

    expect(await seedDefaults(fixture.handle.db)).toEqual({
      settings: 0,
      roles: 0,
      rolePermissions: 0,
      plans: 0,
      planEntitlements: 0,
      aiProviders: 0,
      aiModels: 0,
      aiTaskRoutes: 0,
      billingPlans: 0,
      planPrices: 0,
      creditPacks: 0,
      creditPackPrices: 0,
      taxRules: 0,
      paymentMethods: 0,
      referralPrograms: 0,
      rewardRules: 0,
      payoutMethods: 0,
    });
    expect(await snapshot()).toEqual(before);
  });

  it("seeds every system role with its permission set, and super_admin with the whole catalog", async () => {
    await seedDefaults(fixture.handle.db);
    const { db } = fixture.handle;

    const seededRoles = await db.select().from(roles);
    expect(seededRoles.map((role) => role.key).sort()).toEqual([...SYSTEM_ROLE_KEYS].sort());
    expect(seededRoles.every((role) => role.isSystem)).toBe(true);

    for (const seed of SYSTEM_ROLE_SEEDS) {
      const granted = await db
        .select({ permission: rolePermissions.permission })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleKey, seed.key));
      expect(granted.map((row) => row.permission).sort()).toEqual([...seed.permissions].sort());
    }

    const superAdmin = await db
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleKey, "super_admin"));
    expect(superAdmin.map((row) => row.permission).sort()).toEqual([...PERMISSION_KEYS].sort());
  });

  it("never overwrites what an admin changed: edited permissions and names survive a re-seed", async () => {
    const { db } = fixture.handle;
    await seedDefaults(db);

    // An admin removes a permission from `admin`, edits `support`'s name, and grants `marketing` something extra.
    await db
      .delete(rolePermissions)
      .where(
        and(eq(rolePermissions.roleKey, "admin"), eq(rolePermissions.permission, "settings.write")),
      );
    await db.update(roles).set({ nameEn: "Help desk" }).where(eq(roles.key, "support"));
    await db.insert(rolePermissions).values({ roleKey: "marketing", permission: "audit.read" });
    const edited = await snapshot();

    expect((await seedDefaults(db)).rolePermissions).toBe(0);
    expect(await snapshot()).toEqual(edited);
  });
});

const PHASE3_PERMISSIONS = [
  "billing.read",
  "billing.write",
  "payments.review",
  "payments.refund",
  "promotions.write",
  "coupons.write",
  "referrals.read",
  "referrals.write",
  "rewards.adjust",
  "withdrawals.review",
  "withdrawals.pay",
  "deals.write",
  "users.upgrade",
  "users.read_health",
  "users.read_chats",
  "finance.export",
  "alerts.receive",
] as const;

async function grantsOf(roleKey: string): Promise<string[]> {
  const rows = await fixture.handle.db
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleKey, roleKey));
  return rows.map((row) => row.permission).sort();
}

describe("Phase 3 seed", () => {
  it("every new permission is in the catalog; super_admin holds all of them", async () => {
    for (const permission of PHASE3_PERMISSIONS) {
      expect(PERMISSION_KEYS).toContain(permission);
    }
    await seedDefaults(fixture.handle.db);
    expect(await grantsOf("super_admin")).toEqual(expect.arrayContaining([...PHASE3_PERMISSIONS]));
  });

  it("gives finance, support, marketing and admin their Phase 3 defaults, and never the health permissions", async () => {
    await seedDefaults(fixture.handle.db);
    const finance = await grantsOf("finance");
    expect(finance).toEqual(
      expect.arrayContaining([
        "billing.read",
        "billing.write",
        "payments.review",
        "payments.refund",
        "withdrawals.review",
        "withdrawals.pay",
        "finance.export",
        "alerts.receive",
      ]),
    );
    const support = await grantsOf("support");
    expect(support).toEqual(expect.arrayContaining(["billing.read", "users.upgrade"]));
    const marketing = await grantsOf("marketing");
    expect(marketing).toEqual(
      expect.arrayContaining([
        "promotions.write",
        "coupons.write",
        "referrals.read",
        "referrals.write",
        "deals.write",
      ]),
    );
    const admin = await grantsOf("admin");
    expect(admin).toEqual(
      expect.arrayContaining(["billing.write", "rewards.adjust", "users.upgrade"]),
    );
    for (const role of [finance, support, admin, marketing]) {
      expect(role).not.toContain("users.read_health");
      expect(role).not.toContain("users.read_chats");
    }
    expect(admin).not.toContain("withdrawals.pay");
  });

  it("seeds the catalog: hidden paid plans with EGP prices, packs, a disabled tax rule and the payment methods", async () => {
    await seedDefaults(fixture.handle.db);
    const { db } = fixture.handle;

    const planRows = await db.select().from(plans).orderBy(asc(plans.sort));
    const byKey = new Map(planRows.map((plan) => [plan.key, plan]));
    expect(byKey.get("plus")).toMatchObject({
      monthlyCredits: 150,
      visibility: "hidden",
      audience: "individual",
    });
    expect(byKey.get("pro")).toMatchObject({ monthlyCredits: 500, visibility: "hidden" });
    expect(byKey.get("clinic")).toMatchObject({
      monthlyCredits: 2_000,
      visibility: "hidden",
      audience: "organization",
      maxMembers: 5,
    });
    expect(byKey.get("free")).toMatchObject({ isDefault: true, visibility: "public" });

    const prices = await db
      .select({
        key: plans.key,
        months: planPrices.months,
        currency: planPrices.currency,
        amount: planPrices.amountMinor,
      })
      .from(planPrices)
      .innerJoin(plans, eq(plans.id, planPrices.planId))
      .orderBy(asc(plans.key), asc(planPrices.months));
    expect(prices).toEqual([
      { key: "clinic", months: 1, currency: "EGP", amount: 99_900 },
      { key: "clinic", months: 12, currency: "EGP", amount: 999_000 },
      { key: "plus", months: 1, currency: "EGP", amount: 9_900 },
      { key: "plus", months: 12, currency: "EGP", amount: 99_000 },
      { key: "pro", months: 1, currency: "EGP", amount: 29_900 },
      { key: "pro", months: 12, currency: "EGP", amount: 299_000 },
    ]);

    const proEntitlements = await db
      .select()
      .from(planEntitlements)
      .where(eq(planEntitlements.planId, byKey.get("pro")?.id ?? ""));
    expect(proEntitlements.find((row) => row.task === "rx_extract")).toMatchObject({
      allowed: true,
      modes: ["fast", "balanced", "deep"],
      webSearch: true,
    });
    const plusEntitlements = await db
      .select()
      .from(planEntitlements)
      .where(eq(planEntitlements.planId, byKey.get("plus")?.id ?? ""));
    expect(plusEntitlements.every((row) => !row.webSearch)).toBe(true);
    expect(plusEntitlements.find((row) => row.task === "web_search")?.allowed).toBe(false);

    const packs = await db
      .select({
        key: creditPacks.key,
        credits: creditPacks.credits,
        bonus: creditPacks.bonusCredits,
        amount: creditPackPrices.amountMinor,
      })
      .from(creditPacks)
      .innerJoin(creditPackPrices, eq(creditPackPrices.packId, creditPacks.id))
      .orderBy(asc(creditPacks.sort));
    expect(packs).toEqual([
      { key: "pack_100", credits: 100, bonus: 0, amount: 7_900 },
      { key: "pack_300", credits: 300, bonus: 30, amount: 19_900 },
      { key: "pack_1000", credits: 1_000, bonus: 150, amount: 54_900 },
    ]);

    expect(await db.select().from(taxRules)).toMatchObject([
      { country: "EG", rateBps: 1_400, mode: "inclusive", active: false },
    ]);

    const methods = await db.select().from(paymentMethods).orderBy(asc(paymentMethods.sort));
    expect(
      methods.map((method) => [method.key, method.kind, method.enabled, method.feeBps]),
    ).toEqual([
      ["kashier_card", "gateway", false, 0],
      ["instapay", "manual", true, 0],
      ["vodafone_cash", "manual", true, 0],
    ]);
    expect(methods.filter((method) => method.kind === "manual")).toMatchObject([
      { accountDisplay: "01014677026", requiresProof: true, currencies: ["EGP"], countries: null },
      { accountDisplay: "01014677026", requiresProof: true, currencies: ["EGP"], countries: null },
    ]);
  });

  it("seeds the standard referral program with the REFERRALS-REWARDS defaults, payouts disabled, rewards off", async () => {
    await seedDefaults(fixture.handle.db);
    const { db } = fixture.handle;
    const [program] = await db
      .select()
      .from(referralPrograms)
      .where(eq(referralPrograms.key, "standard"));
    expect(program).toMatchObject({ kind: "standard", active: true });

    const rules = await db
      .select()
      .from(rewardRules)
      .where(eq(rewardRules.programId, program?.id ?? ""));
    expect(
      rules
        .map((rule) => [rule.event, rule.beneficiary, rule.rewardKind, rule.value, rule.holdDays])
        .sort(),
    ).toEqual(
      [
        ["credit_pack", "referrer", "percent_of_net_bps", 500, 14],
        ["first_payment", "referrer", "percent_of_net_bps", 2_000, 14],
        ["referee_verified", "referee", "fixed_credits", 20, 0],
        ["referee_verified", "referrer", "fixed_points", 50, 3],
        ["renewal", "referrer", "percent_of_net_bps", 1_000, 14],
      ].sort(),
    );

    const payouts = await db.select().from(payoutMethods).orderBy(asc(payoutMethods.sort));
    expect(payouts.map((method) => [method.key, method.enabled])).toEqual([
      ["vodafone_cash", false],
      ["instapay", false],
    ]);

    const settings = new Map(
      (await db.select().from(siteSettings)).map((row) => [
        row.key,
        row.value as Record<string, unknown>,
      ]),
    );
    expect(settings.get("rewards")).toMatchObject({
      enabled: false,
      killSwitch: false,
      pointValueMinor: 10,
    });
    expect(settings.get("billing")).toMatchObject({
      minChargeMode: "raise",
      proofRetentionDays: 365,
    });
    expect(settings.get("billing")).not.toHaveProperty("currency");
    expect(settings.get("growth")).toMatchObject({ prompts: { maxPerSession: 1 } });
  });

  it("never touches an edited Phase 3 row: a changed price and a disabled method survive a re-seed", async () => {
    const { db } = fixture.handle;
    await seedDefaults(db);
    await db.update(planPrices).set({ amountMinor: 12_300 }).where(eq(planPrices.months, 1));
    await db
      .update(paymentMethods)
      .set({ enabled: false })
      .where(eq(paymentMethods.key, "instapay"));
    await db.delete(rewardRules);
    await db.delete(planPrices).where(eq(planPrices.months, 12));

    const result = await seedDefaults(db);
    expect(result).toMatchObject({
      planPrices: 0,
      paymentMethods: 0,
      rewardRules: 0,
      billingPlans: 0,
    });
    const prices = await db.select().from(planPrices);
    expect(prices.every((price) => price.months === 1 && price.amountMinor === 12_300)).toBe(true);
    const [instapay] = await db
      .select()
      .from(paymentMethods)
      .where(eq(paymentMethods.key, "instapay"));
    expect(instapay?.enabled).toBe(false);
    expect(await db.select().from(rewardRules)).toEqual([]);
  });
});

describe("migration 0010 data migration (new permissions for existing roles)", () => {
  /** The statement of the migration that inserts into role_permissions. */
  function dataMigration(): string {
    const file = readFileSync(
      fileURLToPath(new URL("../migrations/0010_billing_core.sql", import.meta.url)),
      "utf8",
    );
    const statement = file
      .split("--> statement-breakpoint")
      .map((part) => part.trim())
      .find((part) => part.includes('INSERT INTO "role_permissions"'));
    if (statement === undefined) throw new Error("data migration not found");
    return statement;
  }

  it("gives existing finance, support, marketing and admin roles exactly the seeded defaults, once", async () => {
    const { db } = fixture.handle;
    await seedDefaults(db);
    const expected = new Map<string, string[]>();
    for (const key of ["finance", "support", "marketing", "admin"]) {
      expected.set(key, await grantsOf(key));
    }

    // The state of a database seeded before Phase 3: no Phase 3 grants on those roles.
    await db
      .delete(rolePermissions)
      .where(
        and(
          inArray(rolePermissions.roleKey, [...expected.keys()]),
          inArray(rolePermissions.permission, [...PHASE3_PERMISSIONS]),
        ),
      );
    await db
      .insert(roles)
      .values({ key: "custom_role", nameAr: "مخصص", nameEn: "Custom", isSystem: false });
    await db
      .insert(rolePermissions)
      .values({ roleKey: "custom_role", permission: "settings.read" });

    await db.execute(sql.raw(dataMigration()));
    for (const [key, grants] of expected) {
      expect(await grantsOf(key)).toEqual(grants);
    }
    expect(await grantsOf("custom_role")).toEqual(["settings.read"]);

    // Running it again changes nothing (ON CONFLICT DO NOTHING).
    await db.execute(sql.raw(dataMigration()));
    for (const [key, grants] of expected) {
      expect(await grantsOf(key)).toEqual(grants);
    }
  });

  it("does nothing on a database without those roles (a fresh database gets them from the seed)", async () => {
    const { db } = fixture.handle;
    await db.delete(roles).where(inArray(roles.key, ["finance", "support", "marketing", "admin"]));
    await db.execute(sql.raw(dataMigration()));
    expect(await grantsOf("finance")).toEqual([]);
    expect(await grantsOf("admin")).toEqual([]);
  });
});
