import { createHash, randomBytes, randomUUID } from "node:crypto";

import { skillVersion } from "@wasfa/ai";
import {
  aiTaskRoutes,
  creditLedger,
  experiments,
  files,
  growthEvents,
  notificationPrefs,
  onboardingProgress,
  personalOffers,
  plans,
  promotions,
  rxAnalyses,
  rxPages,
  siteSettings,
  subscriptions,
  tasteGrants,
  unsubscribeToken,
  users,
} from "@wasfa/db";
import { busyLockKey } from "@wasfa/shared/busy";
import { promptSessionKey, variantFor } from "@wasfa/shared/growth";
import { RX_SKILL_NAME } from "@wasfa/shared/rx";
import { RX_SCHEMA_VERSION, type RxResult, type RxResultItem } from "@wasfa/shared/schemas/rx";
import { Queue } from "bullmq";
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SettingsService } from "../src/settings/settings.service.js";

import { AdminTestContext, type Admin } from "./support/admin-context.js";
import { PASSWORD, type Jar } from "./support/auth-harness.js";
import { useUpMonthlyGrant } from "./support/monthly-grant.js";

/*
 * The conversion engine through the real app (GROWTH-STRATEGY, Task 3.14): the one prompt and its
 * guardrails, the taste of Deep mode with its ledger rows and caps, personal offers with server
 * deadlines, value and proof, first-party events, the unsubscribe link, experiments and the funnel.
 */

const ctx = new AdminTestContext();
const db = () => ctx.owner.db;
const DAY = 86_400_000;
let rxQueue: Queue;
let routeVersion: number;
let marketer: Admin;

interface Person {
  jar: Jar;
  userId: string;
}

const item = (overrides: Partial<RxResultItem> = {}): RxResultItem => ({
  rawText: "Augmentin 1g 1x3",
  name: "Augmentin 1g",
  matchedDrugId: null,
  matchScore: null,
  activeIngredients: [],
  strength: "1 g",
  form: "tablet",
  dose: null,
  frequency: null,
  duration: null,
  route: null,
  notes: null,
  confidence: 0.6,
  badge: "medium",
  verified: "not_needed",
  box_2d: null,
  page: 0,
  ...overrides,
});
const result = (items: RxResultItem[]): RxResult => ({
  schemaVersion: RX_SCHEMA_VERSION,
  items,
  date: null,
  prescriberLegible: true,
  findings: [],
  unreadableRegions: [],
  // Read without the drug database: an unmatched line may then be "high" (rxResultSchema).
  matching: "model",
});

async function setGrowth(value: Record<string, unknown>): Promise<void> {
  await db()
    .insert(siteSettings)
    .values({ key: "growth", value })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value } });
  await ctx.app.get(SettingsService).invalidate("growth");
}

/** A verified free account (phone too), past onboarding. */
async function person(): Promise<Person> {
  const user = await ctx.harness.signedInUser();
  const digits = String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
  await db()
    .update(users)
    .set({ phone: `+2010${digits}`, phoneVerified: true, phoneVerifiedAt: new Date() })
    .where(eq(users.id, user.userId));
  await db()
    .insert(onboardingProgress)
    .values({ userId: user.userId, currentStep: "done", completedAt: new Date() });
  // A fresh sign-in so the session sees the verified phone.
  return { jar: user.jar, userId: user.userId };
}

async function page(owner: Person): Promise<string> {
  const id = randomUUID();
  await db()
    .insert(files)
    .values({
      id,
      ownerUserId: owner.userId,
      createdBy: owner.userId,
      purpose: "rx_page",
      r2Key: `test/${id}.jpg`,
      mime: "image/jpeg",
      bytes: 5_000,
      sha256: randomBytes(32).toString("hex"),
      dhash: randomBytes(8).toString("hex"),
      status: "processed",
    });
  return id;
}

/** A finished analysis of `owner`, `minutesAgo` minutes ago. */
async function analysis(
  owner: Person,
  options: {
    items?: RxResultItem[];
    status?: "done" | "processing" | "failed";
    minutesAgo?: number;
  } = {},
): Promise<string> {
  const id = randomUUID();
  const fileId = await page(owner);
  const finishedAt = new Date(Date.now() - (options.minutesAgo ?? 1) * 60_000);
  await db()
    .insert(rxAnalyses)
    .values({
      id,
      ownerUserId: owner.userId,
      createdBy: owner.userId,
      status: options.status ?? "done",
      mode: "balanced",
      skillVersion: skillVersion(RX_SKILL_NAME),
      routeVersion,
      inputSha256: createHash("sha256").update(id).digest("hex"),
      result:
        options.status === undefined || options.status === "done"
          ? result(options.items ?? [item()])
          : null,
      finishedAt: options.status === undefined || options.status === "done" ? finishedAt : null,
    });
  await db().insert(rxPages).values({ analysisId: id, pageNo: 1, fileId });
  return id;
}

