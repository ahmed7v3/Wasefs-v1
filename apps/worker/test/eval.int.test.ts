import { randomUUID } from "node:crypto";

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { FakeAdapter, skillVersion, type FakeScript } from "@wasfa/ai";
import {
  aiEvalItems,
  aiEvalResults,
  aiEvalRuns,
  aiEvalSets,
  aiModels,
  aiProviders,
  aiTaskRoutes,
  aiUsage,
  createDb,
  creditLedger,
  drugs,
  files,
  seedDefaults,
  users,
} from "@wasfa/db";
import {
  EVAL_SHEET_COLUMNS,
  evalImageKey,
  evalRunMetricsSchema,
  evalStagingKey,
} from "@wasfa/shared/evals";
import { RX_SKILL_NAME } from "@wasfa/shared/rx";
import { evalRouteSnapshotSchema } from "@wasfa/shared/schemas/admin-evals";
import { uploadsStorageConfig } from "@wasfa/shared/storage";
import { and, eq, isNull } from "drizzle-orm";
import ExcelJS from "exceljs";
import { Redis } from "ioredis";
import { pino } from "pino";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAiRuntime } from "../src/ai/runtime.js";
import { importEvalSet } from "../src/eval/import.js";
import { runEval } from "../src/eval/run.js";
import { evalImportJob } from "../src/jobs/eval.job.js";
import { ObjectStore } from "../src/storage/object-store.js";

import { TEST_ENCRYPTION_KEY } from "./support/env.js";
import { startPostgres, type TestPostgres } from "./support/postgres.js";
import { startRedis, type TestRedis } from "./support/redis.js";
import { startStorage, type TestStorage } from "./support/storage.js";

import type { RxExtraction } from "@wasfa/shared/schemas/rx";

/*
 * Accuracy evaluation end to end with the scripted fake provider: the real pipeline (read, match,
 * finalize) over a tiny seeded set, scored against the labels; and the label-set import.
 */

const logger = pino({ level: "silent" });

let postgres: TestPostgres;
let redisServer: TestRedis;
let storage: TestStorage;
let owner: ReturnType<typeof createDb>;
let worker: ReturnType<typeof createDb>;
let redis: Redis;
let store: ObjectStore;
let jpeg: Buffer;
let modelId: string;
let adminId: string;

beforeAll(async () => {
  [postgres, redisServer, storage] = await Promise.all([
    startPostgres(),
    startRedis(),
    startStorage(),
  ]);
  owner = createDb({ url: postgres.ownerUrl, max: 2 });
  worker = createDb({ url: postgres.apiUrl, max: 4 });
  await seedDefaults(owner.db);
  redis = new Redis(redisServer.url, { maxRetriesPerRequest: null });
  const config = uploadsStorageConfig({ ...storage.env, R2_UPLOADS_REGION: "auto" });
  if (config === undefined) throw new Error("test storage is not configured");
  store = new ObjectStore(config);
  jpeg = await sharp({ create: { width: 800, height: 1000, channels: 3, background: "#ffffff" } })
    .jpeg()
    .toBuffer();

  const [provider] = await owner.db
    .insert(aiProviders)
    .values({ key: "fake-eval", kind: "fake", dataPolicy: "paid_no_training", enabled: true })
    .returning({ id: aiProviders.id });
  const [model] = await owner.db
    .insert(aiModels)
    .values({
      providerId: provider?.id ?? "",
      modelId: "fake-eval-model",
      displayName: "Fake eval",
      capabilities: ["vision", "json"],
      priceInputUsdMicrosPerM: 1_000_000,
      priceOutputUsdMicrosPerM: 4_000_000,
    })
    .returning({ id: aiModels.id });
  modelId = model?.id ?? "";
  for (const task of ["rx_extract", "rx_verify"] as const) {
    await owner.db
      .update(aiTaskRoutes)
      .set({ models: [{ modelId, params: {} }], version: 3 })
      .where(
        and(
          eq(aiTaskRoutes.task, task),
          eq(aiTaskRoutes.mode, "balanced"),
          isNull(aiTaskRoutes.planId),
        ),
      );
  }
  await owner.db.insert(drugs).values([
    { brandEn: "Augmentin", normalizedEn: "augmentin", form: "tablet" },
    { brandEn: "Panadol", normalizedEn: "panadol", form: "tablet" },
  ]);
  const [admin] = await owner.db
    .insert(users)
    .values({ name: "Eval Admin", email: `eval-${randomUUID()}@example.com`, emailVerified: true })
    .returning({ id: users.id });
  adminId = admin?.id ?? "";
}, 240_000);

