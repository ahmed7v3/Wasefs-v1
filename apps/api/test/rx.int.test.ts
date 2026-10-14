import { createHash, randomBytes, randomUUID } from "node:crypto";

import { skillVersion } from "@wasfa/ai";
import {
  aiTaskRoutes,
  aiUsage,
  createDb,
  creditLedger,
  creditWallets,
  drugs,
  files,
  grant,
  onboardingProgress,
  rxAnalyses,
  rxCorrections,
  rxPages,
  seedDefaults,
} from "@wasfa/db";
import { busyLockKey } from "@wasfa/shared/busy";
import { RX_SKILL_NAME } from "@wasfa/shared/rx";
import {
  RX_SCHEMA_VERSION,
  rxChannel,
  type RxResult,
  type RxResultItem,
} from "@wasfa/shared/schemas/rx";
import { Queue } from "bullmq";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Redis } from "ioredis";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/bootstrap.js";
import { SettingsService } from "../src/settings/settings.service.js";

import { AuthHarness, pwnedHandlers, testApiEnv, type Jar } from "./support/auth-harness.js";
import { startInfra, type TestInfra } from "./support/infra.js";
import { wrongOwnerIsHidden } from "./support/wrong-owner.js";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";

/*
 * `/rx` against real Postgres and Redis. The worker is not running: these tests are about what the
 * api decides (checks in order, credits, cache, ownership) and what it hands to the queue.
 */

const WEB = "https://wasfa.online";
const network = setupServer(...pwnedHandlers());

let infra: TestInfra;
let app: NestFastifyApplication;
let owner: ReturnType<typeof createDb>;
let redis: Redis;
let rxQueue: Queue;
let baseUrl: string;
let settings: SettingsService;
let routeVersion: number;
const harness = new AuthHarness(
  () => app,
  () => owner.db,
);

beforeAll(async () => {
  infra = await startInfra();
  network.listen({ onUnhandledRequest: "bypass" });
  owner = createDb({ url: infra.databaseUrl, max: 4 });
  await seedDefaults(owner.db);
  app = await createApp(testApiEnv(infra), {
    extraImports: [harness.mailerModule()],
    authMailer: false,
  });
  // The live feed is a long-lived response; `inject` cannot read it, so this suite also listens.
  await app.listen(0, "127.0.0.1");
  baseUrl = await app.getUrl();
  settings = app.get(SettingsService);
  redis = new Redis(infra.redisUrl, { maxRetriesPerRequest: null });
  rxQueue = new Queue("rx", { connection: redis });
  const [route] = await owner.db
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
}, 240_000);

afterAll(async () => {
  network.close();
  await rxQueue?.close();
  await redis?.quit();
  await app?.close();
  await owner?.close();
  await infra?.stop();
});

interface Person {
  jar: Jar;
  userId: string;
}

const cookieHeader = (jar: Jar) => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");

/** A verified account with finished onboarding and `credits` in the personal wallet. */
async function user(credits = 30): Promise<Person> {
  const person = await harness.signedInUser();
  await owner.db
    .insert(onboardingProgress)
    .values({ userId: person.userId, currentStep: "done", completedAt: new Date() });
  if (credits > 0) await grant(owner.db, { type: "user", id: person.userId }, credits, "2026-10");
  return person;
}

const hex = (bytes: number) => randomBytes(bytes).toString("hex");

/** A processed page (what the image pipeline leaves behind). */
async function page(
  person: Person,
  overrides: Partial<typeof files.$inferInsert> = {},
): Promise<string> {
  const id = randomUUID();
  await owner.db.insert(files).values({
    id,
    ownerUserId: person.userId,
    createdBy: person.userId,
    purpose: "rx_page",
    r2Key: `test/${id}.jpg`,
    mime: "image/jpeg",
    bytes: 5_000,
    sha256: hex(32),
    dhash: hex(8),
    status: "processed",
    ...overrides,
  });
  return id;
}

const create = (person: Person, body: Record<string, unknown>) =>
  harness.call("POST", "/rx", { jar: person.jar, body });