const prompt = (who: Person, query: string) =>
  ctx.harness.call("GET", `/me/growth/prompt?${query}`, { jar: who.jar });
const sessionId = () => `s-${randomUUID()}`;

async function sendEvents(who: Person | null, events: unknown[]) {
  return ctx.harness.call("POST", "/growth/events", {
    ...(who ? { jar: who.jar } : {}),
    body: { events },
  });
}

beforeAll(async () => {
  await ctx.start();
  marketer = await ctx.admin("super_admin");
  rxQueue = new Queue("rx", { connection: ctx.redis });
  const [route] = await db()
    .select({ version: aiTaskRoutes.version })
    .from(aiTaskRoutes)
    .where(
      and(
        eq(aiTaskRoutes.task, "rx_extract"),
        eq(aiTaskRoutes.mode, "balanced"),
        isNull(aiTaskRoutes.planId),
      ),
    );
  if (!route) throw new Error("default rx_extract route missing");
  routeVersion = route.version;
  // The cheapest public plan selling Deep is what a taste is routed by and named after.
  await db().update(plans).set({ visibility: "public" }).where(eq(plans.key, "pro"));
}, 240_000);

afterAll(async () => {
  await rxQueue?.close();
  await ctx.stop();
});

beforeEach(async () => {
  await setGrowth({});
});

