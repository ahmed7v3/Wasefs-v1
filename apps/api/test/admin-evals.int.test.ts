import { randomUUID } from "node:crypto";

import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  aiEvalItems,
  aiEvalRuns,
  aiEvalSets,
  aiModels,
  aiProviders,
  aiTaskRoutes,
  auditLogs,
  files,
  rxAnalyses,
  rxCorrections,
  rxPages,
} from "@wasfa/db";
import { evalExpectedSchema } from "@wasfa/shared/evals";
import { routeListResponseSchema } from "@wasfa/shared/schemas/admin-ai";
import {
  evalCompareResponseSchema,
  evalImportReportSchema,
  evalItemDetailSchema,
  evalRunDetailSchema,
  evalRunListResponseSchema,
  evalSetListResponseSchema,
  reviewQueueResponseSchema,
  startEvalRunResponseSchema,
} from "@wasfa/shared/schemas/admin-evals";
import { Queue } from "bullmq";
import { and, desc, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminTestContext, MISSING_ID, type Admin, type Person } from "./support/admin-context.js";
import { WEB } from "./support/auth-harness.js";
import { startStorage, type TestStorage } from "./support/storage.js";

import type { LightMyRequestResponse } from "fastify";

const ctx = new AdminTestContext();
let storage: TestStorage;
let boss: Admin;
let nobody: Person;
let evalsQueue: Queue;
let modelA = "";
let modelB = "";
let freeTierModel = "";

beforeAll(async () => {
  storage = await startStorage();
  await ctx.start([], storage.env);
  boss = await ctx.admin("super_admin");
  const roleKey = await ctx.roleLacking("evals.run");
  nobody = await ctx.admin(roleKey);
  evalsQueue = new Queue("evals", { connection: ctx.redis });

  const db = ctx.owner.db;
  const [paid] = await db
    .insert(aiProviders)
    .values({
      key: `ev-paid-${randomUUID().slice(0, 6)}`,
      kind: "fake",
      dataPolicy: "paid_no_training",
      enabled: true,
    })
    .returning({ id: aiProviders.id });
  const [free] = await db
    .insert(aiProviders)
    .values({
      key: `ev-free-${randomUUID().slice(0, 6)}`,
      kind: "fake",
      dataPolicy: "free_tier",
      enabled: true,
    })
    .returning({ id: aiProviders.id });
  const model = async (providerId: string | undefined, name: string) => {
    const [row] = await db
      .insert(aiModels)
      .values({
        providerId: providerId ?? "",
        modelId: `ev-${name}-${randomUUID().slice(0, 6)}`,
        displayName: name,
        capabilities: ["vision", "json"],
        priceInputUsdMicrosPerM: 1_000_000,
        priceOutputUsdMicrosPerM: 2_000_000,
      })
      .returning({ id: aiModels.id });
    return row?.id ?? "";
  };
  modelA = await model(paid?.id, "Eval A");
  modelB = await model(paid?.id, "Eval B");
  freeTierModel = await model(free?.id, "Eval Free");
}, 240_000);

afterAll(async () => {
  await evalsQueue?.close();
  await ctx.stop();
  await storage?.stop();
});

type Method = "GET" | "POST" | "PUT";
const call = (
  method: Method,
  url: string,
  who: { jar: Person["jar"] },
  body?: Record<string, unknown>,
) => ctx.harness.call(method, url, { jar: who.jar, ...(body ? { body } : {}) });

function expectError(res: LightMyRequestResponse, status: number, code: string, reason?: string) {
  expect(res.statusCode, res.body).toBe(status);
  expect(res.json()).toMatchObject({ code, ...(reason ? { details: { reason } } : {}) });
}

const auditActions = async (action: string) =>
  (await ctx.owner.db.select().from(auditLogs).where(eq(auditLogs.action, action))).length;

async function seedSet(items = 1): Promise<string> {
  const [set] = await ctx.owner.db
    .insert(aiEvalSets)
    .values({ key: `set-${randomUUID().slice(0, 8)}`, name: "Seeded" })
    .returning({ id: aiEvalSets.id });
  for (let i = 0; i < items; i++) {
    await ctx.owner.db.insert(aiEvalItems).values({
      setId: set?.id ?? "",
      fileIds: [randomUUID()],
      kind: i % 2 === 0 ? "printed" : "handwritten",
      expected: {
        items: [
          {
            name: "Panadol",
            strength: null,
            form: null,
            frequency: null,
            duration: null,
            route: null,
          },
        ],
      },
    });
  }
  return set?.id ?? "";
}

