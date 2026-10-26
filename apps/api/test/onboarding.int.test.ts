import { randomInt } from "node:crypto";

import { Controller, Get, Module } from "@nestjs/common";
import {
  createDb,
  onboardingProgress,
  organizationMembers,
  organizations,
  seedDefaults,
  userProfiles,
  users,
} from "@wasfa/db";
import { onboardingStateSchema } from "@wasfa/shared/schemas/onboarding";
import { WA_HEARTBEAT_KEY } from "@wasfa/shared/schemas/phone";
import { meResponseSchema } from "@wasfa/shared/schemas/user";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { TURNSTILE_VERIFY_URL } from "../src/auth/turnstile.js";
import { createApp } from "../src/bootstrap.js";
import { RequireVerified } from "../src/common/verified.guard.js";
import { RbacService } from "../src/rbac/rbac.service.js";
import { SettingsService } from "../src/settings/settings.service.js";

import {
  AuthHarness,
  PASSWORD,
  pwnedHandlers,
  testApiEnv,
  type Jar,
} from "./support/auth-harness.js";
import { auditRows, expectRateLimited } from "./support/identity-fixtures.js";
import { startInfra, type TestInfra } from "./support/infra.js";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { LightMyRequestResponse } from "fastify";

// ---------------------------------------------------------------------------------------------
// Probe routes for `@RequireVerified()`: one per way of using the decorator, one without it.
// ---------------------------------------------------------------------------------------------
@Controller("__test/tools")
class ToolsProbe {
  @Get("handler")
  @RequireVerified()
  handler() {
    return { ok: true };
  }

  @Get("open")
  open() {
    return { ok: true };
  }
}

@RequireVerified()
@Controller("__test/tools-class")
class ToolsClassProbe {
  @Get()
  tools() {
    return { ok: true };
  }
}

@Module({ controllers: [ToolsProbe, ToolsClassProbe] })
class ToolsTestModule {}

// ---------------------------------------------------------------------------------------------
const OUR_NUMBER = "201555000111";

const network = setupServer(
  ...pwnedHandlers(),
  http.post(TURNSTILE_VERIFY_URL, () => HttpResponse.json({ success: true })),
);

let infra: TestInfra;
let app: NestFastifyApplication;
let owner: ReturnType<typeof createDb>;
let redis: Redis;
let settings: SettingsService;
const harness = new AuthHarness(
  () => app,
  () => owner.db,
);

beforeAll(async () => {
  infra = await startInfra();
  network.listen({ onUnhandledRequest: "error" });
  owner = createDb({ url: infra.databaseUrl, max: 2 });
  await seedDefaults(owner.db);
  app = await createApp(
    testApiEnv(infra, {
      TURNSTILE_SECRET_KEY: "test-secret",
      WHATSAPP_NUMBER: `+${OUR_NUMBER}`,
    }),
    { extraImports: [harness.mailerModule(), ToolsTestModule], authMailer: false },
  );
  settings = app.get(SettingsService);
  redis = new Redis(infra.redisUrl, { maxRetriesPerRequest: null });
}, 180_000);

afterAll(async () => {
  network.close();
  await redis?.quit();
  await app?.close();
  await owner?.close();
  await infra?.stop();
});

beforeEach(async () => {
  // Phone verification is on offer unless a test says otherwise.
  await bridge("connected");
  await setPhoneVerification("whatsapp_inbound");
});

async function bridge(state: "connected" | "gone"): Promise<void> {
  if (state === "gone") await redis.del(WA_HEARTBEAT_KEY);
  else await redis.set(WA_HEARTBEAT_KEY, JSON.stringify({ at: Date.now(), state }), "EX", 120);
}

async function setPhoneVerification(mode: "whatsapp_inbound" | "disabled"): Promise<void> {
  const current = await settings.get("auth");
  await settings.set("auth", { ...current, phoneVerification: mode }, { actorId: null });
}

const newPhone = () => `+2010${randomInt(10_000_000, 99_999_999)}`;

/** Marks the phone as verified the way the phone flow would (Task 1.5). */
async function verifyPhone(userId: string): Promise<void> {
  await owner.db
    .update(users)
    .set({ phone: newPhone(), phoneVerified: true, phoneVerifiedAt: new Date() })
    .where(eq(users.id, userId));
}