const balanceOf = async (person: Person): Promise<number> => {
  const [wallet] = await owner.db
    .select({ balance: creditWallets.balance })
    .from(creditWallets)
    .where(eq(creditWallets.ownerUserId, person.userId));
  return wallet?.balance ?? 0;
};

const itemFixture = (overrides: Partial<RxResultItem> = {}): RxResultItem => ({
  rawText: "Augmentin 1g 1x3",
  name: "Augmentin 1g",
  matchedDrugId: null,
  matchScore: null,
  activeIngredients: [],
  strength: "1 g",
  form: "tablet",
  dose: null,
  frequency: "3 مرات يوميًا",
  duration: null,
  route: null,
  notes: null,
  confidence: 0.7,
  badge: "medium",
  verified: "not_needed",
  box_2d: null,
  page: 0,
  ...overrides,
});

const resultFixture = (items: RxResultItem[] = [itemFixture()]): RxResult => ({
  schemaVersion: RX_SCHEMA_VERSION,
  items,
  date: null,
  prescriberLegible: true,
  findings: [],
  unreadableRegions: [],
});

/** An analysis row of `person` over the given pages, as the worker would leave it. */
async function analysis(
  person: Person,
  fileIds: string[],
  overrides: Partial<typeof rxAnalyses.$inferInsert> = {},
): Promise<string> {
  const id = randomUUID();
  const rows = await owner.db
    .select({ sha256: files.sha256, id: files.id })
    .from(files)
    .then((all) => fileIds.map((fileId) => all.find((row) => row.id === fileId)));
  const inputSha256 = createHash("sha256")
    .update(rows.map((row) => row?.sha256 ?? "").join(""))
    .digest("hex");
  await owner.db.insert(rxAnalyses).values({
    id,
    ownerUserId: person.userId,
    createdBy: person.userId,
    status: "done",
    mode: "balanced",
    skillVersion: skillVersion(RX_SKILL_NAME),
    routeVersion,
    inputSha256,
    result: resultFixture(),
    finishedAt: new Date(),
    ...overrides,
  });
  await owner.db
    .insert(rxPages)
    .values(fileIds.map((fileId, index) => ({ analysisId: id, pageNo: index + 1, fileId })));
  return id;
}

async function rowOf(id: string) {
  const [row] = await owner.db.select().from(rxAnalyses).where(eq(rxAnalyses.id, id));
  return row;
}

const kill = (rx: boolean) =>
  settings.set(
    "ai",
    { killSwitch: { all: false, rx, chat: false, search: false } },
    { actorId: null },
  );