describe("GET /me/growth/prompt", () => {
  it("offers the taste after a good first result, once per session", async () => {
    const user = await person();
    const rxId = await analysis(user);
    const session = sessionId();
    const first = await prompt(user, `context=result&rxId=${rxId}&sessionId=${session}`);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().prompt).toMatchObject({
      kind: "analysis_taste",
      variant: "a",
      messageKey: "growth.prompt.analysis_taste.a",
      params: { count: 1 },
      cta: { kind: "taste" },
    });
    // GET has no side effects: asking again still answers (a prefetch never burns the prompt).
    expect(
      (await prompt(user, `context=result&rxId=${rxId}&sessionId=${session}`)).json().prompt,
    ).not.toBeNull();

    const shown = await sendEvents(user, [
      { name: "prompt_shown", sessionId: session, props: { kind: "analysis_taste" } },
    ]);
    expect(shown.json()).toEqual({ accepted: 1, dropped: 0 });
    expect(await ctx.redis.get(promptSessionKey(session))).toBe("1");
    expect(
      (await prompt(user, `context=result&rxId=${rxId}&sessionId=${session}`)).json().prompt,
    ).toBeNull();
    // Another session soon after: the per-kind cooldown after "shown" holds it back too.
    expect(
      (await prompt(user, `context=result&rxId=${rxId}&sessionId=${sessionId()}`)).json().prompt,
    ).toBeNull();
  });

  it("counts an analysis whose finish time has microseconds (written by the database clock)", async () => {
    const user = await person();
    const rxId = await analysis(user);
    // `now()` keeps microseconds; a millisecond copy of it must not push the row past itself.
    await db().execute(
      sql`update rx_analyses set finished_at = now() - interval '1 second' + interval '0.000371 second' where id = ${rxId}`,
    );
    const answer = await prompt(user, `context=result&rxId=${rxId}&sessionId=${sessionId()}`);
    expect(answer.json().prompt?.kind).toBe("analysis_taste");
  });

  it("never prompts on an analysis that is running or failed, nor on an all-certain result", async () => {
    const user = await person();
    for (const status of ["processing", "failed"] as const) {
      const rxId = await analysis(user, { status });
      expect(
        (await prompt(user, `context=result&rxId=${rxId}&sessionId=${sessionId()}`)).json().prompt,
      ).toBeNull();
    }
    const certain = await analysis(user, { items: [item({ badge: "high", confidence: 0.98 })] });
    expect(
      (await prompt(user, `context=result&rxId=${certain}&sessionId=${sessionId()}`)).json().prompt,
    ).toBeNull();
  });

  it("doubles the cooldown after each dismissal (7 days, then 14)", async () => {
    const user = await person();
    const rxId = await analysis(user);
    const ask = () => prompt(user, `context=result&rxId=${rxId}&sessionId=${sessionId()}`);
    const dismiss = () =>
      sendEvents(user, [
        { name: "prompt_dismissed", sessionId: sessionId(), props: { kind: "analysis_taste" } },
      ]);
    const age = async (days: number) => {
      await db()
        .update(growthEvents)
        .set({ occurredAt: new Date(Date.now() - days * DAY) })
        .where(eq(growthEvents.userId, user.userId));
    };

    expect((await ask()).json().prompt).not.toBeNull();
    await dismiss();
    expect((await ask()).json().prompt).toBeNull();
    await age(8);
    expect((await ask()).json().prompt?.kind).toBe("analysis_taste");
    await dismiss();
    await age(8); // both dismissals 8 days old: the second doubles the quiet time to 14 days
    expect((await ask()).json().prompt).toBeNull();
    await age(15);
    expect((await ask()).json().prompt?.kind).toBe("analysis_taste");
  });

  it("honours the kill switch and the prompts switch", async () => {
    const user = await person();
    const rxId = await analysis(user);
    await setGrowth({ killSwitch: true });
    expect(
      (await prompt(user, `context=result&rxId=${rxId}&sessionId=${sessionId()}`)).json().prompt,
    ).toBeNull();
    await setGrowth({ prompts: { enabled: false } });
    expect(
      (await prompt(user, `context=result&rxId=${rxId}&sessionId=${sessionId()}`)).json().prompt,
    ).toBeNull();
  });

  it("says when the free credits are used up, with the renewal date first", async () => {
    const user = await person();
    await useUpMonthlyGrant(ctx.owner.db, user.userId);
    const credits = (await ctx.harness.call("GET", "/me/credits", { jar: user.jar })).json() as {
      wallet: { balance: number };
      monthlyCredits: number;
      nextGrantAt: string;
    };
    // This month's free credits are spent: an empty wallet on the free plan.
    expect(credits.wallet.balance).toBe(0);
    const res = await prompt(user, `context=credits&sessionId=${sessionId()}`);
    expect(res.json().prompt).toMatchObject({
      kind: "credits_out",
      params: { date: credits.nextGrantAt.slice(0, 10) },
      cta: { kind: "pack" },
    });
  });

  it("needs a signed-in user and validates the query", async () => {
    expect(
      (await ctx.harness.call("GET", `/me/growth/prompt?context=result&sessionId=${sessionId()}`))
        .statusCode,
    ).toBe(401);
    const user = await person();
    expect((await prompt(user, "context=nowhere&sessionId=abcdefgh")).statusCode).toBe(400);
  });
});

