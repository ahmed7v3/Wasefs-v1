import { randomUUID } from "node:crypto";

import { creditLedger, creditWallets, orders, planEntitlements, plans } from "@wasfa/db";
import {
  adminAdjustResponseSchema,
  adminCreditWalletPageSchema,
  creditLedgerPageSchema,
  meCreditsResponseSchema,
} from "@wasfa/shared/schemas/credits";
import {
  planAssignmentPageSchema,
  planAssignmentSchema,
  planListResponseSchema,
  planViewSchema,
  type PlanView,
} from "@wasfa/shared/schemas/plans";
import { publicSettingsSchema } from "@wasfa/shared/settings";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CreditsService } from "../src/credits/credits.service.js";
import { PlansService } from "../src/plans/plans.service.js";

import { AdminTestContext, MISSING_ID, type Admin, type Person } from "./support/admin-context.js";
import { auditRows, expectRateLimited, insertOrg } from "./support/identity-fixtures.js";

import type { Permission } from "@wasfa/shared/permissions";
import type { LightMyRequestResponse } from "fastify";

const ctx = new AdminTestContext();
let credits: CreditsService;
let plansService: PlansService;
let boss: Admin;
let counter = 0;

beforeAll(async () => {
  await ctx.start();
  credits = ctx.app.get(CreditsService);
  plansService = ctx.app.get(PlansService);
  boss = await ctx.admin("super_admin");
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Body = Record<string, unknown> | readonly unknown[];
const call = (method: Method, url: string, who: { jar: Person["jar"] }, body?: Body) =>
  ctx.harness.call(method, url, { jar: who.jar, ...(body ? { body } : {}) });

function expectError(res: LightMyRequestResponse, status: number, code: string, reason?: string) {
  expect(res.statusCode, res.body).toBe(status);
  expect(res.json()).toMatchObject({ code, ...(reason ? { details: { reason } } : {}) });
}

const uniqueKey = () => `plan_${String(++counter)}_${randomUUID().slice(0, 6).replaceAll("-", "")}`;
const REASON = "Pilot customer, approved by support";

async function createPlan(extra: Record<string, unknown> = {}): Promise<PlanView> {
  const res = await call("POST", "/admin/plans", boss, {
    key: uniqueKey(),
    nameAr: "باقة اختبار",
    nameEn: "Test plan",
    monthlyCredits: 10,
    ...extra,
  });
  expect(res.statusCode, res.body).toBe(201);
  return planViewSchema.parse(res.json());
}

async function listPlans(): Promise<PlanView[]> {
  const res = await call("GET", "/admin/plans", boss);
  expect(res.statusCode, res.body).toBe(200);
  return planListResponseSchema.parse(res.json()).items;
}

const defaultPlanKey = async () => (await listPlans()).filter((plan) => plan.isDefault);

async function newUser(name = "Credits Person") {
  const id = await ctx.insertUser({ name, email: `c${randomUUID().slice(0, 8)}@example.com` });
  return { type: "user" as const, id };
}

const ENTITLEMENT = {
  task: "chat",
  allowed: true,
  modes: ["fast"],
  dailyCap: 5,
  monthlyCap: null,
  maxPagesPerRx: null,
  webSearch: false,
};

interface Route {
  name: string;
  method: Method;
  url: string;
  needs: Permission;
  max: number;
  fresh: boolean;
  body?: Body;
}

const ROUTES: Route[] = [
  {
    name: "plans list",
    method: "GET",
    url: "/admin/plans",
    needs: "plans.read",
    max: 120,
    fresh: false,
  },
  {
    name: "assignments list",
    method: "GET",
    url: "/admin/plans/assignments",
    needs: "plans.read",
    max: 120,
    fresh: false,
  },
  {
    name: "plan create",
    method: "POST",
    url: "/admin/plans",
    needs: "plans.write",
    max: 30,
    fresh: true,
    body: { key: "matrix_plan", nameAr: "ا", nameEn: "a", monthlyCredits: 1 },
  },
  {
    name: "plan update",
    method: "PATCH",
    url: `/admin/plans/${MISSING_ID}`,
    needs: "plans.write",
    max: 30,
    fresh: true,
    body: { sort: 1 },
  },
  {
    name: "plan entitlements",
    method: "PUT",
    url: `/admin/plans/${MISSING_ID}/entitlements`,
    needs: "plans.write",
    max: 30,
    fresh: true,
    body: [ENTITLEMENT],
  },
  {
    name: "plan delete",
    method: "DELETE",
    url: `/admin/plans/${MISSING_ID}`,
    needs: "plans.write",
    max: 30,
    fresh: true,
  },
  {
    name: "plan assign",
    method: "POST",
    url: "/admin/plans/assignments",
    needs: "plans.write",
    max: 30,
    fresh: true,
    body: { owner: { type: "user", id: MISSING_ID }, planId: MISSING_ID, reason: REASON },
  },
  {
    name: "assignment end",
    method: "POST",
    url: `/admin/plans/assignments/${MISSING_ID}/end`,
    needs: "plans.write",
    max: 30,
    fresh: true,
  },
  {
    name: "wallets list",
    method: "GET",
    url: "/admin/credits/wallets",
    needs: "usage.read",
    max: 120,
    fresh: false,
  },
  {
    name: "wallet ledger",
    method: "GET",
    url: `/admin/credits/wallets/${MISSING_ID}/ledger`,
    needs: "usage.read",
    max: 120,
    fresh: false,
  },
  {
    name: "credits adjust",
    method: "POST",
    url: "/admin/credits/adjust",
    needs: "credits.adjust",
    max: 30,
    fresh: true,
    body: {
      owner: { type: "user", id: MISSING_ID },
      delta: 1,
      reason: REASON,
      idempotencyKey: MISSING_ID,
    },
  },
];

const send = (route: Route, who?: { jar: Person["jar"] }) =>
  ctx.harness.call(route.method, route.url, {
    ...(who ? { jar: who.jar } : {}),
    ...(route.body ? { body: route.body } : {}),
  });

describe("every plan and credits admin route", () => {
  const lacking = new Map<Permission, Admin>();
  let noSecondFactor: Person;
  let plain: Person;

  beforeAll(async () => {
    noSecondFactor = await ctx.adminWithoutTwoFactor("super_admin");
    plain = await ctx.harness.signedInUser();
    for (const permission of new Set(ROUTES.map((route) => route.needs))) {
      lacking.set(permission, await ctx.admin(await ctx.roleLacking(permission)));
    }
  }, 180_000);

  for (const route of ROUTES) {
    describe(`${route.method} ${route.name}`, () => {
      it("answers 401 without a session", async () => {
        expectError(await send(route), 401, "AUTH_REQUIRED");
      });

      it("answers 403 to a user without any role", async () => {
        expectError(await send(route, plain), 403, "FORBIDDEN");
      });

      it(`answers 403 to an admin holding everything except ${route.needs}`, async () => {
        const admin = lacking.get(route.needs);
        if (!admin) throw new Error("fixture missing");
        expectError(await send(route, admin), 403, "FORBIDDEN");
      });

      it("answers 403 two_factor_required without a second factor", async () => {
        expectError(await send(route, noSecondFactor), 403, "FORBIDDEN", "two_factor_required");
      });

      it(route.fresh ? "asks for a fresh login" : "does not ask for a fresh login", async () => {
        const admin = await ctx.admin("super_admin");
        await ctx.makeSessionStale(admin.userId);
        const res = await send(route, admin);
        if (route.fresh) {
          expect(res.statusCode).toBe(401);
          expect(res.json()).toMatchObject({
            code: "AUTH_REQUIRED",
            details: { reason: "reauth", maxAgeMinutes: 10 },
          });
        } else {
          expect(res.body).not.toContain("reauth");
        }
      });

      it(`limits it to ${String(route.max)} per minute`, async () => {
        await expectRateLimited(ctx.harness, {
          method: route.method,
          url: route.url,
          max: route.max,
          ...(route.body && !Array.isArray(route.body)
            ? { body: route.body as Record<string, unknown> }
            : {}),
        });
      }, 60_000);
    });
  }
});

describe("plans", () => {
  it("accepts the Phase 3 plan card metadata through PATCH", async () => {
    const created = await createPlan();
    const result = await call("PATCH", `/admin/plans/${created.id}`, boss, {
      taglineEn: "For growing teams",
      taglineAr: "للفرق النامية",
      features: [{ textAr: "ميزة", textEn: "Feature", included: true, highlight: false }],
      trialDays: 14,
      pinRecommended: true,
      maxMembers: 12,
      fairUseNoteEn: "Fair use applies",
      fairUseNoteAr: "تطبق سياسة الاستخدام العادل",
    });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json()).toMatchObject({
      taglineEn: "For growing teams",
      trialDays: 14,
      pinRecommended: true,
      maxMembers: 12,
    });
  });

  it("lists the seeded plans with their entitlements", async () => {
    const items = await listPlans();
    const free = items.find((plan) => plan.key === "free");
    expect(free).toMatchObject({ isDefault: true, monthlyCredits: 30, visibility: "public" });
    expect(free?.entitlements.find((row) => row.task === "rx_extract")).toMatchObject({
      allowed: true,
      dailyCap: 3,
      modes: ["fast", "balanced"],
    });
    expect(items.find((plan) => plan.key === "pro")).toMatchObject({
      isDefault: false,
      visibility: "hidden",
    });
  });

  it("creates a plan, audits it and refuses a repeated key", async () => {
    const created = await createPlan({ badgeEn: "New", sort: 5 });
    expect(created).toMatchObject({ isDefault: false, audience: "any", badgeEn: "New", sort: 5 });
    expect(created.entitlements).toEqual([]);

    const rows = await ctx.auditRowsFor("plan.create", created.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: boss.userId, targetType: "plan" });
    expect(rows[0]?.after).toMatchObject({ key: created.key, monthlyCredits: 10 });

    expectError(
      await call("POST", "/admin/plans", boss, {
        key: created.key,
        nameAr: "ا",
        nameEn: "a",
        monthlyCredits: 1,
      }),
      409,
      "CONFLICT",
      "plan_key_exists",
    );
  });

  it("rejects an invalid plan with 400 and stores nothing", async () => {
    const before = (await listPlans()).length;
    const bad: Record<string, unknown>[] = [
      { key: "Bad Key", nameAr: "ا", nameEn: "a", monthlyCredits: 1 },
      { key: "ok_key", nameAr: "", nameEn: "a", monthlyCredits: 1 },
      { key: "ok_key", nameAr: "ا", nameEn: "a", monthlyCredits: -1 },
      { key: "ok_key", nameAr: "ا", nameEn: "a", monthlyCredits: 1.5 },
      { key: "ok_key", nameAr: "ا", nameEn: "a", monthlyCredits: 1_000_001 },
      { key: "ok_key", nameAr: "ا", nameEn: "a", monthlyCredits: 1, badgeEn: "x".repeat(25) },
    ];
    for (const body of bad)
      expectError(await call("POST", "/admin/plans", boss, body), 400, "VALIDATION_FAILED");
    expect(await listPlans()).toHaveLength(before);
  });

  it("updates a plan and audits the before and after", async () => {
    const created = await createPlan({ monthlyCredits: 10 });
    const res = await call("PATCH", `/admin/plans/${created.id}`, boss, {
      monthlyCredits: 50,
      nameEn: "Renamed",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(planViewSchema.parse(res.json())).toMatchObject({
      monthlyCredits: 50,
      nameEn: "Renamed",
    });

    const rows = await ctx.auditRowsFor("plan.update", created.id);
    expect(rows[0]?.before).toMatchObject({ monthlyCredits: 10, nameEn: "Test plan" });
    expect(rows[0]?.after).toMatchObject({ monthlyCredits: 50, nameEn: "Renamed" });

    expectError(
      await call("PATCH", `/admin/plans/${created.id}`, boss, {}),
      400,
      "VALIDATION_FAILED",
    );
    expectError(
      await call("PATCH", `/admin/plans/${created.id}`, boss, { key: "other" }),
      400,
      "VALIDATION_FAILED",
    );
    expectError(
      await call("PATCH", `/admin/plans/${MISSING_ID}`, boss, { sort: 1 }),
      404,
      "NOT_FOUND",
    );
  });

  it("schedules a sale window, refuses an end before the start, and audits readable dates", async () => {
    const created = await createPlan();
    const res = await call("PATCH", `/admin/plans/${created.id}`, boss, {
      availableFrom: "2030-01-01T08:00:00.000Z",
      availableUntil: "2030-02-01T08:00:00.000Z",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(planViewSchema.parse(res.json())).toMatchObject({
      availableFrom: "2030-01-01T08:00:00.000Z",
      availableUntil: "2030-02-01T08:00:00.000Z",
    });
    const rows = await ctx.auditRowsFor("plan.update", created.id);
    // Slashes, not dashes: the audit redactor would read 2030-01-01 as a phone number.
    expect(rows[0]?.after).toMatchObject({
      availableFrom: "2030/01/01 08:00 UTC",
      availableUntil: "2030/02/01 08:00 UTC",
    });

    // Checked against the stored bound the patch leaves alone.
    expectError(
      await call("PATCH", `/admin/plans/${created.id}`, boss, {
        availableUntil: "2029-12-31T08:00:00.000Z",
      }),
      409,
      "CONFLICT",
      "invalid_window",
    );
    const cleared = await call("PATCH", `/admin/plans/${created.id}`, boss, {
      availableFrom: null,
      availableUntil: null,
    });
    expect(planViewSchema.parse(cleared.json())).toMatchObject({
      availableFrom: null,
      availableUntil: null,
    });
    expectError(
      await call("PATCH", `/admin/plans/${created.id}`, boss, { availableFrom: "tomorrow" }),
      400,
      "VALIDATION_FAILED",
    );
  });

  it("moves the default flag: making a plan the default unsets the old one", async () => {
    const original = (await defaultPlanKey())[0];
    expect(original).toBeDefined();
    const next = await createPlan({ isDefault: true });
    expect(next.isDefault).toBe(true);
    let defaults = await defaultPlanKey();
    expect(defaults.map((plan) => plan.id)).toEqual([next.id]);

    // Switching back through PATCH.
    const back = await call("PATCH", `/admin/plans/${original?.id ?? ""}`, boss, {
      isDefault: true,
    });
    expect(back.statusCode, back.body).toBe(200);
    defaults = await defaultPlanKey();
    expect(defaults.map((plan) => plan.id)).toEqual([original?.id]);
    expect((await plansService.effectivePlan(await newUser())).id).toBe(original?.id);
  });

  it("refuses to switch the default plan off without naming another one", async () => {
    const [current] = await defaultPlanKey();
    expectError(
      await call("PATCH", `/admin/plans/${current?.id ?? ""}`, boss, { isDefault: false }),
      409,
      "CONFLICT",
      "default_plan_required",
    );
    expect(await defaultPlanKey()).toHaveLength(1);
  });

  it("replaces the entitlements as a whole and audits it", async () => {
    const created = await createPlan();
    const res = await call("PUT", `/admin/plans/${created.id}/entitlements`, boss, [
      ENTITLEMENT,
      {
        ...ENTITLEMENT,
        task: "rx_extract",
        modes: ["fast", "balanced"],
        maxPagesPerRx: 2,
        dailyCap: null,
      },
    ]);
    expect(res.statusCode, res.body).toBe(200);
    const view = planViewSchema.parse(res.json());
    expect(view.entitlements.map((row) => row.task)).toEqual(["chat", "rx_extract"]);
    expect(view.entitlements.find((row) => row.task === "rx_extract")).toMatchObject({
      maxPagesPerRx: 2,
      dailyCap: null,
    });

    // A second PUT drops what it does not list.
    const second = await call("PUT", `/admin/plans/${created.id}/entitlements`, boss, [
      { ...ENTITLEMENT, task: "title_gen" },
    ]);
    expect(planViewSchema.parse(second.json()).entitlements.map((row) => row.task)).toEqual([
      "title_gen",
    ]);
    const stored = await ctx.owner.db
      .select()
      .from(planEntitlements)
      .where(eq(planEntitlements.planId, created.id));
    expect(stored.map((row) => row.task)).toEqual(["title_gen"]);

    const rows = await ctx.auditRowsFor("plan.entitlements", created.id);
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows[1]?.after)).toContain("rx_extract");
    expect(JSON.stringify(rows[0]?.before)).toContain("rx_extract");
  });

  it("rejects bad entitlements with 400 and keeps the old ones", async () => {
    const created = await createPlan();
    await call("PUT", `/admin/plans/${created.id}/entitlements`, boss, [ENTITLEMENT]);
    const bad: unknown[] = [
      [{ ...ENTITLEMENT, modes: [] }],
      [{ ...ENTITLEMENT, modes: ["fast", "fast"] }],
      [{ ...ENTITLEMENT, modes: ["turbo"] }],
      [{ ...ENTITLEMENT, task: "telepathy" }],
      [{ ...ENTITLEMENT, dailyCap: -1 }],
      [{ ...ENTITLEMENT, maxPagesPerRx: 5 }],
      [ENTITLEMENT, ENTITLEMENT],
      { entitlements: [ENTITLEMENT] },
    ];
    for (const body of bad) {
      expectError(
        await call("PUT", `/admin/plans/${created.id}/entitlements`, boss, body as Body),
        400,
        "VALIDATION_FAILED",
      );
    }
    // An unallowed task may list no modes.
    const off = await call("PUT", `/admin/plans/${created.id}/entitlements`, boss, [
      { ...ENTITLEMENT, allowed: false, modes: [] },
    ]);
    expect(off.statusCode, off.body).toBe(200);

    const kept = await ctx.owner.db
      .select()
      .from(planEntitlements)
      .where(eq(planEntitlements.planId, created.id));
    expect(kept).toHaveLength(1);
    expectError(
      await call("PUT", `/admin/plans/${MISSING_ID}/entitlements`, boss, [ENTITLEMENT]),
      404,
      "NOT_FOUND",
    );
  });

  it("deletes an unused plan, and refuses the default plan and plans with assignments", async () => {
    const unused = await createPlan();
    const gone = await call("DELETE", `/admin/plans/${unused.id}`, boss);
    expect(gone.statusCode, gone.body).toBe(204);
    const rows = await ctx.auditRowsFor("plan.delete", unused.id);
    expect(rows[0]?.before).toMatchObject({ key: unused.key });
    expect(await ctx.owner.db.select().from(plans).where(eq(plans.id, unused.id))).toHaveLength(0);
    expectError(await call("DELETE", `/admin/plans/${unused.id}`, boss), 404, "NOT_FOUND");

    const [current] = await defaultPlanKey();
    expectError(
      await call("DELETE", `/admin/plans/${current?.id ?? ""}`, boss),
      409,
      "CONFLICT",
      "plan_in_use",
    );

    const used = await createPlan();
    const owner = await newUser();
    const assigned = await call("POST", "/admin/plans/assignments", boss, {
      owner,
      planId: used.id,
      reason: REASON,
    });
    expect(assigned.statusCode, assigned.body).toBe(201);
    expectError(
      await call("DELETE", `/admin/plans/${used.id}`, boss),
      409,
      "CONFLICT",
      "plan_in_use",
    );
    // An order (even an unpaid one) keeps its plan too: a clear 409, not a foreign-key 500.
    const ordered = await createPlan();
    await ctx.owner.db.insert(orders).values({
      ownerUserId: owner.id,
      kind: "subscription",
      planId: ordered.id,
      months: 1,
      currency: "EGP",
      quote: {},
      quoteHash: "a".repeat(64),
      subtotalMinor: 9_900,
      totalMinor: 9_900,
      status: "pending_payment",
      paymentKind: "gateway",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    expectError(
      await call("DELETE", `/admin/plans/${ordered.id}`, boss),
      409,
      "CONFLICT",
      "plan_in_use",
    );

    // Ending the assignment does not make the plan deletable: history keeps pointing at it.
    await call(
      "POST",
      `/admin/plans/assignments/${planAssignmentSchema.parse(assigned.json()).id}/end`,
      boss,
    );
    expectError(
      await call("DELETE", `/admin/plans/${used.id}`, boss),
      409,
      "CONFLICT",
      "plan_in_use",
    );
  });
});

describe("plan assignments", () => {
  it("assigns a plan, makes it the effective plan, and ends it", async () => {
    const plan = await createPlan({ monthlyCredits: 77 });
    const owner = await newUser();
    const [fallback] = await defaultPlanKey();
    expect((await plansService.effectivePlan(owner)).id).toBe(fallback?.id);

    const res = await call("POST", "/admin/plans/assignments", boss, {
      owner,
      planId: plan.id,
      reason: REASON,
    });
    expect(res.statusCode, res.body).toBe(201);
    const assignment = planAssignmentSchema.parse(res.json());
    expect(assignment).toMatchObject({
      owner,
      plan: { id: plan.id, key: plan.key },
      endsAt: null,
      assignedBy: boss.userId,
      reason: REASON,
    });
    expect((await plansService.effectivePlan(owner)).id).toBe(plan.id);

    const audit = await ctx.auditRowsFor("plan.assign", assignment.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.after).toMatchObject({
      ownerType: "user",
      planKey: plan.key,
      reason: REASON,
    });

    const history = await call(
      "GET",
      `/admin/plans/assignments?ownerType=user&ownerId=${owner.id}`,
      boss,
    );
    const historyItems = planAssignmentPageSchema.parse(history.json()).items;
    expect(historyItems.map((row) => row.id)).toEqual([assignment.id]);
    expect(historyItems[0]).toMatchObject({
      ownerDisplay: { name: "Credits Person", email: expect.stringMatching(/^c.+@example\.com$/) },
      assignedByDisplay: { name: "Test User" },
    });
    expect(assignment).toMatchObject({
      ownerDisplay: historyItems[0]?.ownerDisplay,
      assignedByDisplay: { name: "Test User" },
    });

    const ended = await call("POST", `/admin/plans/assignments/${assignment.id}/end`, boss);
    expect(ended.statusCode, ended.body).toBe(204);
    expect((await plansService.effectivePlan(owner)).id).toBe(fallback?.id);
    const endAudit = await ctx.auditRowsFor("plan.assignment_end", assignment.id);
    expect(endAudit).toHaveLength(1);
    expect(endAudit[0]?.before).toMatchObject({ ended: false });
    expect(endAudit[0]?.after).toMatchObject({ ended: true });
    expectError(
      await call("POST", `/admin/plans/assignments/${assignment.id}/end`, boss),
      409,
      "CONFLICT",
      "assignment_ended",
    );
  });

  it("shows the organization name, and no email, for an organization owner", async () => {
    const plan = await createPlan();
    const orgId = await insertOrg(ctx.owner.db, {
      name: "Nile Pharmacy",
      createdBy: boss.userId,
      members: [{ userId: boss.userId, role: "org_admin" }],
    });
    const res = await call("POST", "/admin/plans/assignments", boss, {
      owner: { type: "org", id: orgId },
      planId: plan.id,
      reason: REASON,
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(planAssignmentSchema.parse(res.json()).ownerDisplay).toEqual({
      name: "Nile Pharmacy",
      email: null,
    });

    const list = await call("GET", `/admin/plans/assignments?ownerType=org&ownerId=${orgId}`, boss);
    const [row] = planAssignmentPageSchema.parse(list.json()).items;
    expect(row).toMatchObject({
      ownerDisplay: { name: "Nile Pharmacy", email: null },
      assignedByDisplay: { name: "Test User" },
    });
  });

  it("uses the newest open assignment, and ignores one that has not started or has ended", async () => {
    const older = await createPlan();
    const newer = await createPlan();
    const owner = await newUser();
    const day = 86_400_000;
    const post = (planId: string, extra: Record<string, unknown>) =>
      call("POST", "/admin/plans/assignments", boss, { owner, planId, reason: REASON, ...extra });

    await post(older.id, { startsAt: new Date(Date.now() - 3 * day).toISOString() });
    await post(newer.id, { startsAt: new Date(Date.now() - day).toISOString() });
    expect((await plansService.effectivePlan(owner)).id).toBe(newer.id);

    // Future and expired assignments do not count.
    const future = await createPlan();
    const expired = await createPlan();
    await post(future.id, { startsAt: new Date(Date.now() + day).toISOString() });
    await post(expired.id, {
      startsAt: new Date(Date.now() - 2 * day).toISOString(),
      endsAt: new Date(Date.now() - day / 2).toISOString(),
    });
    expect((await plansService.effectivePlan(owner)).id).toBe(newer.id);
  });

  it("refuses an end before the start, an unknown plan and an unknown owner", async () => {
    const plan = await createPlan();
    const owner = await newUser();
    const post = (body: Record<string, unknown>) =>
      call("POST", "/admin/plans/assignments", boss, body);

    expectError(
      await post({
        owner,
        planId: plan.id,
        reason: REASON,
        startsAt: new Date(Date.now() + 1000).toISOString(),
        endsAt: new Date(Date.now() - 1000).toISOString(),
      }),
      400,
      "VALIDATION_FAILED",
    );
    expectError(await post({ owner, planId: plan.id, reason: "no" }), 400, "VALIDATION_FAILED");
    expectError(await post({ owner, planId: MISSING_ID, reason: REASON }), 404, "NOT_FOUND");
    expectError(
      await post({ owner: { type: "user", id: MISSING_ID }, planId: plan.id, reason: REASON }),
      404,
      "NOT_FOUND",
    );
    expectError(
      await post({ owner: { type: "org", id: MISSING_ID }, planId: plan.id, reason: REASON }),
      404,
      "NOT_FOUND",
    );
    expectError(
      await call("POST", `/admin/plans/assignments/${MISSING_ID}/end`, boss),
      404,
      "NOT_FOUND",
    );
    expectError(
      await call("GET", "/admin/plans/assignments?ownerType=user", boss),
      400,
      "VALIDATION_FAILED",
    );
  });

  it("pages the assignment list with a cursor", async () => {
    const plan = await createPlan();
    const owner = await newUser();
    for (let i = 0; i < 3; i += 1) {
      await call("POST", "/admin/plans/assignments", boss, {
        owner,
        planId: plan.id,
        reason: REASON,
      });
    }
    const url = `/admin/plans/assignments?ownerType=user&ownerId=${owner.id}&limit=2`;
    const first = planAssignmentPageSchema.parse((await call("GET", url, boss)).json());
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = planAssignmentPageSchema.parse(
      (await call("GET", `${url}&cursor=${first.nextCursor ?? ""}`, boss)).json(),
    );
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(3);
  });
});

describe("credits admin", () => {
  it("adjusts a wallet, audits balance before and after, and a retry changes nothing", async () => {
    const owner = await newUser("Adjusted Person");
    const idempotencyKey = randomUUID();
    const body = { owner, delta: 40, reason: "Goodwill after an outage", idempotencyKey };

    const res = await call("POST", "/admin/credits/adjust", boss, body);
    expect(res.statusCode, res.body).toBe(200);
    const parsed = adminAdjustResponseSchema.parse(res.json());
    expect(parsed.wallet).toMatchObject({ owner, balance: 40, plan: { key: "free" } });
    expect(parsed.entry).toMatchObject({
      kind: "admin_adjust",
      amount: 40,
      balanceAfter: 40,
      reason: body.reason,
      actorId: boss.userId,
    });

    const again = adminAdjustResponseSchema.parse(
      (await call("POST", "/admin/credits/adjust", boss, body)).json(),
    );
    expect(again.entry.id).toBe(parsed.entry.id);
    expect(again.wallet.balance).toBe(40);

    const walletId = (await credits.ensureWallet(owner)).id;
    const rows = await auditRows(ctx.owner.db, "credits.adjust", boss.userId);
    const mine = rows.filter((row) => row.targetId === walletId);
    expect(mine).toHaveLength(2);
    const original = mine.find((row) => (row.after as { replayed?: boolean }).replayed === false);
    expect(original?.before).toMatchObject({ balance: 0, ownerType: "user" });
    expect(original?.after).toMatchObject({ balance: 40, delta: 40, reason: body.reason });
    expect(JSON.stringify(mine)).not.toContain(idempotencyKey);
  });

  it("refuses to take a wallet below zero (409) and an unknown owner (404)", async () => {
    const owner = await newUser();
    await credits.grant(owner, 5, "2026-10");
    expectError(
      await call("POST", "/admin/credits/adjust", boss, {
        owner,
        delta: -6,
        reason: "Too much",
        idempotencyKey: randomUUID(),
      }),
      409,
      "CONFLICT",
      "insufficient_balance",
    );
    expectError(
      await call("POST", "/admin/credits/adjust", boss, {
        owner: { type: "user", id: randomUUID() },
        delta: 5,
        reason: "Nobody home",
        idempotencyKey: randomUUID(),
      }),
      404,
      "NOT_FOUND",
    );
  });

  it("rejects a zero, fractional or huge delta, a short reason and a missing key", async () => {
    const owner = await newUser();
    const base = { owner, delta: 5, reason: "A fine reason", idempotencyKey: randomUUID() };
    for (const patch of [
      { delta: 0 },
      { delta: 1.5 },
      { delta: 1_000_001 },
      { delta: -1_000_001 },
      { reason: "no" },
      { reason: "x".repeat(501) },
      { idempotencyKey: "not-a-uuid" },
      { owner: { type: "team", id: owner.id } },
    ]) {
      expectError(
        await call("POST", "/admin/credits/adjust", boss, { ...base, ...patch }),
        400,
        "VALIDATION_FAILED",
      );
    }
  });

  it("lists wallets with owner and plan, filters by name and pages", async () => {
    const owner = await newUser("Searchable Zebra");
    const name = "Searchable Zebra";
    await credits.grant(owner, 9, "2026-10");

    const all = adminCreditWalletPageSchema.parse(
      (await call("GET", "/admin/credits/wallets", boss)).json(),
    );
    const mine = all.items.find((row) => row.owner.id === owner.id);
    expect(mine).toMatchObject({ balance: 9, ownerName: name, plan: { key: "free" } });
    expect(mine?.ownerEmail).toContain("@example.com");

    const filtered = adminCreditWalletPageSchema.parse(
      (await call("GET", "/admin/credits/wallets?q=zebra", boss)).json(),
    );
    expect(filtered.items.map((row) => row.owner.id)).toContain(owner.id);
    expect(filtered.items.every((row) => row.ownerName?.toLowerCase().includes("zebra"))).toBe(
      true,
    );

    const page = adminCreditWalletPageSchema.parse(
      (await call("GET", "/admin/credits/wallets?limit=1", boss)).json(),
    );
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    expectError(
      await call("GET", "/admin/credits/wallets?cursor=%25%25", boss),
      400,
      "VALIDATION_FAILED",
    );
  });

  it("shows a wallet's ledger newest first, without idempotency keys", async () => {
    const owner = await newUser();
    await credits.grant(owner, 10, "2026-10");
    const { reservation } = await credits.reserve(owner, 4, {
      idempotencyKey: randomUUID(),
      purpose: "rx",
    });
    await credits.settle(reservation.id, 3);

    const walletId = reservation.walletId;
    const res = await call("GET", `/admin/credits/wallets/${walletId}/ledger`, boss);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).not.toContain("idempotency");
    const page = creditLedgerPageSchema.parse(res.json());
    expect(page.items.map((row) => [row.kind, row.amount, row.balanceAfter])).toEqual([
      ["usage_settle", -3, 7],
      ["release", 4, 10],
      ["usage_reserve", -4, 6],
      ["grant", 10, 10],
    ]);
    expect(page.items[0]?.reservationId).toBe(reservation.id);

    const first = creditLedgerPageSchema.parse(
      (await call("GET", `/admin/credits/wallets/${walletId}/ledger?limit=3`, boss)).json(),
    );
    expect(first.items).toHaveLength(3);
    const next = creditLedgerPageSchema.parse(
      (
        await call(
          "GET",
          `/admin/credits/wallets/${walletId}/ledger?limit=3&cursor=${first.nextCursor ?? ""}`,
          boss,
        )
      ).json(),
    );
    expect(next.items.map((row) => row.kind)).toEqual(["grant"]);
    expect(next.nextCursor).toBeNull();

    expectError(
      await call("GET", `/admin/credits/wallets/${MISSING_ID}/ledger`, boss),
      404,
      "NOT_FOUND",
    );
    expectError(
      await call("GET", "/admin/credits/wallets/not-a-uuid/ledger", boss),
      400,
      "VALIDATION_FAILED",
    );
  });

  it("lets a usage.read admin look at wallets but not adjust them", async () => {
    const reader = await ctx.admin(await ctx.customRole(["usage.read"]));
    const owner = await newUser();
    const wallet = await credits.ensureWallet(owner);
    expect((await call("GET", "/admin/credits/wallets", reader)).statusCode).toBe(200);
    expect(
      (await call("GET", `/admin/credits/wallets/${wallet.id}/ledger`, reader)).statusCode,
    ).toBe(200);
    expectError(
      await call("POST", "/admin/credits/adjust", reader, {
        owner,
        delta: 5,
        reason: "Should not work",
        idempotencyKey: randomUUID(),
      }),
      403,
      "FORBIDDEN",
    );
    expect(
      await ctx.owner.db.select().from(creditLedger).where(eq(creditLedger.walletId, wallet.id)),
    ).toHaveLength(0);
  });
});

describe("GET /me/credits", () => {
  it("answers 401 without a session", async () => {
    expectError(await ctx.harness.call("GET", "/me/credits"), 401, "AUTH_REQUIRED");
  });

  it("shows a new user's zero balance, the default plan and the first of next month", async () => {
    const person = await ctx.harness.signedInUser();
    const res = await call("GET", "/me/credits", person);
    expect(res.statusCode, res.body).toBe(200);
    const body = meCreditsResponseSchema.parse(res.json());
    expect(body).toMatchObject({
      wallet: { ownerType: "user", balance: 0 },
      plan: { key: "free", nameAr: "المجانية", nameEn: "Free" },
      monthlyCredits: 30,
    });
    const now = new Date();
    expect(body.nextGrantAt).toBe(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
    );
    // Reading must not create a wallet.
    expect(
      await ctx.owner.db
        .select()
        .from(creditWallets)
        .where(eq(creditWallets.ownerUserId, person.userId)),
    ).toHaveLength(0);
  });

  it("reflects the balance and an assigned plan", async () => {
    const person = await ctx.harness.signedInUser();
    const plan = await createPlan({ monthlyCredits: 120 });
    await call("POST", "/admin/plans/assignments", boss, {
      owner: { type: "user", id: person.userId },
      planId: plan.id,
      reason: REASON,
    });
    await credits.grant({ type: "user", id: person.userId }, 33, "2026-10");

    const body = meCreditsResponseSchema.parse((await call("GET", "/me/credits", person)).json());
    expect(body.wallet.balance).toBe(33);
    expect(body.plan.key).toBe(plan.key);
    expect(body.monthlyCredits).toBe(120);
    // Another user's wallet is never reachable through this route.
    expect(JSON.stringify(body)).not.toContain(person.userId);
  });
});

describe("settings", () => {
  it("refuses the generic PUT for the ai key, even for a super admin", async () => {
    const res = await call("PUT", "/admin/settings/ai", boss, {
      value: { dailyCapUsdMicros: 99_000_000 },
    });
    expectError(res, 403, "FORBIDDEN", "use_admin_ai");
    const list = await call("GET", "/admin/settings", boss);
    const ai = list
      .json<{ items: { key: string; value: Record<string, unknown> }[] }>()
      .items.find((item) => item.key === "ai");
    expect(ai?.value).toMatchObject({
      dailyCapUsdMicros: 10_000_000,
      alertPercent: 80,
      killSwitch: { all: false, rx: false, chat: false, search: false },
      creditValueUsdMicros: 10_000,
      allowPreviewModels: false,
    });
  });

  it("still lets the generic route set rx, and serves it publicly with the ai key absent", async () => {
    const res = await call("PUT", "/admin/settings/rx", boss, {
      value: { creditsPerPage: 2, maxPages: 3, modelWarnings: false, verifyMaxItems: 7 },
    });
    expect(res.statusCode, res.body).toBe(200);

    const pub = await ctx.harness.call("GET", "/settings/public");
    expect(pub.statusCode).toBe(200);
    const settings = publicSettingsSchema.parse(pub.json());
    expect(settings.rx).toEqual({
      creditsPerPage: 2,
      maxPages: 3,
      modelWarnings: false,
      verifyMaxItems: 7,
      // Not in the PUT above: the defaults (the model reads on its own, with details).
      drugMatching: false,
      details: true,
    });
    expect(Object.keys(pub.json<Record<string, unknown>>())).not.toContain("ai");

    expectError(
      await call("PUT", "/admin/settings/rx", boss, { value: { maxPages: 5 } }),
      400,
      "VALIDATION_FAILED",
    );
    await call("PUT", "/admin/settings/rx", boss, { value: {} });
  });
});