afterAll(async () => {
  await redis?.quit();
  store?.close();
  await Promise.all([owner?.close(), worker?.close()]);
  await Promise.all([postgres?.stop(), redisServer?.stop(), storage?.stop()]);
});

const extraction: RxExtraction = {
  items: [
    {
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
      confidence: 0.95,
      box_2d: [100, 100, 200, 600],
      page: 0,
    },
  ],
  prescriberLegible: true,
  date: null,
  unreadableRegions: [],
};
const script: FakeScript = () => JSON.stringify(extraction);

function ai(fake: FakeScript) {
  return createAiRuntime({
    env: { ENCRYPTION_KEY: TEST_ENCRYPTION_KEY, NODE_ENV: "test" },
    db: worker.db,
    redis,
    logger,
    adapterFor: () => new FakeAdapter(fake),
  });
}

const snapshot = () =>
  evalRouteSnapshotSchema.parse({
    task: "rx_extract",
    mode: "balanced",
    routeId: null,
    routeVersion: 3,
    comparedModelId: null,
    models: [
      {
        modelId,
        model: "fake-eval-model",
        displayName: "Fake eval",
        providerKey: "fake-eval",
        params: {},
      },
    ],
    primaryModelId: modelId,
    skillVersion: skillVersion(RX_SKILL_NAME),
  });

async function seedFile(): Promise<string> {
  const fileId = randomUUID();
  const key = evalImageKey(fileId);
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
    ownerUserId: adminId,
    purpose: "rx_page",
    r2Key: key,
    mime: "image/jpeg",
    bytes: jpeg.byteLength,
    sha256: randomUUID().replaceAll("-", "").padEnd(64, "0"),
    status: "processed",
  });
  return fileId;
}

async function newSet(name: string): Promise<string> {
  const [set] = await owner.db
    .insert(aiEvalSets)
    .values({ key: `s-${randomUUID().slice(0, 8)}`, name })
    .returning({ id: aiEvalSets.id });
  return set?.id ?? "";
}

const label = (name: string, extra: Record<string, string | null> = {}) => ({
  name,
  strength: null,
  form: null,
  frequency: null,
  duration: null,
  route: null,
  ...extra,
});