describe("the taste of Deep mode", () => {
  it("grants exactly the analysis' credits, starts a Deep analysis of the same pages and is idempotent", async () => {
    const user = await person();
    const rxId = await analysis(user);
    const requestId = randomUUID();
    const res = await ctx.harness.call("POST", "/me/taste", {
      jar: user.jar,
      body: { rxId, requestId },
    });
    expect(res.statusCode, res.body).toBe(201);
    const { grantId, analysisId } = res.json() as { grantId: string; analysisId: string };

    const [grant] = await db().select().from(tasteGrants).where(eq(tasteGrants.id, grantId));
    expect(grant).toMatchObject({ sourceAnalysisId: rxId, analysisId, credits: 1 });
    const [ledger] = await db()
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.idempotencyKey, `taste:${grantId}`));
    expect(ledger).toMatchObject({ kind: "trial_grant", amount: 1 });

    const [deep] = await db().select().from(rxAnalyses).where(eq(rxAnalyses.id, analysisId));
    expect(deep).toMatchObject({ mode: "deep", ownerUserId: user.userId });
    const job = await rxQueue.getJob(`rx-${analysisId}`);
    const [pro] = await db().select({ id: plans.id }).from(plans).where(eq(plans.key, "pro"));
    expect(job?.data).toMatchObject({ analysisId, routePlanId: pro?.id });

    // Again (same or another request id): the same taste, nothing granted twice.
    const again = await ctx.harness.call("POST", "/me/taste", {
      jar: user.jar,
      body: { rxId, requestId: randomUUID() },
    });
    expect(again.json()).toEqual({ grantId, analysisId });
    const grants = await db()
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.kind, "trial_grant"));
    expect(grants.filter((row) => row.idempotencyKey === `taste:${grantId}`)).toHaveLength(1);
    await ctx.redis.del(busyLockKey(user.userId, "rx"));
  });

  it("allows one taste a week per person", async () => {
    const user = await person();
    const first = await analysis(user);
    const second = await analysis(user);
    expect(
      (
        await ctx.harness.call("POST", "/me/taste", {
          jar: user.jar,
          body: { rxId: first, requestId: randomUUID() },
        })
      ).statusCode,
    ).toBe(201);
    await ctx.redis.del(busyLockKey(user.userId, "rx"));
    const refused = await ctx.harness.call("POST", "/me/taste", {
      jar: user.jar,
      body: { rxId: second, requestId: randomUUID() },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().details).toMatchObject({ reason: "weekly_limit" });
  });

  it("stops at the global weekly budget and for accounts that already pay", async () => {
    const user = await person();
    const rxId = await analysis(user);
    await setGrowth({ taste: { weeklyBudgetCredits: 0 } });
    const budget = await ctx.harness.call("POST", "/me/taste", {
      jar: user.jar,
      body: { rxId, requestId: randomUUID() },
    });
    expect(budget.json().details).toMatchObject({ reason: "budget" });

    await setGrowth({});
    const paying = await person();
    const theirs = await analysis(paying);
    const [plus] = await db().select().from(plans).where(eq(plans.key, "plus"));
    if (!plus) throw new Error("plan missing");
    await db()
      .insert(subscriptions)
      .values({
        ownerUserId: paying.userId,
        planId: plus.id,
        status: "active",
        source: "paid",
        currentPeriodStart: new Date(Date.now() - DAY),
        currentPeriodEnd: new Date(Date.now() + 20 * DAY),
      });
    const refused = await ctx.harness.call("POST", "/me/taste", {
      jar: paying.jar,
      body: { rxId: theirs, requestId: randomUUID() },
    });
    expect(refused.json().details).toMatchObject({ reason: "not_eligible" });
    // No grant row and no credits for a refusal.
    const rows = await db()
      .select()
      .from(tasteGrants)
      .where(eq(tasteGrants.ownerUserId, paying.userId));
    expect(rows).toHaveLength(0);
  });

  it("compares both results item by item and records the completion once", async () => {
    const user = await person();
    const rxId = await analysis(user, {
      items: [item({ badge: "medium" }), item({ badge: "high", confidence: 0.95 })],
    });
    const started = await ctx.harness.call("POST", "/me/taste", {
      jar: user.jar,
      body: { rxId, requestId: randomUUID() },
    });
    const { grantId, analysisId } = started.json() as { grantId: string; analysisId: string };
    await ctx.redis.del(busyLockKey(user.userId, "rx"));
    await db()
      .update(rxAnalyses)
      .set({
        status: "done",
        finishedAt: new Date(),
        result: result([
          item({ badge: "high", confidence: 0.97 }),
          item({ badge: "high", confidence: 0.95 }),
        ]),
      })
      .where(eq(rxAnalyses.id, analysisId));
    const compare = () =>
      ctx.harness.call("GET", `/me/taste/${grantId}/compare`, { jar: user.jar });
    const first = await compare();
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().items, first.body).toHaveLength(2);
    expect(first.json().items.map((entry: { improved: boolean }) => entry.improved)).toEqual([
      true,
      false,
    ]);
    await compare();
    const completed = await db()
      .select()
      .from(growthEvents)
      .where(and(eq(growthEvents.userId, user.userId), eq(growthEvents.name, "taste_completed")));
    expect(completed).toHaveLength(1);

    // Someone else's grant does not exist for them.
    const stranger = await person();
    expect(
      (await ctx.harness.call("GET", `/me/taste/${grantId}/compare`, { jar: stranger.jar }))
        .statusCode,
    ).toBe(404);
  });
});

