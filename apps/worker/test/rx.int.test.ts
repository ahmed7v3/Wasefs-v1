import { randomUUID } from "node:crypto";

import { PutObjectCommand } from "@aws-sdk/client-s3";
import {
  AiProviderError,
  FakeAdapter,
  skillVersion,
  type FakeReply,
  type FakeScript,
} from "@wasfa/ai";
import {
  aiModels,
  aiProviders,
  aiTaskRoutes,
  aiUsage,
  createDb,
  creditLedger,
  creditReservations,
  creditWallets,
  drugs,
  files,
  grant,
  reserve,
  rxAnalyses,
  rxPages,
  seedDefaults,
  siteSettings,
  users,
  type RxAnalysis,
} from "@wasfa/db";
import { busyLockKey } from "@wasfa/shared/busy";
import { RX_SKILL_NAME } from "@wasfa/shared/rx";
import {
  rxEventSchema,
  rxResultSchema,
  type RxEvent,
  type RxExtraction,
  type RxResult,
  type RxVerifyAnswer,
} from "@wasfa/shared/schemas/rx";
import { uploadsStorageConfig } from "@wasfa/shared/storage";
import { and, eq, isNull } from "drizzle-orm";
import { Redis } from "ioredis";
import { pino } from "pino";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAiRuntime } from "../src/ai/runtime.js";
import { rxAnalyzeJob } from "../src/jobs/rx.job.js";
import { ObjectStore } from "../src/storage/object-store.js";

import { TEST_ENCRYPTION_KEY } from "./support/env.js";
import { startPostgres, type TestPostgres } from "./support/postgres.js";
import { startRedis, type TestRedis } from "./support/redis.js";
import { startStorage, type TestStorage } from "./support/storage.js";

/*
 * `rx.analyze` end to end with the scripted fake provider: real Postgres (as the restricted
 * `wasfa_api` role), Redis and a real S3 API. The provider answers from fixtures; nothing here
 * calls a model.
 */

const logLines: string[] = [];
const logger = pino(
  { level: "info" },
  {
    write: (line: string) => {
      logLines.push(line);
    },
  },
);

let postgres: TestPostgres;
let redisServer: TestRedis;
let storage: TestStorage;
let owner: ReturnType<typeof createDb>;
let worker: ReturnType<typeof createDb>;
let redis: Redis;
let subscriber: Redis;
let store: ObjectStore;
let routeVersion: number;
let jpeg: Buffer;
const published = new Map<string, RxEvent[]>();

beforeAll(async () => {
  [postgres, redisServer, storage] = await Promise.all([
    startPostgres(),
    startRedis(),
    startStorage(),
  ]);
  owner = createDb({ url: postgres.ownerUrl, max: 2 });
  worker = createDb({ url: postgres.apiUrl, max: 4 });
  await seedDefaults(owner.db);
  // The suite below exercises the database-matching pipeline; the model-only mode has its own describe.
  await setRx({ details: false });
  redis = new Redis(redisServer.url, { maxRetriesPerRequest: null });
  subscriber = redis.duplicate();
  subscriber.on("pmessage", (_pattern, channel, message) => {
    const parsed = rxEventSchema.parse(JSON.parse(message));
    published.set(channel, [...(published.get(channel) ?? []), parsed]);
  });
  await subscriber.psubscribe("rx:*");

  const config = uploadsStorageConfig({ ...storage.env, R2_UPLOADS_REGION: "auto" });
  if (config === undefined) throw new Error("test storage is not configured");
  store = new ObjectStore(config);
  jpeg = await sharp({
    create: { width: 800, height: 1000, channels: 3, background: "#ffffff" },
  })
    .jpeg()
    .toBuffer();

  // The fake provider with a vision + json model, as the default route for both rx tasks.
  const [provider] = await owner.db
    .insert(aiProviders)
    .values({ key: "fake-rx", kind: "fake", dataPolicy: "paid_no_training", enabled: true })
    .returning({ id: aiProviders.id });
  if (!provider) throw new Error("provider insert failed");
  const [model] = await owner.db
    .insert(aiModels)
    .values({
      providerId: provider.id,
      modelId: "fake-rx-model",
      displayName: "Fake rx",
      capabilities: ["vision", "json"],
      priceInputUsdMicrosPerM: 1_000_000,
      priceOutputUsdMicrosPerM: 4_000_000,
    })
    .returning({ id: aiModels.id });
  if (!model) throw new Error("model insert failed");
  for (const task of ["rx_extract", "rx_verify"] as const) {
    await owner.db
      .update(aiTaskRoutes)
      .set({ models: [{ modelId: model.id, params: {} }], version: 7 })
      .where(
        and(
          eq(aiTaskRoutes.task, task),
          eq(aiTaskRoutes.mode, "balanced"),
          isNull(aiTaskRoutes.planId),
        ),
      );
  }
  routeVersion = 7;

  await owner.db.insert(drugs).values([
    { brandEn: "Augmentin", normalizedEn: "augmentin", form: "tablet" },
    { brandEn: "Panadol", normalizedEn: "panadol", form: "tablet" },
  ]);
}, 240_000);