describe("evals.run", () => {
  it("runs the real pipeline over a seeded set and records scored metrics, without touching credits", async () => {
    const setId = await newSet("Tiny");
    const [printed] = await owner.db
      .insert(aiEvalItems)
      .values({
        setId,
        fileIds: [await seedFile()],
        kind: "printed",
        expected: { items: [label("Augmentin", { frequency: "1x3", duration: "5 days" })] },
      })
      .returning({ id: aiEvalItems.id });
    const [handwritten] = await owner.db
      .insert(aiEvalItems)
      .values({
        setId,
        fileIds: [await seedFile()],
        kind: "handwritten",
        expected: { items: [label("Panadol")] },
      })
      .returning({ id: aiEvalItems.id });
    const [run] = await owner.db
      .insert(aiEvalRuns)
      .values({ setId, routeSnapshot: snapshot() })
      .returning({ id: aiEvalRuns.id });
    const runId = run?.id ?? "";
    const ledgerBefore = await owner.db.select().from(creditLedger);

    await runEval({ db: worker.db, ai: ai(script), storage: store, logger }, runId);

    const [row] = await owner.db.select().from(aiEvalRuns).where(eq(aiEvalRuns.id, runId));
    expect(row?.status).toBe("done");
    expect(row?.startedAt).not.toBeNull();
    expect(row?.finishedAt).not.toBeNull();
    const metrics = evalRunMetricsSchema.parse(row?.metrics);
    expect(metrics.printed).toMatchObject({
      items: 1,
      expected: 1,
      detected: 1,
      nameCorrect: 1,
      nameAccuracy: 1,
      fabricated: 0,
      frequency: { labelled: 1, correct: 1, accuracy: 1 },
      duration: { labelled: 1, correct: 1, accuracy: 1 },
    });
    expect(metrics.handwritten).toMatchObject({
      items: 1,
      expected: 1,
      detected: 0,
      nameCorrect: 0,
      nameAccuracy: 0,
      fabricated: 1,
      fabricationRate: 1,
    });
    expect(metrics.score).toBe(50);
    expect(metrics.overall.latencyP50Ms).not.toBeNull();
    expect(row?.costUsdMicros).toBeGreaterThan(0);

    const results = await owner.db
      .select()
      .from(aiEvalResults)
      .where(eq(aiEvalResults.runId, runId));
    expect(results.map((r) => r.itemId).sort()).toEqual([printed?.id, handwritten?.id].sort());
    expect(results.every((r) => r.error === null && r.latencyMs !== null)).toBe(true);

    // Router usage rows carry the run id and no owner; no ledger row was written.
    const usage = await owner.db.select().from(aiUsage).where(eq(aiUsage.requestId, runId));
    expect(usage).toHaveLength(2);
    expect(usage.every((u) => u.ownerUserId === null && u.userId === null)).toBe(true);
    expect(await owner.db.select().from(creditLedger)).toHaveLength(ledgerBefore.length);

    // A second delivery of the job changes nothing.
    await runEval({ db: worker.db, ai: ai(script), storage: store, logger }, runId);
    expect(
      await owner.db.select().from(aiEvalResults).where(eq(aiEvalResults.runId, runId)),
    ).toHaveLength(2);
    expect(await owner.db.select().from(aiUsage).where(eq(aiUsage.requestId, runId))).toHaveLength(
      2,
    );
  });

  it("an item that cannot be read is recorded with a code, and a run with no reading fails", async () => {
    const setId = await newSet("Bad");
    await owner.db.insert(aiEvalItems).values({
      setId,
      fileIds: [randomUUID()],
      kind: "printed",
      expected: { items: [] },
    });
    const [run] = await owner.db
      .insert(aiEvalRuns)
      .values({ setId, routeSnapshot: snapshot() })
      .returning({ id: aiEvalRuns.id });
    const runId = run?.id ?? "";
    await runEval({ db: worker.db, ai: ai(script), storage: store, logger }, runId);
    const [row] = await owner.db.select().from(aiEvalRuns).where(eq(aiEvalRuns.id, runId));
    expect(row?.status).toBe("failed");
    const [result] = await owner.db
      .select()
      .from(aiEvalResults)
      .where(eq(aiEvalResults.runId, runId));
    expect(result?.error).toBe("image_missing");
  });
});