describe("permissions", () => {
  const cases: [Method, string, Record<string, unknown>?][] = [
    ["GET", "/admin/ai/evals/sets"],
    ["GET", `/admin/ai/evals/imports/${MISSING_ID}`],
    ["GET", "/admin/ai/evals/runs"],
    ["POST", "/admin/ai/evals/runs", { setId: MISSING_ID }],
    ["GET", `/admin/ai/evals/runs/compare?a=${MISSING_ID}&b=${MISSING_ID}`],
    ["GET", `/admin/ai/evals/runs/${MISSING_ID}`],
    ["GET", `/admin/ai/evals/runs/${MISSING_ID}/items/${MISSING_ID}`],
    ["POST", `/admin/ai/evals/runs/${MISSING_ID}/cancel`],
    ["GET", "/admin/ai/evals/review-queue"],
    [
      "POST",
      "/admin/ai/evals/review-queue/approve",
      { correctionId: MISSING_ID, setId: MISSING_ID, kind: "printed" },
    ],
    ["POST", "/admin/ai/evals/review-queue/reject", { correctionId: MISSING_ID }],
  ];
  it.each(cases)("%s %s needs evals.run", async (method, url, body) => {
    expectError(await call(method, url, nobody, body), 403, "FORBIDDEN");
    const anonymous = await ctx.harness.call(method, url, body ? { body } : {});
    expect(anonymous.statusCode).toBe(401);
  });
});

describe("import", () => {
  const boundary = `----wasfa${randomUUID()}`;
  function multipart(
    fields: Record<string, string>,
    fileParts: { field: string; name: string; bytes: Buffer }[],
  ): Buffer {
    const parts: Buffer[] = [];
    for (const [name, value] of Object.entries(fields)) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        ),
      );
    }
    for (const file of fileParts) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
        ),
        file.bytes,
        Buffer.from("\r\n"),
      );
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    return Buffer.concat(parts);
  }
  const upload = (
    who: { jar: Person["jar"] },
    fields: Record<string, string>,
    fileParts: { field: string; name: string; bytes: Buffer }[],
  ) =>
    ctx.app.inject({
      method: "POST",
      url: "/admin/ai/evals/import",
      remoteAddress: `10.8.${String(Math.floor(Math.random() * 250))}.${String(1 + Math.floor(Math.random() * 250))}`,
      headers: {
        origin: WEB,
        "content-type": `multipart/form-data; boundary=${boundary}`,
        cookie: [...who.jar].map(([name, value]) => `${name}=${value}`).join("; "),
      },
      payload: multipart(fields, fileParts),
    });

  const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("sheet")]);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("image")]);
  const fields = { key: "owner-set", name: "Owner set" };

  it("stores the sheet and images privately, queues the job, and reports queued", async () => {
    const before = await auditActions("eval.import");
    const res = await upload(boss, fields, [
      { field: "sheet", name: "labels.xlsx", bytes: zip },
      { field: "images", name: "a.jpg", bytes: jpeg },
      { field: "images", name: "b.jpg", bytes: jpeg },
    ]);
    expect(res.statusCode, res.body).toBe(202);
    const { id } = res.json<{ id: string }>();

    for (const key of ["sheet.xlsx", "img-0", "img-1"]) {
      const head = await storage.s3.send(
        new HeadObjectCommand({ Bucket: storage.bucket, Key: `evals/rx/staging/${id}/${key}` }),
      );
      expect(head.ContentLength).toBeGreaterThan(0);
    }
    const job = await evalsQueue.getJob(`eval-import-${id}`);
    expect(job?.name).toBe("evals.import");
    expect(job?.data).toMatchObject({
      batchId: id,
      setKey: "owner-set",
      images: ["a.jpg", "b.jpg"],
    });

    const report = await call("GET", `/admin/ai/evals/imports/${id}`, boss);
    expect(evalImportReportSchema.parse(report.json())).toMatchObject({
      status: "queued",
      created: 0,
    });
    expect(await auditActions("eval.import")).toBe(before + 1);
  });

  const bad: [
    string,
    Record<string, string>,
    { field: string; name: string; bytes: Buffer }[],
    string,
  ][] = [
    ["no sheet", fields, [{ field: "images", name: "a.jpg", bytes: jpeg }], "sheet_required"],
    [
      "a sheet that is not a workbook",
      fields,
      [{ field: "sheet", name: "x.xlsx", bytes: jpeg }],
      "unsupported_sheet",
    ],
    [
      "an image that is not an image",
      fields,
      [
        { field: "sheet", name: "x.xlsx", bytes: zip },
        { field: "images", name: "a.jpg", bytes: Buffer.from("MZ not an image") },
      ],
      "unsupported_image",
    ],
    [
      "two images with the same name",
      fields,
      [
        { field: "sheet", name: "x.xlsx", bytes: zip },
        { field: "images", name: "a.jpg", bytes: jpeg },
        { field: "images", name: "A.JPG", bytes: jpeg },
      ],
      "duplicate_image_name",
    ],
  ];
  it.each(bad)("refuses %s", async (_title, f, parts, reason) => {
    expectError(await upload(boss, f, parts), 400, "VALIDATION_FAILED", reason);
  });

  it("refuses a bad set key", async () => {
    const res = await upload(boss, { key: "Bad Key!", name: "x" }, [
      { field: "sheet", name: "x.xlsx", bytes: zip },
    ]);
    expect(res.statusCode).toBe(400);
  });
});