const get = (jar: Jar) => harness.call("GET", "/onboarding", { jar });
const put = (jar: Jar, step: string, body: Record<string, unknown> = {}) =>
  harness.call("PUT", `/onboarding/${step}`, { jar, body });

const state = (res: LightMyRequestResponse) => {
  expect(res.statusCode, res.body).toBe(200);
  return onboardingStateSchema.parse(res.json());
};

async function progressOf(userId: string) {
  const [row] = await owner.db
    .select()
    .from(onboardingProgress)
    .where(eq(onboardingProgress.userId, userId));
  return row;
}

async function userOf(userId: string) {
  const [row] = await owner.db.select().from(users).where(eq(users.id, userId));
  if (!row) throw new Error("no user");
  return row;
}

const ORG = { name: "Nile Pharmacy", type: "pharmacy", country: "eg", city: "Cairo" } as const;
const INTENT = {
  profession: "pharmacist",
  usageIntent: ["pharmacy_work", "study"],
  country: "eg",
} as const;

/** Individual with a verified phone, answers given up to and including `name`. */
async function individualAtProfessionStep() {
  const user = await harness.signedInUser();
  await verifyPhone(user.userId);
  state(await put(user.jar, "account_type", { accountType: "individual" }));
  state(await put(user.jar, "name", { name: "Dr. Amal" }));
  return user;
}

/** Organization account with a verified phone, answered up to and including `name`. */
async function organizationAtOrganizationStep() {
  const user = await harness.signedInUser();
  await verifyPhone(user.userId);
  state(await put(user.jar, "account_type", { accountType: "organization" }));
  state(await put(user.jar, "name", { name: "Dr. Amal" }));
  return user;
}

async function signInAgain(email: string): Promise<Jar> {
  const jar: Jar = new Map();
  const res = await harness.call("POST", "/auth/sign-in/email", {
    body: { email, password: PASSWORD },
    jar,
  });
  if (res.statusCode !== 200) throw new Error(`sign-in failed: ${res.body}`);
  return jar;
}