describe("POST /rx: checks", () => {
  it("needs a session and a verified, onboarded account", async () => {
    const anonymous = await harness.call("POST", "/rx", { body: { fileIds: [randomUUID()] } });
    expect(anonymous.statusCode).toBe(401);
    const fresh = await harness.signedInUser();
    const res = await create(fresh, { fileIds: [randomUUID()] });
    expect(res.statusCode).toBe(403);
  });

  it("validates the body", async () => {
    const who = await user();
    for (const body of [
      {},
      { fileIds: [] },
      { fileIds: ["not-a-uuid"] },
      { fileIds: Array.from({ length: 5 }, () => randomUUID()) },
      { fileIds: [randomUUID()], mode: "turbo" },
    ]) {
      const res = await create(who, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    }
  });

  it("hides files that are not the caller's, and refuses ones that are not ready", async () => {
    const alice = await user();
    const bob = await user();
    const theirs = await page(bob);
    const foreign = await create(alice, { fileIds: [theirs] });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toMatchObject({ code: "NOT_FOUND" });
    expect((await create(alice, { fileIds: [randomUUID()] })).statusCode).toBe(404);

    const cases: [string, Partial<typeof files.$inferInsert>][] = [
      ["file_not_processed", { status: "uploaded", sha256: null, dhash: null }],
      ["file_not_processed", { status: "deleted" }],
      ["file_purpose", { purpose: "chat_image" }],
    ];
    for (const [reason, overrides] of cases) {
      const res = await create(alice, { fileIds: [await page(alice, overrides)] });
      expect(res.statusCode, reason).toBe(422);
      expect(res.json()).toMatchObject({ code: "VALIDATION_FAILED", details: { reason } });
    }
    const one = await page(alice);
    const twice = await create(alice, { fileIds: [one, one] });
    expect(twice.json()).toMatchObject({ details: { reason: "duplicate_file" } });
    // None of it took the lock or any credits.
    expect(await redis.exists(busyLockKey(alice.userId, "rx"))).toBe(0);
    expect(await balanceOf(alice)).toBe(30);
  });

  it("limits the pages by the setting and by the plan", async () => {
    const who = await user();
    const two = [await page(who), await page(who)];
    await settings.set("rx", { maxPages: 1 }, { actorId: null });
    try {
      const res = await create(who, { fileIds: two });
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({
        code: "VALIDATION_FAILED",
        details: { reason: "too_many_pages", maxPages: 1 },
      });
    } finally {
      await settings.set("rx", {}, { actorId: null });
    }
    const ok = await create(who, { fileIds: two });
    expect(ok.statusCode, ok.body).toBe(201);
  });

  it("answers ai_paused under the kill switch, before the files are looked at", async () => {
    const who = await user();
    await kill(true);
    try {
      // The file does not even exist: the switch is the first answer.
      const res = await create(who, { fileIds: [randomUUID()] });
      expect(res.statusCode).toBe(502);
      expect(res.json()).toMatchObject({
        code: "UPSTREAM_UNAVAILABLE",
        details: { reason: "ai_paused" },
      });
    } finally {
      await kill(false);
    }
    expect(await redis.exists(busyLockKey(who.userId, "rx"))).toBe(0);
  });
});

describe("POST /rx: queueing", () => {
  it("reserves pages x price, queues rx.analyze and holds the busy lock", async () => {
    const who = await user();
    const fileIds = [await page(who), await page(who)];
    const res = await create(who, { fileIds, mode: "balanced" });
    expect(res.statusCode, res.body).toBe(201);
    const { id, nearDuplicate } = res.json<{ id: string; nearDuplicate: unknown }>();
    expect(nearDuplicate).toBeNull();

    const row = await rowOf(id);
    expect(row).toMatchObject({
      status: "queued",
      ownerUserId: who.userId,
      createdBy: who.userId,
      mode: "balanced",
      skillVersion: skillVersion(RX_SKILL_NAME),
    });
    expect(row?.inputSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.reservationId).not.toBeNull();
    const pages = await owner.db.select().from(rxPages).where(eq(rxPages.analysisId, id));
    expect(pages.map((p) => [p.pageNo, p.fileId]).sort()).toEqual(
      fileIds.map((fileId, index) => [index + 1, fileId]),
    );

    expect(await balanceOf(who)).toBe(28);
    const reserve = await owner.db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.idempotencyKey, `reserve:rx:${id}:reserve`));
    expect(reserve).toHaveLength(1);
    expect(reserve[0]).toMatchObject({ kind: "usage_reserve", amount: -2 });

    const job = await rxQueue.getJob(`rx-${id}`);
    expect(job?.name).toBe("rx.analyze");
    expect(job?.data).toEqual({ analysisId: id });
    expect(await redis.exists(busyLockKey(who.userId, "rx"))).toBe(1);

    // One analysis at a time: the second waits, and costs nothing.
    const again = await create(who, { fileIds: [await page(who)] });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: "CONFLICT", details: { reason: "busy" } });
    expect(await balanceOf(who)).toBe(28);
  });

  it("refuses when the wallet is short, holds nothing and frees the lock", async () => {
    const who = await user(0);
    const res = await create(who, { fileIds: [await page(who)] });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      code: "QUOTA_EXCEEDED",
      details: { reason: "insufficient_credits" },
    });
    expect(await redis.exists(busyLockKey(who.userId, "rx"))).toBe(0);
    const rows = await owner.db
      .select()
      .from(rxAnalyses)
      .where(eq(rxAnalyses.ownerUserId, who.userId));
    expect(rows).toHaveLength(0);
    // Topping up lets the very same user go on.
    await grant(owner.db, { type: "user", id: who.userId }, 5, "2026-11");
    expect((await create(who, { fileIds: [await page(who)] })).statusCode).toBe(201);
  });

  it("offers a near-duplicate of the same owner only, within the distance", async () => {
    const alice = await user();
    const bob = await user();
    const dhash = "f0f0f0f0f0f0f0f0";
    const older = await analysis(alice, [await page(alice, { dhash })]);
    // Same picture taken by another user: never offered across owners.
    await analysis(bob, [await page(bob, { dhash })]);

    // 5 bits flipped: a re-photograph of the same paper.
    const near = await create(alice, {
      fileIds: [await page(alice, { dhash: "f0f0f0f0f0f0f0c7" })],
    });
    expect(near.statusCode, near.body).toBe(201);
    const body = near.json<{
      id: string;
      nearDuplicate: { analysisId: string; createdAt: string };
    }>();
    expect(body.nearDuplicate.analysisId).toBe(older);
    expect(new Date(body.nearDuplicate.createdAt).getTime()).not.toBeNaN();
    // It is only offered: the new analysis still runs.
    expect((await rowOf(body.id))?.status).toBe("queued");

    const carol = await user();
    const bobsOnly = await create(carol, { fileIds: [await page(carol, { dhash })] });
    expect(bobsOnly.json()).toMatchObject({ nearDuplicate: null });
  });

  it("does not offer a page that differs by more than 6 bits", async () => {
    const who = await user();
    await analysis(who, [await page(who, { dhash: "0000000000000000" })]);
    // 7 bits set.
    const far = await create(who, { fileIds: [await page(who, { dhash: "000000000000007f" })] });
    expect(far.statusCode, far.body).toBe(201);
    expect(far.json()).toMatchObject({ nearDuplicate: null });
  });
});