describe("runs", () => {
  it("lists sets with counts", async () => {
    const setId = await seedSet(3);
    const list = evalSetListResponseSchema.parse(
      (await call("GET", "/admin/ai/evals/sets", boss)).json(),
    );
    expect(list.items.find((s) => s.id === setId)).toMatchObject({
      items: 3,
      printed: 2,
      handwritten: 1,
    });
  });

  it("starts one run per compared model with a frozen snapshot, queues them, and audits", async () => {
    const setId = await seedSet();
    const before = await auditActions("eval.run.create");
    const res = await call("POST", "/admin/ai/evals/runs", boss, {
      setId,
      modelIds: [modelA, modelB],
    });
    expect(res.statusCode, res.body).toBe(201);
    const { items } = startEvalRunResponseSchema.parse(res.json());
    expect(items).toHaveLength(2);
    expect(items.map((r) => r.snapshot?.comparedModelId)).toEqual([modelA, modelB]);
    for (const run of items) {
      expect(run).toMatchObject({ status: "queued", itemsTotal: 1, itemsDone: 0 });
      expect(run.snapshot).toMatchObject({
        task: "rx_extract",
        mode: "balanced",
        primaryModelId: run.snapshot?.comparedModelId,
      });
      expect(run.snapshot?.models).toHaveLength(1);
      expect((await evalsQueue.getJob(`eval-run-${run.id}`))?.name).toBe("evals.run");
    }
    expect(await auditActions("eval.run.create")).toBe(before + 1);

    // Without models: one run on the route as configured (its fallbacks included).
    const asConfigured = startEvalRunResponseSchema.parse(
      (await call("POST", "/admin/ai/evals/runs", boss, { setId })).json(),
    );
    expect(asConfigured.items).toHaveLength(1);
    expect(asConfigured.items[0]?.snapshot?.comparedModelId).toBeNull();
    expect(asConfigured.items[0]?.snapshot?.models.length).toBeGreaterThan(1);
  });

  it("refuses an unknown set, an empty set, an unknown model and a free-tier model", async () => {
    expectError(
      await call("POST", "/admin/ai/evals/runs", boss, { setId: MISSING_ID }),
      404,
      "NOT_FOUND",
    );
    const empty = await seedSet(0);
    expectError(
      await call("POST", "/admin/ai/evals/runs", boss, { setId: empty }),
      409,
      "CONFLICT",
      "empty_set",
    );
    const setId = await seedSet();
    expectError(
      await call("POST", "/admin/ai/evals/runs", boss, { setId, modelIds: [MISSING_ID] }),
      400,
      "VALIDATION_FAILED",
      "unknown_model",
    );
    expectError(
      await call("POST", "/admin/ai/evals/runs", boss, { setId, modelIds: [freeTierModel] }),
      400,
      "VALIDATION_FAILED",
      "free_tier_medical",
    );
    expectError(
      await call("POST", "/admin/ai/evals/runs", boss, { setId, modelIds: [modelA, modelA] }),
      400,
      "VALIDATION_FAILED",
    );
  });

  it("shows a run with its items, the item drilldown, a comparison, and cancels once", async () => {
    const setId = await seedSet(2);
    const [itemA, itemB] = await ctx.owner.db
      .select()
      .from(aiEvalItems)
      .where(eq(aiEvalItems.setId, setId))
      .orderBy(aiEvalItems.createdAt, aiEvalItems.id);
    const started = startEvalRunResponseSchema.parse(
      (
        await call("POST", "/admin/ai/evals/runs", boss, { setId, modelIds: [modelA, modelB] })
      ).json(),
    );
    const [first, second] = started.items;
    const score = (nameCorrect: number) => ({
      expected: 1,
      predicted: 1,
      detected: 1,
      nameCorrect,
      fields: {
        strength: { labelled: 0, correct: 0 },
        frequency: { labelled: 0, correct: 0 },
        duration: { labelled: 0, correct: 0 },
      },
      fabricated: 0,
      bands: Object.fromEntries(
        ["0-50", "50-70", "70-85", "85-95", "95-100"].map((band) => [
          band,
          { total: 0, correct: 0 },
        ]),
      ),
      pairs: [],
      extras: [],
    });
    const result = async (runId: string, itemId: string | undefined, nameCorrect: number) => {
      const { aiEvalResults } = await import("@wasfa/db");
      await ctx.owner.db.insert(aiEvalResults).values({
        runId,
        itemId: itemId ?? "",
        scores: score(nameCorrect),
        costUsdMicros: 100,
        latencyMs: 900,
      });
    };
    await result(first?.id ?? "", itemA?.id, 1);
    await result(first?.id ?? "", itemB?.id, 1);
    await result(second?.id ?? "", itemA?.id, 1);
    await result(second?.id ?? "", itemB?.id, 0);

    const detail = evalRunDetailSchema.parse(
      (await call("GET", `/admin/ai/evals/runs/${first?.id ?? ""}`, boss)).json(),
    );
    expect(detail).toMatchObject({ itemsTotal: 2, itemsDone: 2 });
    expect(detail.items.map((i) => i.done)).toEqual([true, true]);
    expect(detail.items[0]?.scores?.nameCorrect).toBe(1);

    const drill = evalItemDetailSchema.parse(
      (
        await call("GET", `/admin/ai/evals/runs/${first?.id ?? ""}/items/${itemA?.id ?? ""}`, boss)
      ).json(),
    );
    expect(drill.expected.items[0]?.name).toBe("Panadol");
    expectError(
      await call("GET", `/admin/ai/evals/runs/${first?.id ?? ""}/items/${MISSING_ID}`, boss),
      404,
      "NOT_FOUND",
    );

    const compared = evalCompareResponseSchema.parse(
      (
        await call(
          "GET",
          `/admin/ai/evals/runs/compare?a=${first?.id ?? ""}&b=${second?.id ?? ""}`,
          boss,
        )
      ).json(),
    );
    expect(compared.sameSet).toBe(true);
    expect(compared.differences).toEqual([
      { itemId: itemB?.id, kind: "handwritten", expected: 1, aNameCorrect: 1, bNameCorrect: 0 },
    ]);

    const list = evalRunListResponseSchema.parse(
      (await call("GET", `/admin/ai/evals/runs?setId=${setId}`, boss)).json(),
    );
    expect(list.items.map((r) => r.id).sort()).toEqual([first?.id, second?.id].sort());

    const cancelled = await call("POST", `/admin/ai/evals/runs/${second?.id ?? ""}/cancel`, boss);
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(cancelled.json()).toMatchObject({ status: "cancelled" });
    expectError(
      await call("POST", `/admin/ai/evals/runs/${second?.id ?? ""}/cancel`, boss),
      409,
      "CONFLICT",
      "not_cancellable",
    );
    expectError(await call("GET", `/admin/ai/evals/runs/${MISSING_ID}`, boss), 404, "NOT_FOUND");
  });
});