describe("GET /onboarding", () => {
  it("returns the state of a new account and creates the progress row lazily", async () => {
    const user = await harness.signedInUser();
    expect(await progressOf(user.userId)).toBeUndefined();

    const res = await get(user.jar);
    const body = state(res);
    expect(body).toMatchObject({ currentStep: "account_type", done: false, completedAt: null });
    expect(body.steps).toEqual([
      { step: "account_type", status: "current", optional: false },
      { step: "phone", status: "pending", optional: false },
      { step: "name", status: "pending", optional: false },
      { step: "profession_intent", status: "pending", optional: false },
      { step: "social_follow", status: "pending", optional: true },
      { step: "plan_picker", status: "pending", optional: false },
    ]);
    expect(body.answers).toEqual({
      accountType: "individual",
      name: "Test User",
      phone: null,
      phoneVerified: false,
      phoneSkippable: false,
      organization: null,
      profession: null,
      usageIntent: [],
      country: null,
      city: null,
      plan: null,
    });
    expect(await progressOf(user.userId)).toMatchObject({
      currentStep: "account_type",
      completedSteps: [],
      completedAt: null,
    });
    // A second visit reuses the row.
    expect((await get(user.jar)).statusCode).toBe(200);
  });

  it("is unauthenticated -> 401", async () => {
    const res = await get(new Map());
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("is rate limited to 60 a minute", async () => {
    const user = await harness.signedInUser();
    await expectRateLimited(harness, { method: "GET", url: "/onboarding", max: 60, jar: user.jar });
  });
});

describe("PUT /onboarding/:step access and input", () => {
  it("is unauthenticated -> 401", async () => {
    const res = await put(new Map(), "account_type", { accountType: "individual" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an unknown step and `done`", async () => {
    const user = await harness.signedInUser();
    for (const step of ["bogus", "done"]) {
      const res = await put(user.jar, step, {});
      expect(res.statusCode, step).toBe(400);
      expect(res.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    }
  });

  it("rejects an invalid body for every step, before looking at the account's state", async () => {
    const user = await harness.signedInUser();
    const invalid: [string, Record<string, unknown>][] = [
      ["account_type", { accountType: "company" }],
      ["account_type", {}],
      ["name", { name: "" }],
      ["name", { name: "x".repeat(101) }],
      ["organization", { name: "A", type: "pharmacy", country: "EG" }],
      ["organization", { name: "Nile", type: "shop", country: "EG" }],
      ["organization", { name: "Nile", type: "pharmacy", country: "Egypt" }],
      ["profession_intent", { ...INTENT, usageIntent: [] }],
      ["profession_intent", { ...INTENT, usageIntent: ["study", "study"] }],
      ["profession_intent", { ...INTENT, usageIntent: ["nonsense"] }],
      ["profession_intent", { ...INTENT, profession: "wizard" }],
      ["profession_intent", { profession: "doctor", usageIntent: ["study"] }],
      ["plan_picker", { plan: "pro" }],
      ["plan_picker", {}],
      ["plan_picker", { plan: "paid" }],
      ["plan_picker", { plan: "paid", planKey: "Pro Plan", months: 1 }],
      ["plan_picker", { plan: "paid", planKey: "pro", months: 0 }],
      ["plan_picker", { plan: "paid", planKey: "pro", months: 1.5 }],
      ["social_follow", { followed: "yes" }],
      ["social_follow", {}],
    ];
    for (const [step, body] of invalid) {
      const res = await put(user.jar, step, body);
      expect(res.statusCode, `${step} ${JSON.stringify(body)}`).toBe(400);
      expect(res.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    }
    // Nothing was written.
    expect((await userOf(user.userId)).accountType).toBe("individual");
  });

  it("strips unknown keys instead of storing them", async () => {
    const user = await harness.signedInUser();
    const res = await put(user.jar, "account_type", {
      accountType: "individual",
      status: "suspended",
      email: "evil@example.com",
    });
    expect(res.statusCode).toBe(200);
    expect(await userOf(user.userId)).toMatchObject({ status: "active", email: user.email });
  });

  it("is rate limited to 30 a minute", async () => {
    const user = await harness.signedInUser();
    await expectRateLimited(harness, {
      method: "PUT",
      url: "/onboarding/account_type",
      max: 30,
      jar: user.jar,
      body: { accountType: "individual" },
    });
  });
});

describe("the individual path", () => {
  it("walks every step to done, and /me follows", async () => {
    const user = await harness.signedInUser();

    let body = state(await put(user.jar, "account_type", { accountType: "individual" }));
    expect(body.currentStep).toBe("phone");

    // The phone is not verified and verification is on offer: the step cannot be passed.
    const refused = await put(user.jar, "phone");
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({
      code: "CONFLICT",
      details: { reason: "phone_not_verified" },
    });
    expect(state(await get(user.jar)).currentStep).toBe("phone");

    await verifyPhone(user.userId);
    // Verification alone moves the wizard on.
    expect(state(await get(user.jar)).currentStep).toBe("name");
    body = state(await put(user.jar, "phone"));
    expect(body.currentStep).toBe("name");
    expect(body.steps.find((s) => s.step === "phone")?.status).toBe("completed");
    // `phone` is derived, never stored as completed.
    expect((await progressOf(user.userId))?.completedSteps).not.toContain("phone");

    body = state(await put(user.jar, "name", { name: "  Dr. Amal Hassan " }));
    expect(body.currentStep).toBe("profession_intent");
    expect(body.answers.name).toBe("Dr. Amal Hassan");
    expect((await userOf(user.userId)).name).toBe("Dr. Amal Hassan");

    body = state(await put(user.jar, "profession_intent", INTENT));
    expect(body.currentStep).toBe("social_follow");
    expect(body.answers).toMatchObject({
      profession: "pharmacist",
      usageIntent: ["pharmacy_work", "study"],
      country: "EG",
      city: null,
    });
    const [profile] = await owner.db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, user.userId));
    expect(profile).toMatchObject({ profession: "pharmacist", country: "EG", city: null });

    // Mid-wizard: /me reports the same step and tools stay closed.
    const midway = meResponseSchema.parse(
      (await harness.call("GET", "/me", { jar: user.jar })).json(),
    );
    expect(midway).toMatchObject({
      onboarding: { currentStep: "social_follow", done: false },
      canUseTools: false,
    });

    body = state(await put(user.jar, "social_follow", { followed: true }));
    expect(body.currentStep).toBe("plan_picker");
    expect((await progressOf(user.userId))?.completedAt).toBeNull();

    // The plan is the last step: choosing free finishes onboarding.
    body = state(await put(user.jar, "plan_picker", { plan: "free" }));
    expect(body.answers.plan).toBe("free");
    expect(body).toMatchObject({ currentStep: "done", done: true });
    expect(body.completedAt).not.toBeNull();
    expect(body.steps.every((s) => s.status === "completed")).toBe(true);
    expect(await progressOf(user.userId)).toMatchObject({ currentStep: "done" });
    expect((await progressOf(user.userId))?.completedAt).toBeInstanceOf(Date);

    const me = meResponseSchema.parse((await harness.call("GET", "/me", { jar: user.jar })).json());
    expect(me).toMatchObject({
      onboarding: { currentStep: "done", done: true },
      canUseTools: true,
    });
  });

  it("the optional social_follow step may be skipped with followed: false", async () => {
    const user = await individualAtProfessionStep();
    state(await put(user.jar, "profession_intent", { ...INTENT, city: "Giza" }));
    const skipped = state(await put(user.jar, "social_follow", { followed: false }));
    expect(skipped.currentStep).toBe("plan_picker");
    const body = state(await put(user.jar, "plan_picker", { plan: "free" }));
    expect(body).toMatchObject({ currentStep: "done", done: true });
    expect(body.steps.find((s) => s.step === "social_follow")).toEqual({
      step: "social_follow",
      status: "skipped",
      optional: true,
    });
    expect(body.answers.city).toBe("Giza");
  });

  it("records a paid choice as an intent and finishes onboarding; free clears it", async () => {
    const user = await individualAtProfessionStep();
    state(await put(user.jar, "profession_intent", INTENT));
    state(await put(user.jar, "social_follow", { followed: false }));
    const body = state(
      await put(user.jar, "plan_picker", { plan: "paid", planKey: "pro", months: 12 }),
    );
    expect(body).toMatchObject({ currentStep: "done", done: true });
    expect(body.answers.plan).toBe("paid");
    expect(body.completedAt).not.toBeNull();
    expect((await progressOf(user.userId))?.data).toMatchObject({
      plan: "paid",
      planKey: "pro",
      months: 12,
    });
  });

  it("refuses every further answer once onboarding is complete", async () => {
    const user = await individualAtProfessionStep();
    state(await put(user.jar, "profession_intent", INTENT));
    state(await put(user.jar, "social_follow", { followed: true }));
    state(await put(user.jar, "plan_picker", { plan: "free" }));

    const res = await put(user.jar, "name", { name: "Changed" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ details: { reason: "onboarding_complete" } });
    expect((await userOf(user.userId)).name).toBe("Dr. Amal");
  });

  it("refuses the organization step for an individual", async () => {
    const user = await individualAtProfessionStep();
    const res = await put(user.jar, "organization", ORG);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ details: { reason: "step_not_applicable" } });
    const orgs = await owner.db
      .select()
      .from(organizations)
      .where(eq(organizations.createdBy, user.userId));
    expect(orgs).toEqual([]);
  });
});

describe("order", () => {
  it("refuses a step beyond the current one and writes nothing", async () => {
    const user = await harness.signedInUser();
    for (const [step, body] of [
      ["name", { name: "Too Early" }],
      ["profession_intent", INTENT],
      ["social_follow", { followed: true }],
      ["plan_picker", { plan: "free" }],
    ] as const) {
      const res = await put(user.jar, step, body);
      expect(res.statusCode, step).toBe(409);
      expect(res.json()).toMatchObject({
        code: "CONFLICT",
        details: { reason: "step_out_of_order" },
      });
    }
    expect((await userOf(user.userId)).name).toBe("Test User");
    expect(
      await owner.db.select().from(userProfiles).where(eq(userProfiles.userId, user.userId)),
    ).toEqual([]);
  });

  it("a step answered earlier can be answered again (back button) without moving the wizard", async () => {
    const user = await individualAtProfessionStep();
    const body = state(await put(user.jar, "name", { name: "Better Name" }));
    expect(body.currentStep).toBe("profession_intent");
    expect(body.answers.name).toBe("Better Name");
    state(await put(user.jar, "account_type", { accountType: "individual" }));
    expect(state(await get(user.jar)).currentStep).toBe("profession_intent");
  });

  it("switching to organization before the organization step adds that step", async () => {
    const user = await individualAtProfessionStep();
    const body = state(await put(user.jar, "account_type", { accountType: "organization" }));
    expect(body.currentStep).toBe("organization");
    expect(body.answers.accountType).toBe("organization");
    expect((await userOf(user.userId)).accountType).toBe("organization");
    // And back again, as long as no organization exists.
    expect(
      state(await put(user.jar, "account_type", { accountType: "individual" })).currentStep,
    ).toBe("profession_intent");
  });
});

describe("the organization path", () => {
  it("creates the organization and its admin membership, audits it, and refreshes access", async () => {
    const user = await organizationAtOrganizationStep();
    const rbac = app.get(RbacService);
    // Warm the cache with the "no organizations" answer; the step must bust it.
    expect((await rbac.resolve(user.userId)).orgIds).toEqual([]);

    let body = state(await get(user.jar));
    expect(body.currentStep).toBe("organization");
    expect(body.steps.map((s) => s.step)).toContain("organization");

    body = state(await put(user.jar, "organization", ORG));
    expect(body.currentStep).toBe("profession_intent");
    const org = body.answers.organization;
    expect(org).toMatchObject({
      name: "Nile Pharmacy",
      type: "pharmacy",
      country: "EG",
      city: "Cairo",
    });

    const [row] = await owner.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, org?.id ?? ""));
    expect(row).toMatchObject({ createdBy: user.userId, name: "Nile Pharmacy", country: "EG" });
    const members = await owner.db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.orgId, org?.id ?? ""));
    expect(members).toMatchObject([{ userId: user.userId, role: "org_admin" }]);
    expect((await progressOf(user.userId))?.data).toMatchObject({ orgId: org?.id });
    expect((await rbac.resolve(user.userId)).orgIds).toEqual([org?.id]);

    const me = meResponseSchema.parse((await harness.call("GET", "/me", { jar: user.jar })).json());
    expect(me.organizations).toEqual([
      { id: org?.id, name: "Nile Pharmacy", type: "pharmacy", role: "org_admin" },
    ]);

    const [audit] = await auditRows(owner.db, "org.create", user.userId);
    expect(audit).toMatchObject({
      targetType: "org",
      targetId: org?.id,
      after: { name: "Nile Pharmacy", type: "pharmacy", country: "EG", city: "Cairo" },
    });
  });

  it("answering again updates the same organization instead of creating another", async () => {
    const user = await organizationAtOrganizationStep();
    const first = state(await put(user.jar, "organization", ORG)).answers.organization;
    const second = state(
      await put(user.jar, "organization", { name: "Nile Clinic", type: "clinic", country: "EG" }),
    ).answers.organization;

    expect(second).toMatchObject({
      id: first?.id,
      name: "Nile Clinic",
      type: "clinic",
      city: null,
    });
    const orgs = await owner.db
      .select()
      .from(organizations)
      .where(eq(organizations.createdBy, user.userId));
    expect(orgs).toHaveLength(1);

    const [audit] = await auditRows(owner.db, "org.update", user.userId);
    expect(audit).toMatchObject({
      targetId: first?.id,
      before: { name: "Nile Pharmacy", type: "pharmacy", city: "Cairo" },
      after: { name: "Nile Clinic", type: "clinic", city: null },
    });
    expect(await auditRows(owner.db, "org.create", user.userId)).toHaveLength(1);
  });

  it("two simultaneous first submissions create exactly one organization", async () => {
    const user = await organizationAtOrganizationStep();
    const [a, b] = await Promise.all([
      put(user.jar, "organization", ORG),
      put(user.jar, "organization", { ...ORG, name: "Nile Pharmacy 2" }),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    const orgs = await owner.db
      .select()
      .from(organizations)
      .where(eq(organizations.createdBy, user.userId));
    expect(orgs).toHaveLength(1);
  });

  it("creates a new organization when the caller is no longer admin of the earlier one", async () => {
    const user = await organizationAtOrganizationStep();
    const first = state(await put(user.jar, "organization", ORG)).answers.organization;
    await owner.db
      .update(organizationMembers)
      .set({ role: "org_member" })
      .where(eq(organizationMembers.orgId, first?.id ?? ""));

    const second = state(await put(user.jar, "organization", ORG)).answers.organization;
    expect(second?.id).not.toBe(first?.id);
    // The old organization is untouched.
    const [old] = await owner.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, first?.id ?? ""));
    expect(old?.name).toBe("Nile Pharmacy");
  });

  it("does not show an organization the caller has left", async () => {
    const user = await organizationAtOrganizationStep();
    const org = state(await put(user.jar, "organization", ORG)).answers.organization;
    await owner.db.delete(organizationMembers).where(eq(organizationMembers.orgId, org?.id ?? ""));
    expect(state(await get(user.jar)).answers.organization).toBeNull();
  });

  it("walks every step to done, organization included", async () => {
    const user = await organizationAtOrganizationStep();
    state(await put(user.jar, "organization", ORG));
    state(await put(user.jar, "profession_intent", INTENT));
    state(await put(user.jar, "social_follow", { followed: true }));
    const done = state(await put(user.jar, "plan_picker", { plan: "free" }));
    expect(done).toMatchObject({ currentStep: "done", done: true });
    expect(done.steps.map((s) => s.step)).toContain("organization");
  });

  it("cannot become an individual account once the organization exists", async () => {
    const user = await organizationAtOrganizationStep();
    state(await put(user.jar, "organization", ORG));

    const locked = await put(user.jar, "account_type", { accountType: "individual" });
    expect(locked.statusCode).toBe(409);
    expect(locked.json()).toMatchObject({ details: { reason: "account_type_locked" } });
    expect((await userOf(user.userId)).accountType).toBe("organization");

    // Confirming the same type is harmless.
    expect((await put(user.jar, "account_type", { accountType: "organization" })).statusCode).toBe(
      200,
    );
  });

  it("refuses the organization step before its turn", async () => {
    const user = await harness.signedInUser();
    state(await put(user.jar, "account_type", { accountType: "organization" }));
    const res = await put(user.jar, "organization", ORG);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ details: { reason: "step_out_of_order" } });
  });
});