afterAll(async () => {
  await subscriber?.quit();
  await redis?.quit();
  store?.close();
  await Promise.all([owner?.close(), worker?.close()]);
  await Promise.all([postgres?.stop(), redisServer?.stop(), storage?.stop()]);
});

/* ---- fixtures ------------------------------------------------------------------------------ */

const line = (
  overrides: Partial<RxExtraction["items"][number]> = {},
): RxExtraction["items"][number] => ({
  rawText: "Augmentin 1x3",
  name: "Augmentin",
  activeIngredient: null,
  strength: null,
  form: "tablet",
  dose: null,
  frequency: "1×3",
  duration: "x 5 days",
  route: null,
  notes: null,
  alternatives: [],
  legibility: "clear",
  confidence: 0.95,
  box_2d: [100, 100, 200, 600],
  page: 0,
  ...overrides,
});

const reading = (items: RxExtraction["items"]): RxExtraction => ({
  items,
  prescriberLegible: true,
  date: null,
  unreadableRegions: [],
});

/** The content parts of a request message (tool results have none; these tests never use tools). */
const partsOf = (message: Parameters<FakeScript>[0]["messages"][number] | undefined) =>
  message === undefined || message.role === "tool" ? [] : message.parts;

const textOf = (req: Parameters<FakeScript>[0]): string =>
  req.messages
    .flatMap((message) => partsOf(message))
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");

const isVerifyCall = (req: Parameters<FakeScript>[0]): boolean =>
  textOf(req).includes("Re-read these unclear");

const isDetailsCall = (req: Parameters<FakeScript>[0]): boolean =>
  textOf(req).includes('Write the "Details step"');

/** The `rx` setting for the next analyses: `null` removes the row, so the defaults apply. */
async function setRx(value: Record<string, unknown> | null): Promise<void> {
  if (value === null) {
    await owner.db.delete(siteSettings).where(eq(siteSettings.key, "rx"));
    return;
  }
  const full = {
    creditsPerPage: 1,
    maxPages: 4,
    modelWarnings: false,
    verifyMaxItems: 5,
    ...value,
  };
  await owner.db
    .insert(siteSettings)
    .values({ key: "rx", value: full })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value: full } });
}

/** The `medications` setting for the next analyses: `null` removes the row, so the defaults apply. */
async function setMedications(value: Record<string, unknown> | null): Promise<void> {
  if (value === null) {
    await owner.db.delete(siteSettings).where(eq(siteSettings.key, "medications"));
    return;
  }
  await owner.db
    .insert(siteSettings)
    .values({ key: "medications", value })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value } });
}