describe("POST /rx: exact cache", () => {
  it("serves the owner's re-upload within 24 hours for free, with no provider call and no job", async () => {
    const who = await user();
    const sha256 = hex(32);
    const original = await analysis(who, [await page(who, { sha256 })]);

    const res = await create(who, { fileIds: [await page(who, { sha256 })] });
    expect(res.statusCode, res.body).toBe(201);
    const { id } = res.json<{ id: string }>();
    const row = await rowOf(id);
    expect(row).toMatchObject({
      status: "done",
      cacheOf: original,
      creditsCharged: 0,
      reservationId: null,
      routeVersion,
    });
    expect(row?.result).toMatchObject({ schemaVersion: RX_SCHEMA_VERSION });
    expect(await balanceOf(who)).toBe(30);
    expect(await rxQueue.getJob(`rx-${id}`)).toBeUndefined();
    expect(await redis.exists(busyLockKey(who.userId, "rx"))).toBe(0);

    const usage = await owner.db.select().from(aiUsage).where(eq(aiUsage.requestId, id));
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      outcome: "cache_hit",
      cacheHit: true,
      costUsdMicros: 0,
      inputTokens: 0,
      creditsCharged: 0,
      ownerUserId: who.userId,
    });

    const view = await harness.call("GET", `/rx/${id}`, { jar: who.jar });
    expect(view.json()).toMatchObject({ status: "done", cached: true, creditsCharged: 0 });
  });

  it("bills an owner's re-upload after 24 hours and another user's hit at the normal price", async () => {
    const alice = await user();
    const bob = await user();
    const sha256 = hex(32);
    await analysis(alice, [await page(alice, { sha256 })], {
      finishedAt: new Date(Date.now() - 25 * 3_600_000),
    });

    const late = await create(alice, { fileIds: [await page(alice, { sha256 })] });
    expect(late.statusCode, late.body).toBe(201);
    const lateRow = await rowOf(late.json<{ id: string }>().id);
    expect(lateRow).toMatchObject({ status: "done", creditsCharged: 1 });
    expect(await balanceOf(alice)).toBe(29);

    const others = await create(bob, { fileIds: [await page(bob, { sha256 })] });
    expect(others.statusCode, others.body).toBe(201);
    const bobId = others.json<{ id: string }>().id;
    expect(await rowOf(bobId)).toMatchObject({ status: "done", creditsCharged: 1 });
    expect(await balanceOf(bob)).toBe(29);
    const settle = await owner.db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.walletId, await walletId(bob)))
      .orderBy(desc(creditLedger.createdAt));
    expect(settle.map((entry) => entry.kind)).toContain("usage_settle");
    const [usage] = await owner.db.select().from(aiUsage).where(eq(aiUsage.requestId, bobId));
    expect(usage).toMatchObject({ outcome: "cache_hit", costUsdMicros: 0, creditsCharged: 1 });
    // Still no provider call, no job.
    expect(await rxQueue.getJob(`rx-${bobId}`)).toBeUndefined();
  });

  it("charges the price up front when the cache hit cannot be paid, like any analysis", async () => {
    const poor = await user(0);
    const rich = await user();
    const sha256 = hex(32);
    await analysis(rich, [await page(rich, { sha256 })]);
    const res = await create(poor, { fileIds: [await page(poor, { sha256 })] });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ details: { reason: "insufficient_credits" } });
    expect(await redis.exists(busyLockKey(poor.userId, "rx"))).toBe(0);
  });

  it("never reuses another route, skill, mode or a user-corrected analysis", async () => {
    const who = await user();
    const other = await user();
    const sha256 = hex(32);
    const page1 = await page(other, { sha256 });
    // Different skill version, route version and mode do not match.
    await analysis(other, [page1], { skillVersion: "prescription-analysis@000000000000" });
    await analysis(other, [page1], { routeVersion: routeVersion + 1 });
    await analysis(other, [page1], { mode: "fast" });
    // A corrected analysis is a human edit, not the model's answer.
    const corrected = await analysis(other, [page1]);
    await owner.db
      .insert(rxCorrections)
      .values({ analysisId: corrected, itemIndex: 0, field: "dose", before: null, after: "2" });

    const res = await create(who, { fileIds: [await page(who, { sha256 })], mode: "balanced" });
    expect(res.statusCode, res.body).toBe(201);
    expect(await rowOf(res.json<{ id: string }>().id)).toMatchObject({
      status: "queued",
      cacheOf: null,
    });
  });
});