describe("evals.import", () => {
  async function stage(rows: string[][], imageNames: string[], images: Buffer[]) {
    const batchId = randomUUID();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Labels");
    sheet.addRow([...EVAL_SHEET_COLUMNS]);
    for (const row of rows) sheet.addRow(row);
    const put = (key: string, body: Buffer) =>
      storage.s3.send(new PutObjectCommand({ Bucket: storage.bucket, Key: key, Body: body }));
    await put(
      evalStagingKey(batchId, "sheet.xlsx"),
      Buffer.from(await workbook.xlsx.writeBuffer()),
    );
    for (const [i, bytes] of images.entries()) {
      await put(evalStagingKey(batchId, `img-${String(i)}`), bytes);
    }
    return {
      batchId,
      setKey: `imp-${randomUUID().slice(0, 8)}`,
      setName: "Imported",
      description: null,
      actorId: adminId,
      images: imageNames,
    };
  }

  it("creates items and private eval images, reports bad rows, and is safe to repeat", async () => {
    const withExif = await sharp(jpeg)
      .withExif({ IFD0: { Copyright: "secret" } })
      .jpeg()
      .toBuffer();
    const payload = await stage(
      [
        ["a.jpg", "printed", "2", "Zyrtec", "10 mg", "", "", "", ""],
        ["a.jpg", "printed", "1", "Panadol", "500 mg", "tablet", "tid", "3 days", "oral"],
        ["missing.jpg", "handwritten", "1", "Augmentin", "", "", "", "", ""],
        ["b.jpg", "typed", "1", "x", "", "", "", "", ""],
      ],
      ["a.jpg", "unused.jpg"],
      [withExif, jpeg],
    );
    const outcome = await importEvalSet({ db: worker.db, storage: store }, payload);
    expect(outcome.created).toBe(1);
    expect(outcome.issues).toEqual(
      expect.arrayContaining([
        { row: 5, name: null, code: "bad_kind" },
        { row: null, name: "missing.jpg", code: "image_not_uploaded" },
        { row: null, name: "unused.jpg", code: "image_unused" },
      ]),
    );
    const items = await owner.db
      .select()
      .from(aiEvalItems)
      .where(eq(aiEvalItems.setId, outcome.setId ?? ""));
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("printed");
    expect((items[0]?.expected as { items: { name: string }[] }).items.map((i) => i.name)).toEqual([
      "Panadol",
      "Zyrtec",
    ]);
    const [file] = await owner.db
      .select()
      .from(files)
      .where(eq(files.id, items[0]?.fileIds[0] ?? ""));
    expect(file).toMatchObject({ ownerUserId: adminId, status: "processed", expiresAt: null });
    expect(file?.r2Key.startsWith("evals/rx/")).toBe(true);
    const stored = await store.get(file?.r2Key ?? "", 20_000_000);
    expect((await sharp(stored ?? Buffer.alloc(0)).metadata()).exif).toBeUndefined();
    // The staged originals are gone.
    expect(await store.get(evalStagingKey(payload.batchId, "img-0"), 1_000_000)).toBeNull();

    // The same picture again (a retried job) adds nothing.
    const again = await stage(
      [["a.jpg", "printed", "1", "Panadol", "", "", "", "", ""]],
      ["a.jpg"],
      [withExif],
    );
    const second = await importEvalSet(
      { db: worker.db, storage: store },
      { ...again, setKey: payload.setKey },
    );
    expect(second.created).toBe(0);
    expect(second.issues).toContainEqual({ row: null, name: "a.jpg", code: "already_in_set" });
  });

  it("the job writes the outcome for the admin page, and a missing sheet fails cleanly", async () => {
    const payload = await stage(
      [["a.jpg", "printed", "1", "Panadol", "", "", "", "", ""]],
      ["a.jpg"],
      [jpeg],
    );
    await evalImportJob(payload, { db: worker.db, redis, logger, storage: store });
    expect(JSON.parse((await redis.get(`evalimport:${payload.batchId}`)) ?? "{}")).toMatchObject({
      status: "done",
      created: 1,
    });

    const broken = { ...payload, batchId: randomUUID() };
    await evalImportJob(broken, { db: worker.db, redis, logger, storage: store });
    expect(JSON.parse((await redis.get(`evalimport:${broken.batchId}`)) ?? "{}")).toMatchObject({
      status: "failed",
      errorCode: "sheet_missing",
    });
  });
});