/** Scripts a provider that reads `extraction` and, when asked to verify, answers with `verify(candidateIds)`. */
function provider(
  extraction: RxExtraction,
  verify: (candidates: string[]) => RxVerifyAnswer = () => ({ answers: [] }),
  details: (lines: string[]) => string = () => "not json",
): FakeScript {
  return (req) => {
    if (isDetailsCall(req)) {
      return details(textOf(req).split("\n"));
    }
    if (isVerifyCall(req)) {
      const ids = [...textOf(req).matchAll(/^- ([0-9a-f-]{36}) \|/gm)].map(
        (match) => match[1] ?? "",
      );
      return JSON.stringify(verify(ids));
    }
    return JSON.stringify(extraction);
  };
}

interface Case {
  userId: string;
  analysisId: string;
  reservationId: string;
}

/** A queued analysis with its pages in storage, its credits reserved and the busy lock held. */
async function queued(options: { pages?: number; credits?: number } = {}): Promise<Case> {
  const pages = options.pages ?? 1;
  const [user] = await owner.db
    .insert(users)
    .values({ name: "Rx Person", email: `rx-${randomUUID()}@example.com`, emailVerified: true })
    .returning({ id: users.id });
  if (user === undefined) throw new Error("seed failed");
  const wallet = { type: "user", id: user.id } as const;
  await grant(owner.db, wallet, options.credits ?? 30, "2026-10");

  const analysisId = randomUUID();
  const { reservation } = await reserve(owner.db, wallet, pages, {
    idempotencyKey: `rx:${analysisId}:reserve`,
    purpose: "rx",
  });
  await owner.db.insert(rxAnalyses).values({
    id: analysisId,
    ownerUserId: user.id,
    createdBy: user.id,
    status: "queued",
    mode: "balanced",
    reservationId: reservation.id,
    skillVersion: skillVersion(RX_SKILL_NAME),
  });
  for (let index = 0; index < pages; index += 1) {
    const fileId = randomUUID();
    const key = `test/${fileId}.jpg`;
    await storage.s3.send(
      new PutObjectCommand({
        Bucket: storage.bucket,
        Key: key,
        Body: jpeg,
        ContentType: "image/jpeg",
      }),
    );
    await owner.db.insert(files).values({
      id: fileId,
      ownerUserId: user.id,
      createdBy: user.id,
      purpose: "rx_page",
      r2Key: key,
      mime: "image/jpeg",
      bytes: jpeg.byteLength,
      sha256: randomUUID().replaceAll("-", "").padEnd(64, "0"),
      status: "processed",
    });
    await owner.db.insert(rxPages).values({ analysisId, pageNo: index + 1, fileId });
  }
  await redis.set(busyLockKey(user.id, "rx"), "1", "EX", 600);
  return { userId: user.id, analysisId, reservationId: reservation.id };
}

function runtime(script: FakeScript) {
  const adapter = new FakeAdapter(script);
  const ai = createAiRuntime({
    env: { ENCRYPTION_KEY: TEST_ENCRYPTION_KEY, NODE_ENV: "test" },
    db: worker.db,
    redis,
    logger,
    adapterFor: () => adapter,
  });
  return { adapter, ai };
}

async function run(testCase: Case, script: FakeScript) {
  const { adapter, ai } = runtime(script);
  await rxAnalyzeJob(
    { analysisId: testCase.analysisId },
    { db: worker.db, redis, logger, storage: store, ai },
  );
  return adapter;
}

async function analysisOf(id: string): Promise<RxAnalysis> {
  const [row] = await owner.db.select().from(rxAnalyses).where(eq(rxAnalyses.id, id));
  if (row === undefined) throw new Error("no analysis");
  return row;
}

async function balanceOf(userId: string): Promise<number> {
  const [wallet] = await owner.db
    .select({ balance: creditWallets.balance })
    .from(creditWallets)
    .where(eq(creditWallets.ownerUserId, userId));
  return wallet?.balance ?? 0;
}

async function ledgerKinds(userId: string): Promise<string[]> {
  const [wallet] = await owner.db
    .select({ id: creditWallets.id })
    .from(creditWallets)
    .where(eq(creditWallets.ownerUserId, userId));
  if (wallet === undefined) return [];
  const rows = await owner.db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.walletId, wallet.id));
  return rows.sort((a, b) => a.id.localeCompare(b.id)).map((row) => row.kind);
}