async function walletId(person: Person): Promise<string> {
  const [wallet] = await owner.db
    .select({ id: creditWallets.id })
    .from(creditWallets)
    .where(eq(creditWallets.ownerUserId, person.userId));
  if (!wallet) throw new Error("wallet missing");
  return wallet.id;
}

describe("GET /rx/:id and the other id routes: ownership", () => {
  it("shows the analysis with its pages, and the picture's deletion", async () => {
    const who = await user();
    const kept = await page(who);
    const gone = await page(who, { status: "deleted" });
    const id = await analysis(who, [kept, gone]);
    const res = await harness.call("GET", `/rx/${id}`, { jar: who.jar });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      id,
      status: "done",
      mode: "balanced",
      cached: false,
      creditsCharged: 0,
      errorRef: null,
      files: [
        { fileId: kept, pageNo: 1, imageDeleted: false },
        { fileId: gone, pageNo: 2, imageDeleted: true },
      ],
    });
    expect(body.result.items).toHaveLength(1);
  });

  it("answers NOT_FOUND to everyone else on every route, and changes nothing", async () => {
    const alice = await user();
    const mallory = await user();
    const fileId = await page(alice);
    const id = await analysis(alice, [fileId]);

    const routes: [string, string, Record<string, unknown> | undefined][] = [
      ["GET", `/rx/${id}`, undefined],
      ["GET", `/rx/${id}/events`, undefined],
      ["GET", `/rx/${id}/candidates/0`, undefined],
      [
        "POST",
        `/rx/${id}/corrections`,
        { itemIndex: 0, field: "dose", after: "5 ml", consentForEval: true },
      ],
    ];
    for (const [method, url, body] of routes) {
      const call = (who: Person) =>
        harness.call(method as "GET" | "POST", url, { jar: who.jar, ...(body ? { body } : {}) });
      const foreign = await call(mallory);
      expect(foreign.statusCode, `${method} ${url}`).toBe(404);
      expect(foreign.json()).toMatchObject({ code: "NOT_FOUND" });
    }
    expect(
      await owner.db.select().from(rxCorrections).where(eq(rxCorrections.analysisId, id)),
    ).toHaveLength(0);

    // DELETE last: the pattern proves the intruder is harmless, then the owner succeeds.
    await wrongOwnerIsHidden({
      owner: () => harness.call("DELETE", `/rx/${id}`, { jar: alice.jar }),
      intruder: () => harness.call("DELETE", `/rx/${id}`, { jar: mallory.jar }),
      stillThere: async () => (await rowOf(id)) !== undefined,
    });
    expect(await rowOf(id)).toBeUndefined();
    expect((await harness.call("GET", `/rx/${randomUUID()}`, { jar: alice.jar })).statusCode).toBe(
      404,
    );
  });

  it("refuses to delete a running analysis", async () => {
    const who = await user();
    const id = await analysis(who, [await page(who)], { status: "processing", result: null });
    const res = await harness.call("DELETE", `/rx/${id}`, { jar: who.jar });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ details: { reason: "in_flight" } });
    expect(await rowOf(id)).toBeDefined();
  });

  it("deletes the analysis with its pages and corrections, keeping the files", async () => {
    const who = await user();
    const fileId = await page(who);
    const id = await analysis(who, [fileId]);
    await owner.db
      .insert(rxCorrections)
      .values({ analysisId: id, itemIndex: 0, field: "dose", before: null, after: "2" });
    const res = await harness.call("DELETE", `/rx/${id}`, { jar: who.jar });
    expect(res.statusCode).toBe(204);
    expect(await rowOf(id)).toBeUndefined();
    expect(await owner.db.select().from(rxPages).where(eq(rxPages.analysisId, id))).toHaveLength(0);
    expect(
      await owner.db.select().from(rxCorrections).where(eq(rxCorrections.analysisId, id)),
    ).toHaveLength(0);
    expect(await owner.db.select().from(files).where(eq(files.id, fileId))).toHaveLength(1);
  });
});