describe("personal offers, value and proof", () => {
  it("serves the offer's server deadline identically in two sessions", async () => {
    const user = await person();
    const [promotion] = await db()
      .insert(promotions)
      .values({
        kind: "percent",
        name: "Welcome",
        titleAr: "ترحيب",
        titleEn: "Welcome",
        value: 2_000,
        status: "draft",
      })
      .returning({ id: promotions.id });
    if (!promotion) throw new Error("promotion missing");
    const expiresAt = new Date(Date.now() + 48 * 3_600_000);
    await db()
      .insert(personalOffers)
      .values({
        ownerUserId: user.userId,
        kind: "welcome",
        promotionId: promotion.id,
        ruleKey: "welcome_offer",
        expiresAt,
      });
    const first = await ctx.harness.call("GET", "/me/offers", { jar: user.jar });
    expect(first.statusCode).toBe(200);
    expect(first.json().offers[0]).toMatchObject({
      kind: "welcome",
      expiresAt: expiresAt.toISOString(),
    });
    // A second device: sign in again, same deadline (nothing is computed per session).
    const [row] = await db()
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, user.userId));
    if (!row) throw new Error("user missing");
    const other: Jar = new Map();
    await ctx.harness.call("POST", "/auth/sign-in/email", {
      body: { email: row.email, password: PASSWORD },
      jar: other,
    });
    expect(other.size).toBeGreaterThan(0);
    const second = await ctx.harness.call("GET", "/me/offers", { jar: other });
    expect(second.json().offers[0].expiresAt).toBe(expiresAt.toISOString());
  });

  it("counts the person's own value and labels the time as an estimate", async () => {
    const user = await person();
    await analysis(user, { items: [item(), item(), item()] });
    await analysis(user, { items: [item()] });
    const res = await ctx.harness.call("GET", "/me/value", { jar: user.jar });
    expect(res.json()).toEqual({
      analyses: 2,
      drugsChecked: 4,
      minutesSavedEstimate: 20,
      estimate: true,
    });
  });

  it("hides social proof below the threshold", async () => {
    await ctx.redis.del("growth:proof");
    const res = await ctx.harness.call("GET", "/public/proof");
    expect(res.statusCode).toBe(200);
    expect(res.json().analysesThisWeek).toBeUndefined();
  });
});

describe("POST /growth/events", () => {
  it("keeps visitor events, drops server-only, unknown and personal ones", async () => {
    const anonymous = await sendEvents(null, [
      { name: "pricing_viewed", sessionId: sessionId(), props: { currency: "EGP" } },
      { name: "prompt_shown", sessionId: sessionId(), props: { kind: "credits_low" } },
      { name: "payment_succeeded", sessionId: sessionId(), props: {} },
      { name: "made_up", sessionId: sessionId() },
    ]);
    expect(anonymous.statusCode).toBe(202);
    expect(anonymous.json()).toEqual({ accepted: 1, dropped: 3 });

    const user = await person();
    const signed = await sendEvents(user, [
      { name: "plan_selected", sessionId: sessionId(), props: { plan: "plus" } },
      { name: "plan_selected", sessionId: sessionId(), props: { contact: "someone@example.com" } },
      { name: "plan_selected", sessionId: sessionId(), props: { drug: "Augmentin" } },
      { name: "prompt_clicked", sessionId: sessionId(), props: { kind: "not_a_kind" } },
    ]);
    expect(signed.json()).toEqual({ accepted: 1, dropped: 3 });
    const stored = await db()
      .select()
      .from(growthEvents)
      .where(eq(growthEvents.userId, user.userId));
    expect(stored.map((row) => row.name)).toEqual(["plan_selected"]);
  });

  it("refuses more than 20 events at once", async () => {
    const many = Array.from({ length: 21 }, () => ({
      name: "pricing_viewed",
      sessionId: sessionId(),
    }));
    expect((await sendEvents(null, many)).statusCode).toBe(400);
  });
});