describe("review queue", () => {
  const readingOf = (name: string | null) => ({
    schemaVersion: 1,
    items: [
      {
        rawText: "raw",
        name,
        matchedDrugId: null,
        matchScore: null,
        activeIngredients: [],
        strength: "1 g",
        form: null,
        dose: null,
        frequency: "3 مرات يوميًا",
        duration: null,
        route: null,
        notes: null,
        confidence: 0.6,
        badge: "medium",
        verified: "not_needed",
        box_2d: null,
        page: 0,
      },
    ],
    date: null,
    prescriberLegible: true,
    findings: [],
    unreadableRegions: [],
  });

  async function seedCorrection(options: {
    consent: boolean;
    image: boolean;
    name?: string | null;
  }) {
    const person = await ctx.harness.signedInUser();
    const analysisId = randomUUID();
    await ctx.owner.db.insert(rxAnalyses).values({
      id: analysisId,
      ownerUserId: person.userId,
      createdBy: person.userId,
      status: "done",
      mode: "balanced",
      skillVersion: "prescription-analysis@000000000000",
      result: readingOf(options.name === undefined ? "Augmentin" : options.name),
    });
    const fileId = randomUUID();
    const key = `u/${person.userId}/${fileId}/processed`;
    if (options.image) {
      await storage.s3.send(
        new PutObjectCommand({ Bucket: storage.bucket, Key: key, Body: Buffer.from("jpeg-bytes") }),
      );
    }
    await ctx.owner.db.insert(files).values({
      id: fileId,
      ownerUserId: person.userId,
      purpose: "rx_page",
      r2Key: key,
      mime: "image/jpeg",
      bytes: 10,
      width: 100,
      height: 200,
      sha256: "a".repeat(64),
      dhash: "b".repeat(16),
      status: options.image ? "processed" : "deleted",
    });
    await ctx.owner.db.insert(rxPages).values({ analysisId, pageNo: 1, fileId });
    const [correction] = await ctx.owner.db
      .insert(rxCorrections)
      .values({
        analysisId,
        itemIndex: 0,
        field: "drug",
        before: "Augmentn",
        after: "Augmentin mail me at who@example.com",
        userId: person.userId,
        consentForEval: options.consent,
      })
      .returning({ id: rxCorrections.id });
    return correction?.id ?? "";
  }

  it("lists only consented corrections, as item text with no identifiers", async () => {
    const consented = await seedCorrection({ consent: true, image: true });
    const notConsented = await seedCorrection({ consent: false, image: true });
    const res = await call("GET", "/admin/ai/evals/review-queue", boss);
    const { items } = reviewQueueResponseSchema.parse(res.json());
    const found = items.find((i) => i.correctionId === consented);
    expect(found).toMatchObject({
      field: "drug",
      itemName: "Augmentin",
      before: "Augmentn",
      imageAvailable: true,
    });
    expect(found?.after).not.toContain("who@example.com");
    expect(items.some((i) => i.correctionId === notConsented)).toBe(false);
    expect(Object.keys(found ?? {}).sort()).toEqual(
      [
        "after",
        "before",
        "correctionId",
        "createdAt",
        "field",
        "imageAvailable",
        "itemName",
      ].sort(),
    );
  });

  it("approve adds an anonymized item, copies the picture, leaves the queue, and cannot repeat", async () => {
    const setId = await seedSet(0);
    const correctionId = await seedCorrection({ consent: true, image: true });
    const before = await auditActions("eval.correction.approve");
    const res = await call("POST", "/admin/ai/evals/review-queue/approve", boss, {
      correctionId,
      setId,
      kind: "handwritten",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ imageCopied: true });

    const [item] = await ctx.owner.db
      .select()
      .from(aiEvalItems)
      .where(eq(aiEvalItems.setId, setId));
    expect(item?.kind).toBe("handwritten");
    const expected = evalExpectedSchema.parse(item?.expected);
    expect(expected.items).toEqual([
      {
        name: "Augmentin",
        strength: "1 g",
        form: null,
        frequency: "3 مرات يوميًا",
        duration: null,
        route: null,
      },
    ]);
    expect(expected.origin?.correctionIds).toEqual([correctionId]);
    expect(item?.fileIds).toHaveLength(1);
    const [copy] = await ctx.owner.db
      .select()
      .from(files)
      .where(eq(files.id, item?.fileIds[0] ?? ""));
    expect(copy).toMatchObject({ status: "processed", expiresAt: null, sha256: "a".repeat(64) });
    expect(copy?.r2Key.startsWith("evals/rx/")).toBe(true);
    const head = await storage.s3.send(
      new HeadObjectCommand({ Bucket: storage.bucket, Key: copy?.r2Key ?? "" }),
    );
    expect(head.ContentLength).toBe(10);

    const queue = reviewQueueResponseSchema.parse(
      (await call("GET", "/admin/ai/evals/review-queue", boss)).json(),
    );
    expect(queue.items.some((i) => i.correctionId === correctionId)).toBe(false);
    expectError(
      await call("POST", "/admin/ai/evals/review-queue/approve", boss, {
        correctionId,
        setId,
        kind: "printed",
      }),
      409,
      "CONFLICT",
      "already_added",
    );
    expect(await auditActions("eval.correction.approve")).toBe(before + 1);
  });

  it("approve without a picture keeps the item with no files", async () => {
    const setId = await seedSet(0);
    const correctionId = await seedCorrection({ consent: true, image: false });
    const res = await call("POST", "/admin/ai/evals/review-queue/approve", boss, {
      correctionId,
      setId,
      kind: "printed",
    });
    expect(res.json()).toMatchObject({ imageCopied: false });
    const [item] = await ctx.owner.db
      .select()
      .from(aiEvalItems)
      .where(eq(aiEvalItems.setId, setId));
    expect(item?.fileIds).toEqual([]);
  });

  it("approve refuses a reading with no drug names; reject withdraws the consent, audited", async () => {
    const setId = await seedSet(0);
    const empty = await seedCorrection({ consent: true, image: false, name: null });
    expectError(
      await call("POST", "/admin/ai/evals/review-queue/approve", boss, {
        correctionId: empty,
        setId,
        kind: "printed",
      }),
      409,
      "CONFLICT",
      "empty_reading",
    );
    expectError(
      await call("POST", "/admin/ai/evals/review-queue/approve", boss, {
        correctionId: MISSING_ID,
        setId,
        kind: "printed",
      }),
      404,
      "NOT_FOUND",
    );

    const before = await auditActions("eval.correction.reject");
    const rejected = await call("POST", "/admin/ai/evals/review-queue/reject", boss, {
      correctionId: empty,
    });
    expect(rejected.statusCode, rejected.body).toBe(204);
    const [row] = await ctx.owner.db
      .select()
      .from(rxCorrections)
      .where(eq(rxCorrections.id, empty));
    expect(row?.consentForEval).toBe(false);
    expectError(
      await call("POST", "/admin/ai/evals/review-queue/reject", boss, { correctionId: empty }),
      404,
      "NOT_FOUND",
    );
    expect(await auditActions("eval.correction.reject")).toBe(before + 1);
  });
});