describe("GET /rx (history)", () => {
  it("lists only the caller's analyses, newest first, with a keyset cursor", async () => {
    const who = await user();
    const other = await user();
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      ids.push(
        await analysis(who, [await page(who)], {
          createdAt: new Date(Date.now() - (3 - index) * 60_000),
        }),
      );
    }
    await analysis(other, [await page(other)]);

    const first = await harness.call("GET", "/rx?limit=2", { jar: who.jar });
    expect(first.statusCode, first.body).toBe(200);
    const page1 = first.json<{ items: { id: string }[]; nextCursor: string | null }>();
    expect(page1.items.map((item) => item.id)).toEqual([ids[2], ids[1]]);
    expect(page1.nextCursor).not.toBeNull();

    const second = await harness.call(
      "GET",
      `/rx?limit=2&cursor=${encodeURIComponent(page1.nextCursor ?? "")}`,
      { jar: who.jar },
    );
    const page2 = second.json<{ items: { id: string }[]; nextCursor: string | null }>();
    expect(page2.items.map((item) => item.id)).toEqual([ids[0]]);
    expect(page2.nextCursor).toBeNull();
    expect(page1.items[0]).toMatchObject({
      status: "done",
      itemCount: 1,
      itemNames: ["Augmentin 1g"],
      pageCount: 1,
    });

    const bad = await harness.call("GET", "/rx?cursor=garbage", { jar: who.jar });
    expect(bad.statusCode).toBe(400);
  });

  it("searches item names inside the results, literally", async () => {
    const who = await user();
    const hit = await analysis(who, [await page(who)], {
      result: resultFixture([itemFixture({ name: "Panadol Extra", rawText: "pan x" })]),
    });
    await analysis(who, [await page(who)], {
      result: resultFixture([itemFixture({ name: "Brufen", rawText: "brufen 400" })]),
    });
    const found = await harness.call("GET", "/rx?q=panad", { jar: who.jar });
    expect(found.json<{ items: { id: string }[] }>().items.map((item) => item.id)).toEqual([hit]);
    const wildcard = await harness.call("GET", "/rx?q=%25", { jar: who.jar });
    expect(wildcard.json<{ items: unknown[] }>().items).toHaveLength(0);
  });
});