describe("the phone step", () => {
  it("is skipped when verification is switched off and the email is verified", async () => {
    await setPhoneVerification("disabled");
    const user = await harness.signedInUser();

    let body = state(await get(user.jar));
    expect(body.answers).toMatchObject({ phoneSkippable: true, phoneVerified: false });
    body = state(await put(user.jar, "account_type", { accountType: "individual" }));
    expect(body.steps.find((s) => s.step === "phone")?.status).toBe("skipped");
    expect(body.currentStep).toBe("name");

    // The phone step itself also passes, without a verified phone.
    expect((await put(user.jar, "phone")).statusCode).toBe(200);
    expect(state(await put(user.jar, "name", { name: "No Phone" })).currentStep).toBe(
      "profession_intent",
    );
  });

  it("is skipped when the WhatsApp bridge is down", async () => {
    await bridge("gone");
    const user = await harness.signedInUser();
    const body = state(await put(user.jar, "account_type", { accountType: "individual" }));
    expect(body.currentStep).toBe("name");
    expect(body.answers.phoneSkippable).toBe(true);
  });

  it("cannot be skipped when the email is not verified either", async () => {
    await setPhoneVerification("disabled");
    const user = await harness.signedInUser();
    await owner.db.update(users).set({ emailVerified: false }).where(eq(users.id, user.userId));

    const body = state(await put(user.jar, "account_type", { accountType: "individual" }));
    expect(body.currentStep).toBe("phone");
    expect(body.answers.phoneSkippable).toBe(false);
    const res = await put(user.jar, "phone");
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ details: { reason: "phone_not_verified" } });
  });

  it("cannot be skipped while verification is available", async () => {
    const user = await harness.signedInUser();
    const body = state(await put(user.jar, "account_type", { accountType: "individual" }));
    expect(body.currentStep).toBe("phone");
    expect(body.answers.phoneSkippable).toBe(false);
  });

  it("is completed by a verified phone", async () => {
    const user = await harness.signedInUser();
    await verifyPhone(user.userId);
    const body = state(await put(user.jar, "account_type", { accountType: "individual" }));
    expect(body.steps.find((s) => s.step === "phone")?.status).toBe("completed");
    expect(body.answers.phoneVerified).toBe(true);
    expect(body.answers.phone).toMatch(/^\+2010/);
  });

  it("a finished account stays finished when phone verification is switched back on", async () => {
    await setPhoneVerification("disabled");
    const user = await harness.signedInUser();
    state(await put(user.jar, "account_type", { accountType: "individual" }));
    state(await put(user.jar, "name", { name: "Skipper" }));
    state(await put(user.jar, "profession_intent", INTENT));
    state(await put(user.jar, "social_follow", { followed: true }));
    state(await put(user.jar, "plan_picker", { plan: "free" }));

    await setPhoneVerification("whatsapp_inbound");
    expect(state(await get(user.jar))).toMatchObject({ currentStep: "done", done: true });
    const me = meResponseSchema.parse((await harness.call("GET", "/me", { jar: user.jar })).json());
    expect(me.onboarding).toEqual({ currentStep: "done", done: true });
  });
});