describe("promotion check on routes", () => {
  async function doneRun(primaryModelId: string, score: number): Promise<void> {
    const setId = await seedSet(0);
    await ctx.owner.db.insert(aiEvalRuns).values({
      setId,
      status: "done",
      routeSnapshot: { primaryModelId },
      metrics: { score },
      finishedAt: new Date(),
    });
  }

  it("needs an audited reason when the new primary scored more than a point lower", async () => {
    const [route] = await ctx.owner.db
      .select()
      .from(aiTaskRoutes)
      .where(
        and(
          eq(aiTaskRoutes.task, "rx_extract"),
          eq(aiTaskRoutes.mode, "fast"),
          isNull(aiTaskRoutes.planId),
        ),
      );
    const current = route?.models[0]?.modelId ?? "";
    await doneRun(current, 92);
    await doneRun(modelA, 88);
    await doneRun(modelB, 91.5);

    const put = (modelId: string, extra: Record<string, unknown> = {}) =>
      call("PUT", "/admin/ai/routes", boss, {
        task: "rx_extract",
        planId: null,
        mode: "fast",
        models: [{ modelId, params: {} }],
        ...extra,
      });

    expectError(await put(modelA), 400, "VALIDATION_FAILED", "eval_regression_reason_required");
    expect(res400Details(await put(modelA))).toMatchObject({
      fields: ["reason"],
      currentScore: 92,
      newScore: 88,
    });
    expectError(await put(modelA, { reason: "short" }), 400, "VALIDATION_FAILED");

    // Within a point: no reason needed.
    const small = await put(modelB);
    expect(small.statusCode, small.body).toBe(200);

    // Back to the first model, then promote the lower one with a reason.
    await doneRun(modelB, 91.5);
    await put(current);
    const withReason = await put(modelA, {
      reason: "Cheaper and good enough for printed prescriptions",
    });
    expect(withReason.statusCode, withReason.body).toBe(200);
    const [audit] = await ctx.owner.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "ai.route.update"))
      .orderBy(desc(auditLogs.createdAt))
      .limit(1);
    expect(JSON.stringify(audit?.after)).toContain("Cheaper and good enough");
  });

  it("shows the primary model's last score on the route list", async () => {
    const list = routeListResponseSchema.parse(
      (await call("GET", "/admin/ai/routes", boss)).json(),
    );
    const rx = list.items.find(
      (r) => r.task === "rx_extract" && r.mode === "fast" && r.planId === null,
    );
    expect(rx?.lastEvalScore).toBe(88);
    const chat = list.items.find((r) => r.task === "chat" && r.planId === null);
    expect(chat?.lastEvalScore).toBeNull();
  });
});

function res400Details(res: LightMyRequestResponse): Record<string, unknown> {
  return res.json<{ details: Record<string, unknown> }>().details;
}