describe("POST /rx/:id/corrections", () => {
  it("fixes a text field and records it", async () => {
    const who = await user();
    const id = await analysis(who, [await page(who)]);
    const res = await harness.call("POST", `/rx/${id}/corrections`, {
      jar: who.jar,
      body: { itemIndex: 0, field: "frequency", after: "مرتين يوميًا", consentForEval: true },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ result: RxResult }>().result.items[0]).toMatchObject({
      frequency: "مرتين يوميًا",
      verified: "corrected",
    });
    expect((await rowOf(id))?.result).toMatchObject({
      items: [{ frequency: "مرتين يوميًا" }],
    });
    const [correction] = await owner.db
      .select()
      .from(rxCorrections)
      .where(eq(rxCorrections.analysisId, id));
    expect(correction).toMatchObject({
      itemIndex: 0,
      field: "frequency",
      before: "3 مرات يوميًا",
      after: "مرتين يوميًا",
      userId: who.userId,
      consentForEval: true,
    });
  });

  it("sets matchedDrugId when the drug field carries a drug id, and keeps free text unmatched", async () => {
    const who = await user();
    const [drug] = await owner.db
      .insert(drugs)
      .values({
        brandEn: "Augmentin 1g",
        normalizedEn: "augmentin",
        form: "tablet",
        strengthText: "1 g",
      })
      .returning({ id: drugs.id });
    if (!drug) throw new Error("drug insert failed");
    const id = await analysis(who, [await page(who)]);

    const picked = await harness.call("POST", `/rx/${id}/corrections`, {
      jar: who.jar,
      body: { itemIndex: 0, field: "drug", after: drug.id },
    });
    expect(picked.statusCode, picked.body).toBe(200);
    expect(picked.json<{ result: RxResult }>().result.items[0]).toMatchObject({
      matchedDrugId: drug.id,
      name: "Augmentin 1g",
      verified: "corrected",
      badge: "high",
    });
    const [stored] = await owner.db
      .select()
      .from(rxCorrections)
      .where(eq(rxCorrections.analysisId, id));
    expect(stored).toMatchObject({
      field: "drug",
      after: drug.id,
      before: "Augmentin 1g",
      consentForEval: false,
    });

    const typed = await harness.call("POST", `/rx/${id}/corrections`, {
      jar: who.jar,
      body: { itemIndex: 0, field: "drug", after: "Something unlisted" },
    });
    expect(typed.statusCode).toBe(200);
    const item = typed.json<{ result: RxResult }>().result.items[0];
    expect(item).toMatchObject({ matchedDrugId: null, name: "Something unlisted" });
    expect(item?.badge).not.toBe("high");
  });

  it("refuses an unknown drug, a missing line and an analysis without a result", async () => {
    const who = await user();
    const id = await analysis(who, [await page(who)]);
    const unknown = await harness.call("POST", `/rx/${id}/corrections`, {
      jar: who.jar,
      body: { itemIndex: 0, field: "drug", after: randomUUID() },
    });
    expect(unknown.statusCode).toBe(400);
    const missing = await harness.call("POST", `/rx/${id}/corrections`, {
      jar: who.jar,
      body: { itemIndex: 7, field: "dose", after: "1" },
    });
    expect(missing.statusCode).toBe(400);
    const bad = await harness.call("POST", `/rx/${id}/corrections`, {
      jar: who.jar,
      body: { itemIndex: 0, field: "colour", after: "red" },
    });
    expect(bad.statusCode).toBe(400);

    const queued = await analysis(who, [await page(who)], { status: "queued", result: null });
    const early = await harness.call("POST", `/rx/${queued}/corrections`, {
      jar: who.jar,
      body: { itemIndex: 0, field: "dose", after: "1" },
    });
    expect(early.statusCode).toBe(409);
    expect(early.json()).toMatchObject({ details: { reason: "not_ready" } });
    expect(
      await owner.db.select().from(rxCorrections).where(eq(rxCorrections.analysisId, id)),
    ).toHaveLength(0);
  });
});