describe("resume", () => {
  it("returns the same step and answers after sign-out and sign-in mid-wizard", async () => {
    const user = await organizationAtOrganizationStep();
    state(await put(user.jar, "organization", ORG));
    const before = state(await get(user.jar));
    expect(before.currentStep).toBe("profession_intent");

    const out = await harness.call("POST", "/auth/sign-out", { jar: user.jar });
    expect(out.statusCode).toBe(200);
    expect((await get(user.jar)).statusCode).toBe(401);

    const jar = await signInAgain(user.email);
    const after = state(await get(jar));
    expect(after).toEqual(before);
    expect(after.answers.organization).toMatchObject({ name: "Nile Pharmacy" });

    // And it carries on from there.
    expect(state(await put(jar, "profession_intent", INTENT)).currentStep).toBe("social_follow");
  });
});

describe("@RequireVerified()", () => {
  const tools = (jar: Jar, path = "/__test/tools/handler") => harness.call("GET", path, { jar });

  async function finishedUser() {
    const user = await individualAtProfessionStep();
    state(await put(user.jar, "profession_intent", INTENT));
    state(await put(user.jar, "social_follow", { followed: true }));
    state(await put(user.jar, "plan_picker", { plan: "free" }));
    return user;
  }

  it("is unauthenticated -> 401", async () => {
    expect((await tools(new Map())).statusCode).toBe(401);
  });

  it("lets a verified account with finished onboarding in, on a handler and on a class", async () => {
    const user = await finishedUser();
    expect((await tools(user.jar)).statusCode).toBe(200);
    expect((await tools(user.jar, "/__test/tools-class")).statusCode).toBe(200);
  });

  it("refuses a verified account that has not finished onboarding", async () => {
    const user = await harness.signedInUser();
    for (const path of ["/__test/tools/handler", "/__test/tools-class"]) {
      const res = await tools(user.jar, path);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({
        code: "FORBIDDEN",
        details: { reason: "onboarding_required" },
      });
    }
    // Half-way is not enough either.
    const half = await individualAtProfessionStep();
    expect((await tools(half.jar)).json()).toMatchObject({
      details: { reason: "onboarding_required" },
    });
  });

  it("refuses an account with neither email nor phone verified, even after onboarding", async () => {
    const user = await finishedUser();
    await owner.db
      .update(users)
      .set({ emailVerified: false, phoneVerified: false, phoneVerifiedAt: null })
      .where(eq(users.id, user.userId));
    for (const path of ["/__test/tools/handler", "/__test/tools-class"]) {
      const res = await tools(user.jar, path);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({
        code: "FORBIDDEN",
        details: { reason: "verification_required" },
      });
    }
  });

  it("asks for verification first when both are missing", async () => {
    const user = await harness.signedInUser();
    await owner.db.update(users).set({ emailVerified: false }).where(eq(users.id, user.userId));
    expect((await tools(user.jar)).json()).toMatchObject({
      details: { reason: "verification_required" },
    });
  });

  it("accepts a verified phone without a verified email", async () => {
    const user = await finishedUser();
    await owner.db.update(users).set({ emailVerified: false }).where(eq(users.id, user.userId));
    // individualAtProfessionStep verified the phone.
    expect((await tools(user.jar)).statusCode).toBe(200);
  });

  it("accepts a verified email without a verified phone", async () => {
    await setPhoneVerification("disabled");
    const user = await harness.signedInUser();
    state(await put(user.jar, "account_type", { accountType: "individual" }));
    state(await put(user.jar, "name", { name: "Email Only" }));
    state(await put(user.jar, "profession_intent", INTENT));
    state(await put(user.jar, "social_follow", { followed: false }));
    state(await put(user.jar, "plan_picker", { plan: "free" }));
    expect((await userOf(user.userId)).phoneVerified).toBe(false);
    expect((await tools(user.jar)).statusCode).toBe(200);
  });

  it("does nothing on routes that do not ask for it", async () => {
    const user = await harness.signedInUser();
    await owner.db.update(users).set({ emailVerified: false }).where(eq(users.id, user.userId));
    expect((await tools(user.jar, "/__test/tools/open")).statusCode).toBe(200);
  });
});