describe("unsubscribe", () => {
  it("turns marketing mail off with the signed token, from the page and the one-click button", async () => {
    const user = await person();
    await ctx.harness.call("PUT", "/me/notification-prefs", {
      jar: user.jar,
      body: { marketing: true },
    });
    expect(
      (await ctx.harness.call("GET", "/me/notification-prefs", { jar: user.jar })).json().marketing,
    ).toEqual({
      enabled: true,
    });
    const token = unsubscribeToken(Buffer.from(ctx.env.ENCRYPTION_KEY, "base64"), user.userId);

    const page = await ctx.harness.call("POST", "/unsubscribe", { body: { token }, origin: null });
    expect(page.statusCode, page.body).toBe(200);
    const [prefs] = await db()
      .select()
      .from(notificationPrefs)
      .where(eq(notificationPrefs.userId, user.userId));
    expect(prefs?.marketingOptedOutVia).toBe("unsubscribe_link");
    expect(
      (await ctx.harness.call("GET", "/me/notification-prefs", { jar: user.jar })).json().marketing,
    ).toEqual({
      enabled: false,
    });
    // Idempotent.
    expect(
      (await ctx.harness.call("POST", "/unsubscribe", { body: { token }, origin: null }))
        .statusCode,
    ).toBe(200);

    // RFC 8058: the mail client posts a form to the header URL.
    const other = await person();
    const otherToken = unsubscribeToken(
      Buffer.from(ctx.env.ENCRYPTION_KEY, "base64"),
      other.userId,
    );
    const oneClick = await ctx.app.inject({
      method: "POST",
      url: `/unsubscribe?token=${encodeURIComponent(otherToken)}`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "List-Unsubscribe=One-Click",
      remoteAddress: "203.0.113.9",
    });
    expect(oneClick.statusCode, oneClick.body).toBe(200);
    const [otherPrefs] = await db()
      .select()
      .from(notificationPrefs)
      .where(eq(notificationPrefs.userId, other.userId));
    expect(otherPrefs?.marketingOptedOutVia).toBe("one_click");
  });

  it("answers 404 for a forged or foreign token", async () => {
    const user = await person();
    const forged = `${user.userId}.${randomBytes(18).toString("base64url")}`;
    expect(
      (await ctx.harness.call("POST", "/unsubscribe", { body: { token: forged }, origin: null }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await ctx.harness.call("POST", "/unsubscribe", {
          body: { token: "x".repeat(30) },
          origin: null,
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe("experiments and the funnel", () => {
  it("creates, starts and reads an experiment; arms are stable per user", async () => {
    const created = await ctx.harness.call("POST", "/admin/growth/experiments", {
      jar: marketer.jar,
      body: {
        key: "prompt_credits_low",
        name: "Credits copy",
        flagKey: "exp_credits_low",
        variants: [
          { key: "a", weight: 50 },
          { key: "b", weight: 50 },
        ],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    expect(created.json().status).toBe("draft");
    const started = await ctx.harness.call("POST", `/admin/growth/experiments/${id}/start`, {
      jar: marketer.jar,
    });
    expect(started.json().status).toBe("running");
    // Variants cannot change once running.
    const edit = await ctx.harness.call("PATCH", `/admin/growth/experiments/${id}`, {
      jar: marketer.jar,
      body: {
        variants: [
          { key: "a", weight: 10 },
          { key: "b", weight: 90 },
        ],
      },
    });
    expect(edit.statusCode).toBe(409);

    const user = await person();
    const mine = await ctx.harness.call("GET", "/me/experiments", { jar: user.jar });
    const expected = variantFor(user.userId, "prompt_credits_low", [
      { key: "a", weight: 50 },
      { key: "b", weight: 50 },
    ]);
    expect(mine.json().assignments).toContainEqual({
      experimentKey: "prompt_credits_low",
      variant: expected,
    });

    // An exposure with the server-computed arm, then the results.
    await sendEvents(user, [
      {
        name: "prompt_shown",
        sessionId: sessionId(),
        props: { kind: "credits_low" },
        variant: "forged_arm",
      },
    ]);
    const [event] = await db()
      .select()
      .from(growthEvents)
      .where(and(eq(growthEvents.userId, user.userId), eq(growthEvents.name, "prompt_shown")));
    expect(event?.variant).toBe(expected);
    const results = await ctx.harness.call("GET", `/admin/growth/experiments/${id}/results`, {
      jar: marketer.jar,
    });
    expect(results.statusCode, results.body).toBe(200);
    const arm = results
      .json()
      .variants.find((row: { variant: string }) => row.variant === expected);
    expect(arm.exposures).toBeGreaterThanOrEqual(1);
    await db().update(experiments).set({ status: "stopped" }).where(eq(experiments.id, id));
  });

  it("reports every funnel step", async () => {
    const res = await ctx.harness.call("GET", "/admin/growth/funnel", { jar: marketer.jar });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    for (const key of [
      "visitToSignup",
      "signupToActivation",
      "activationToPaid",
      "checkoutToPaid",
    ]) {
      expect(body[key]).toEqual({
        from: expect.any(Number),
        to: expect.any(Number),
        rateBps: expect.any(Number),
      });
    }
    expect(body.signupToActivation.from).toBeGreaterThan(0);
  });

  it("denies the console to a role without the permission", async () => {
    const roleKey = await ctx.roleLacking("billing.read");
    const lacking = await ctx.admin(roleKey);
    expect(
      (await ctx.harness.call("GET", "/admin/growth/funnel", { jar: lacking.jar })).statusCode,
    ).toBe(403);
  });
});