describe("GET /rx/:id/candidates/:itemIndex", () => {
  it("returns the best drugs for the line, classified", async () => {
    const who = await user();
    await owner.db.insert(drugs).values([
      { brandEn: "Augmentin 1g", normalizedEn: "augmentin", form: "tablet", strengthText: "1 g" },
      {
        brandEn: "Augmentin 625mg",
        normalizedEn: "augmentin",
        form: "tablet",
        strengthText: "625 mg",
      },
    ]);
    const id = await analysis(who, [await page(who)]);
    const res = await harness.call("GET", `/rx/${id}/candidates/0`, { jar: who.jar });
    expect(res.statusCode, res.body).toBe(200);
    const { candidates } = res.json<{
      candidates: { brandEn: string; matchClass: string; score: number }[];
    }>();
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(5);
    expect(candidates[0]?.brandEn).toBe("Augmentin 1g");
    expect(["accept", "verify", "unmatched"]).toContain(candidates[0]?.matchClass);

    expect((await harness.call("GET", `/rx/${id}/candidates/9`, { jar: who.jar })).statusCode).toBe(
      404,
    );
    expect(
      (await harness.call("GET", `/rx/${id}/candidates/-1`, { jar: who.jar })).statusCode,
    ).toBe(400);
  });
});

describe("GET /rx/:id/events", () => {
  /** Reads events until one of type done/failed (the server closes) or the wait runs out. */
  async function stream(
    id: string,
    who: Person,
    trigger: () => Promise<void> = async () => undefined,
    waitMs = 10_000,
  ) {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/rx/${id}/events`, {
      headers: { cookie: cookieHeader(who.jar), origin: WEB },
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    const decoder = new TextDecoder();
    const events: { type: string; seq: number; [key: string]: unknown }[] = [];
    let buffer = "";
    let triggered = false;
    const timer = setTimeout(() => controller.abort(), waitMs);
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) events.push(JSON.parse(line.slice("data: ".length)));
        }
        if (!triggered && events.length > 0) {
          triggered = true;
          await trigger();
        }
      }
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
    return events;
  }

  const publish = (id: string, event: Record<string, unknown>) =>
    redis.publish(rxChannel(id), JSON.stringify(event));

  it("sends the current state first, relays the worker's events and closes after done", async () => {
    const who = await user();
    const id = await analysis(who, [await page(who)], { status: "processing", result: null });
    const events = await stream(id, who, async () => {
      await publish(id, { type: "step", step: "match", seq: 2 });
      await publish(id, { type: "done", status: "done", seq: 3 });
    });
    expect(events).toEqual([
      { type: "step", step: "read", seq: 0 },
      { type: "step", step: "match", seq: 2 },
      { type: "done", status: "done", seq: 3 },
    ]);
  });

  it("starts from the last published step for a client that connects late", async () => {
    const who = await user();
    const id = await analysis(who, [await page(who)], { status: "verifying", result: null });
    await redis.set(`rx:${id}:last`, JSON.stringify({ type: "step", step: "verify", seq: 3 }));
    const events = await stream(id, who, async () => {
      // A replayed older event is not shown twice.
      await publish(id, { type: "step", step: "verify", seq: 3 });
      await publish(id, { type: "failed", errorRef: "WSF-TEST-0001", seq: 4 });
    });
    expect(events).toEqual([
      { type: "step", step: "verify", seq: 3 },
      { type: "failed", errorRef: "WSF-TEST-0001", seq: 4 },
    ]);
  });

  it("reports an already finished analysis once and ends", async () => {
    const who = await user();
    const done = await analysis(who, [await page(who)]);
    expect(await stream(done, who)).toEqual([{ type: "done", status: "done", seq: 0 }]);
    const failed = await analysis(who, [await page(who)], {
      status: "failed",
      result: null,
      errorRef: "WSF-ABCD-EFGH",
    });
    expect(await stream(failed, who)).toEqual([
      { type: "failed", errorRef: "WSF-ABCD-EFGH", seq: 0 },
    ]);
  });
});