/** Events published for the analysis (waits a moment: pub/sub delivery is asynchronous). */
async function eventsOf(id: string, count: number): Promise<RxEvent[]> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const found = published.get(`rx:${id}`) ?? [];
    if (found.length >= count) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return published.get(`rx:${id}`) ?? [];
}

const resultOf = (row: RxAnalysis): RxResult => rxResultSchema.parse(row.result);

/* ---- tests --------------------------------------------------------------------------------- */

describe("rx.analyze", () => {
  it("reads, matches, finalizes and settles: the happy path", async () => {
    const testCase = await queued();
    const adapter = await run(testCase, provider(reading([line()])));

    const row = await analysisOf(testCase.analysisId);
    expect(row.status).toBe("done");
    const result = resultOf(row);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      name: "Augmentin",
      matchedDrugId: expect.any(String),
      frequency: "3 مرات يوميًا",
      verified: "not_needed",
      badge: "high",
    });
    // One call to read, none to verify.
    expect(adapter.requests).toHaveLength(1);
    expect(partsOf(adapter.requests[0]?.messages[0]).some((part) => part.type === "image")).toBe(
      true,
    );

    // The price (1 page x 1 credit) is charged exactly once.
    expect(row.creditsCharged).toBe(1);
    expect(await balanceOf(testCase.userId)).toBe(29);
    expect(await ledgerKinds(testCase.userId)).toEqual([
      "grant",
      "usage_reserve",
      "release",
      "usage_settle",
    ]);
    // The busy lock is gone and the user can start another one.
    expect(await redis.exists(busyLockKey(testCase.userId, "rx"))).toBe(0);
    // Events, in order, ending with done.
    expect(await eventsOf(testCase.analysisId, 4)).toEqual([
      { type: "step", step: "read", seq: 1 },
      { type: "step", step: "match", seq: 2 },
      { type: "step", step: "finalize", seq: 3 },
      { type: "done", status: "done", seq: 4 },
    ]);
  });

  it("records the route version, skill version, provider cost and credits", async () => {
    const testCase = await queued({ pages: 2 });
    await run(
      testCase,
      provider(reading([line(), line({ name: "Panadol", rawText: "Panadol", page: 1 })])),
    );

    const row = await analysisOf(testCase.analysisId);
    expect(row).toMatchObject({
      status: "done",
      routeVersion,
      creditsCharged: 2,
      skillVersion: skillVersion(RX_SKILL_NAME),
    });
    expect(row.skillVersion).toMatch(/^prescription-analysis@[0-9a-f]{12}$/);
    expect(row.startedAt).not.toBeNull();
    expect(row.finishedAt).not.toBeNull();

    const usage = await owner.db
      .select()
      .from(aiUsage)
      .where(eq(aiUsage.requestId, testCase.analysisId));
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      task: "rx_extract",
      routeVersion,
      outcome: "ok",
      ownerUserId: testCase.userId,
      userId: testCase.userId,
      creditsCharged: 2,
    });
    expect(usage[0]?.costUsdMicros).toBeGreaterThan(0);
    // The ledger row of the charge points at that usage row.
    const [settleRow] = await owner.db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.reservationId, testCase.reservationId))
      .then((rows) => rows.filter((entry) => entry.kind === "usage_settle"));
    expect(settleRow).toMatchObject({ amount: -2, aiUsageId: usage[0]?.id });
  });

  it("sends the flagged lines through the verification pass", async () => {
    const testCase = await queued();
    const extraction = reading([
      line(),
      // A typo ("Augmentn") lands in the verify zone; the doctor's hand also lowers the confidence.
      line({
        rawText: "Augmentn",
        name: "Augmentn",
        confidence: 0.6,
        box_2d: [300, 100, 400, 500],
      }),
    ]);
    const adapter = await run(
      testCase,
      provider(extraction, (ids) => ({
        answers: [{ index: 1, kind: "candidate", id: ids[0] ?? "" }],
      })),
    );

    const row = await analysisOf(testCase.analysisId);
    expect(row.status).toBe("done");
    expect(adapter.requests).toHaveLength(2);
    const verifyCall = adapter.requests[1];
    if (verifyCall === undefined) throw new Error("no verify call");
    expect(isVerifyCall(verifyCall)).toBe(true);
    // One cropped image per flagged line, not the whole pages.
    expect(partsOf(verifyCall.messages[0]).filter((part) => part.type === "image")).toHaveLength(1);

    const result = resultOf(row);
    expect(result.items[0]?.verified).toBe("not_needed");
    expect(result.items[1]).toMatchObject({ name: "Augmentin", verified: "confirmed" });
    expect(result.items[1]?.matchedDrugId).not.toBeNull();
    // Verification can only lower trust: the line is shown below the very top.
    expect(result.items[1]?.confidence).toBeLessThanOrEqual(0.6);

    const usage = await owner.db
      .select()
      .from(aiUsage)
      .where(eq(aiUsage.requestId, testCase.analysisId));
    expect(usage.map((entry) => entry.task).sort()).toEqual(["rx_extract", "rx_verify"]);
    expect(await eventsOf(testCase.analysisId, 5)).toEqual([
      { type: "step", step: "read", seq: 1 },
      { type: "step", step: "match", seq: 2 },
      { type: "step", step: "verify", seq: 3 },
      { type: "step", step: "finalize", seq: 4 },
      { type: "done", status: "done", seq: 5 },
    ]);
  });

  it("shows a line the verifier cannot read as unreadable, and an unlisted name as not confirmed", async () => {
    const testCase = await queued();
    const extraction = reading([
      line({ name: "Augmentn", rawText: "Augmentn", confidence: 0.55 }),
      line({
        name: "Qwertyzzz",
        rawText: "Qwertyzzz",
        confidence: 0.99,
        box_2d: [300, 100, 400, 500],
      }),
    ]);
    const adapter = await run(
      testCase,
      provider(extraction, () => ({ answers: [{ index: 0, kind: "unreadable" }] })),
    );
    const result = resultOf(await analysisOf(testCase.analysisId));
    expect(adapter.requests.length).toBeGreaterThanOrEqual(2);
    expect(result.items[0]).toMatchObject({ matchedDrugId: null, verified: "unreadable" });
    expect(result.items[0]?.badge).toBe("low");
    // Unmatched, however sure the model was: never "high", capped at 0.84.
    expect(result.items[1]).toMatchObject({ name: "Qwertyzzz", matchedDrugId: null });
    expect(result.items[1]?.badge).not.toBe("high");
    expect(result.items[1]?.confidence).toBeLessThanOrEqual(0.84);
  });

  it("matches the text the verifier read when it proposes another name", async () => {
    const testCase = await queued();
    await run(
      testCase,
      provider(reading([line({ name: "Pnadol", rawText: "Pnadol", confidence: 0.5 })]), () => ({
        answers: [{ index: 0, kind: "other", text: "Panadol" }],
      })),
    );
    const item = resultOf(await analysisOf(testCase.analysisId)).items[0];
    expect(item).toMatchObject({ name: "Panadol", verified: "corrected" });
    expect(item?.matchedDrugId).not.toBeNull();
    expect(item?.confidence).toBeLessThanOrEqual(0.6);
  });

  it("refuses an answer that names a drug nobody offered", async () => {
    const testCase = await queued();
    await run(
      testCase,
      provider(reading([line({ name: "Augmentn", rawText: "Augmentn", confidence: 0.9 })]), () => ({
        answers: [{ index: 0, kind: "candidate", id: randomUUID() }],
      })),
    );
    const item = resultOf(await analysisOf(testCase.analysisId)).items[0];
    expect(item).toMatchObject({ matchedDrugId: null, verified: "unreadable" });
  });

  it("does nothing for an analysis that is already finished (a cache hit has no provider call)", async () => {
    const testCase = await queued();
    await run(testCase, provider(reading([line()])));
    const before = await analysisOf(testCase.analysisId);
    const stored = resultOf(before);

    const copy = await queued();
    await owner.db
      .update(rxAnalyses)
      .set({
        status: "done",
        result: stored,
        cacheOf: testCase.analysisId,
        routeVersion,
        finishedAt: new Date(),
      })
      .where(eq(rxAnalyses.id, copy.analysisId));
    const adapter = await run(copy, () => {
      throw new Error("the provider must not be called");
    });
    expect(adapter.requests).toHaveLength(0);
    const after = await analysisOf(copy.analysisId);
    expect(after.status).toBe("done");
    expect(after.result).toEqual(before.result);
    // The finished job did not touch the credits or the lock of its (stale) job.
    expect(await balanceOf(copy.userId)).toBe(30 - 1);
  });

  it("refunds everything when nothing could be read", async () => {
    const testCase = await queued({ pages: 2 });
    await run(testCase, provider(reading([])));

    const row = await analysisOf(testCase.analysisId);
    expect(row).toMatchObject({ status: "refunded", creditsCharged: 0 });
    expect(resultOf(row).items).toEqual([]);
    expect(await balanceOf(testCase.userId)).toBe(30);
    expect(await ledgerKinds(testCase.userId)).toEqual([
      "grant",
      "usage_reserve",
      "release",
      "usage_settle",
      "refund",
    ]);
    const [refund] = await owner.db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.idempotencyKey, `refund:rx:${testCase.analysisId}:refund`));
    expect(refund).toMatchObject({ kind: "refund", amount: 2, reason: "no_result" });
    expect(await redis.exists(busyLockKey(testCase.userId, "rx"))).toBe(0);
    const events = await eventsOf(testCase.analysisId, 4);
    expect(events.at(-1)).toMatchObject({ type: "done", status: "refunded" });
  });

  it("refunds when every line is unreadable", async () => {
    const testCase = await queued();
    await run(
      testCase,
      provider(reading([line({ name: "Augmentn", rawText: "", confidence: 0.4 })]), () => ({
        answers: [{ index: 0, kind: "unreadable" }],
      })),
    );
    const row = await analysisOf(testCase.analysisId);
    expect(row.status).toBe("refunded");
    expect(await balanceOf(testCase.userId)).toBe(30);
  });

  it("fails cleanly when the provider fails: credits back, a reference, the lock freed", async () => {
    const testCase = await queued();
    const adapter = await run(
      testCase,
      () => new AiProviderError("bad_request") satisfies FakeReply,
    );

    const row = await analysisOf(testCase.analysisId);
    expect(row.status).toBe("failed");
    expect(row.errorRef).toMatch(/^WSF-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(row.result).toBeNull();
    // The read step was retried once, then given up.
    expect(adapter.requests).toHaveLength(2);
    expect(await balanceOf(testCase.userId)).toBe(30);
    const [reservation] = await owner.db
      .select()
      .from(creditReservations)
      .where(eq(creditReservations.id, testCase.reservationId));
    expect(reservation?.status).toBe("released");
    expect(await redis.exists(busyLockKey(testCase.userId, "rx"))).toBe(0);
    expect(await eventsOf(testCase.analysisId, 2)).toEqual([
      { type: "step", step: "read", seq: 1 },
      { type: "failed", errorRef: row.errorRef, seq: 2 },
    ]);
    // The log carries codes and ids, never a prescription.
    const failure = logLines
      .map((entry) => JSON.parse(entry) as Record<string, unknown>)
      .find(
        (entry) => entry.analysisId === testCase.analysisId && entry.msg === "rx analysis failed",
      );
    expect(failure).toMatchObject({ errorRef: row.errorRef, step: "read" });
  });

  it("retries the read once and succeeds when only the first attempt fails", async () => {
    const testCase = await queued();
    const answer = provider(reading([line()]));
    const adapter = await run(testCase, (req, call) =>
      call === 0 ? new AiProviderError("bad_request") : answer(req, call),
    );
    expect(adapter.requests).toHaveLength(2);
    expect((await analysisOf(testCase.analysisId)).status).toBe("done");
    expect(await balanceOf(testCase.userId)).toBe(29);
  });

  it("repairs an answer that does not match the schema once, and fails when it stays wrong", async () => {
    const repairable = await queued();
    const good = provider(reading([line()]));
    const repaired = await run(repairable, (req, call) =>
      call === 0 ? "not json at all" : good(req, call),
    );
    expect(repaired.requests).toHaveLength(2);
    // The repair message names the problem without quoting the answer.
    expect(textOf(repaired.requests[1] as Parameters<FakeScript>[0])).toContain(
      "failed validation",
    );
    expect((await analysisOf(repairable.analysisId)).status).toBe("done");

    const hopeless = await queued();
    await run(hopeless, () => "still not json");
    expect((await analysisOf(hopeless.analysisId)).status).toBe("failed");
    expect(await balanceOf(hopeless.userId)).toBe(30);
  });

  it("fails and releases when the rx kill switch is on", async () => {
    await owner.db
      .insert(siteSettings)
      .values({
        key: "ai",
        value: {
          killSwitch: { all: false, rx: true, chat: false, search: false, wa_agent: false },
        },
      })
      .onConflictDoUpdate({
        target: siteSettings.key,
        set: {
          value: {
            killSwitch: { all: false, rx: true, chat: false, search: false, wa_agent: false },
          },
        },
      });
    try {
      const testCase = await queued();
      const adapter = await run(testCase, provider(reading([line()])));
      expect(adapter.requests).toHaveLength(0);
      expect((await analysisOf(testCase.analysisId)).status).toBe("failed");
      expect(await balanceOf(testCase.userId)).toBe(30);
      expect(await redis.exists(busyLockKey(testCase.userId, "rx"))).toBe(0);
    } finally {
      await owner.db.delete(siteSettings).where(eq(siteSettings.key, "ai"));
    }
  });

  it("does not charge twice when a job runs again", async () => {
    const testCase = await queued();
    const script = provider(reading([line()]));
    await run(testCase, script);
    expect(await balanceOf(testCase.userId)).toBe(29);

    // A duplicate delivery after the end: exits at once.
    const duplicate = await run(testCase, script);
    expect(duplicate.requests).toHaveLength(0);

    // A crash after the credits moved but before the result was stored: the analysis is back in
    // flight and the whole job runs again. The settled reservation is not charged a second time.
    await owner.db
      .update(rxAnalyses)
      .set({ status: "processing", result: null, finishedAt: null, creditsCharged: 0 })
      .where(eq(rxAnalyses.id, testCase.analysisId));
    await redis.set(busyLockKey(testCase.userId, "rx"), "1", "EX", 600);
    await run(testCase, script);

    const row = await analysisOf(testCase.analysisId);
    expect(row).toMatchObject({ status: "done", creditsCharged: 1 });
    expect(await balanceOf(testCase.userId)).toBe(29);
    expect(await ledgerKinds(testCase.userId)).toEqual([
      "grant",
      "usage_reserve",
      "release",
      "usage_settle",
    ]);
    // Both runs published, and the counter kept growing instead of starting over.
    const events = await eventsOf(testCase.analysisId, 8);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("does not refund twice when a refunded analysis is run again", async () => {
    const testCase = await queued();
    await run(testCase, provider(reading([])));
    expect(await balanceOf(testCase.userId)).toBe(30);
    await owner.db
      .update(rxAnalyses)
      .set({ status: "processing", result: null, finishedAt: null })
      .where(eq(rxAnalyses.id, testCase.analysisId));
    await run(testCase, provider(reading([])));
    expect(await balanceOf(testCase.userId)).toBe(30);
    expect((await ledgerKinds(testCase.userId)).filter((kind) => kind === "refund")).toHaveLength(
      1,
    );
  });

  it("publishes nothing more for a job that already failed", async () => {
    const testCase = await queued();
    await run(testCase, () => new AiProviderError("bad_request"));
    // The same job again (a BullMQ retry): the analysis already failed, so it stays failed.
    const events = await eventsOf(testCase.analysisId, 2);
    await run(testCase, provider(reading([line()])));
    expect(await eventsOf(testCase.analysisId, 2)).toEqual(events);
    expect(events.map((event) => event.seq)).toEqual([1, 2]);
  });
});

describe("rx.analyze without the drug database (the model reads on its own)", () => {
  beforeAll(async () => {
    await setRx(null);
    await setMedications({ mode: "ai_only" });
  });
  afterAll(async () => {
    await setRx({ details: false });
    await setMedications(null);
  });

  it("skips matching and verification, trusts the model's confidence and flags duplicates by generic name", async () => {
    const testCase = await queued();
    const adapter = await run(
      testCase,
      provider(
        reading([
          line({ name: "Panadol", activeIngredient: "paracetamol", confidence: 0.95 }),
          line({ name: "Adol", activeIngredient: "paracetamol", confidence: 0.62 }),
        ]),
        () => {
          throw new Error("verification must not run");
        },
        () => JSON.stringify({ items: [], overview: null }),
      ),
    );
    const row = await analysisOf(testCase.analysisId);
    expect(row.status).toBe("done");
    const result = rxResultSchema.parse(row.result);
    expect(result.matching).toBe("model");
    expect(result.items.map((item) => item.badge)).toEqual(["high", "medium"]);
    expect(result.items.every((item) => item.matchedDrugId === null)).toBe(true);
    expect(result.findings).toEqual([
      { kind: "duplicate_ingredient", itemIndexes: [0, 1], ingredient: "paracetamol" },
    ]);
    // One read call and the details call: no verify.
    expect(adapter.requests.filter(isVerifyCall)).toHaveLength(0);
    expect(
      published.get(`rx:${testCase.analysisId}`)?.map((e) => ("step" in e ? e.step : e.type)),
    ).toEqual(["read", "finalize", "done"]);
  });

  it("adds details and an overview from a text-only call, and never sends the image to it", async () => {
    const testCase = await queued();
    const adapter = await run(
      testCase,
      provider(
        reading([line({ name: "Dostinex", activeIngredient: "cabergoline" })]),
        () => ({ answers: [] }),
        () =>
          JSON.stringify({
            items: [
              {
                index: 0,
                purpose: "يُستخدم عادةً لخفض مستوى البرولاكتين.",
                sideEffects: ["غثيان", "دوخة"],
                precautions: ["راجع الطبيب قبل الاستخدام أثناء الحمل"],
              },
            ],
            overview: {
              summary: "أدوية تُستخدم عادةً لاضطرابات هرمونية.",
              likelyConditions: ["قد يُستخدم في ارتفاع البرولاكتين"],
            },
          }),
      ),
    );
    const result = rxResultSchema.parse((await analysisOf(testCase.analysisId)).result);
    expect(result.detailsStatus).toBe("ready");
    expect(result.items[0]?.details?.sideEffects).toEqual(["غثيان", "دوخة"]);
    expect(result.overview?.likelyConditions).toEqual(["قد يُستخدم في ارتفاع البرولاكتين"]);
    const detailsRequest = adapter.requests.find(isDetailsCall);
    expect(
      detailsRequest?.messages.flatMap((m) => partsOf(m)).some((p) => p.type === "image"),
    ).toBe(false);
  });

  it("keeps a done analysis, without details, when the details step fails", async () => {
    const testCase = await queued();
    await run(testCase, provider(reading([line({ name: "Dostinex" })])));
    const row = await analysisOf(testCase.analysisId);
    expect(row.status).toBe("done");
    const result = rxResultSchema.parse(row.result);
    expect(result.detailsStatus).toBe("unavailable");
    expect(result.items[0]?.details ?? null).toBeNull();
    expect(row.creditsCharged).toBeGreaterThan(0);
  });
});
