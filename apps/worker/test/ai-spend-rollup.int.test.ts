import { aiModels, aiProviders, aiSpendDaily, aiUsage, createDb } from "@wasfa/db";
import { and, eq } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { rollupAiSpend, rollupStart, spendRollupJob } from "../src/jobs/ai.spend-rollup.job.js";

import { startPostgres, type TestPostgres } from "./support/postgres.js";

/* Run as the restricted `wasfa_api` role the worker uses in production. */

const NOW = new Date("2026-10-12T10:30:00Z");

let postgres: TestPostgres;
let owner: ReturnType<typeof createDb>;
let worker: ReturnType<typeof createDb>;
let providerId: string;
let modelA: string;
let modelB: string;

beforeAll(async () => {
  postgres = await startPostgres();
  owner = createDb({ url: postgres.ownerUrl, max: 2 });
  worker = createDb({ url: postgres.apiUrl, max: 4 });
  const [provider] = await owner.db
    .insert(aiProviders)
    .values({ key: "p", kind: "fake", dataPolicy: "paid_no_training" })
    .returning({ id: aiProviders.id });
  if (!provider) throw new Error("provider insert failed");
  providerId = provider.id;
  const models = await owner.db
    .insert(aiModels)
    .values([
      { providerId, modelId: "a", displayName: "A" },
      { providerId, modelId: "b", displayName: "B" },
    ])
    .returning({ id: aiModels.id, modelId: aiModels.modelId });
  modelA = models.find((m) => m.modelId === "a")?.id ?? "";
  modelB = models.find((m) => m.modelId === "b")?.id ?? "";
}, 180_000);

afterAll(async () => {
  await Promise.all([owner?.close(), worker?.close()]);
  await postgres?.stop();
});

const usage = (modelId: string, at: string, cost: number, input = 100) => ({
  task: "chat" as const,
  modelId,
  providerId,
  modelKey: "x",
  inputTokens: input,
  cachedInputTokens: 10,
  outputTokens: 20,
  thinkingTokens: 5,
  costUsdMicros: cost,
  outcome: "ok" as const,
  createdAt: new Date(at),
});

async function spendRow(day: string, modelId: string) {
  const [row] = await owner.db
    .select()
    .from(aiSpendDaily)
    .where(and(eq(aiSpendDaily.day, day), eq(aiSpendDaily.modelId, modelId)));
  return row;
}

describe("ai.spend_rollup", () => {
  it("starts at midnight UTC of yesterday", () => {
    expect(rollupStart(NOW).toISOString()).toBe("2026-10-11T00:00:00.000Z");
  });

  it("recomputes today and yesterday per model, leaves older days alone, and is idempotent", async () => {
    await owner.db.insert(aiUsage).values([
      usage(modelA, "2026-10-12T01:00:00Z", 300),
      usage(modelA, "2026-10-12T09:00:00Z", 200),
      usage(modelB, "2026-10-12T09:30:00Z", 50),
      usage(modelA, "2026-10-11T23:59:00Z", 700),
      // Before the window: the job must not touch (or re-derive) this day.
      usage(modelA, "2026-10-09T12:00:00Z", 9_999),
    ]);
    await owner.db.insert(aiSpendDaily).values({
      day: "2026-10-09",
      providerId,
      modelId: modelA,
      calls: 1,
      costUsdMicros: 123,
    });

    const written = await rollupAiSpend(worker.db, NOW);
    expect(written).toBe(3);

    expect(await spendRow("2026-10-12", modelA)).toMatchObject({
      calls: 2,
      inputTokens: 200,
      cachedInputTokens: 20,
      outputTokens: 40,
      thinkingTokens: 10,
      costUsdMicros: 500,
    });
    expect(await spendRow("2026-10-12", modelB)).toMatchObject({ calls: 1, costUsdMicros: 50 });
    expect(await spendRow("2026-10-11", modelA)).toMatchObject({ calls: 1, costUsdMicros: 700 });
    expect(await spendRow("2026-10-09", modelA)).toMatchObject({ calls: 1, costUsdMicros: 123 });

    // Same input, same numbers: a SET, never an increment.
    await rollupAiSpend(worker.db, NOW);
    await spendRollupJob({}, { db: worker.db, logger: pino({ level: "silent" }) }, NOW);
    expect(await spendRow("2026-10-12", modelA)).toMatchObject({ calls: 2, costUsdMicros: 500 });

    // A later call lands in the same row.
    await owner.db.insert(aiUsage).values(usage(modelA, "2026-10-12T10:00:00Z", 25));
    await rollupAiSpend(worker.db, NOW);
    expect(await spendRow("2026-10-12", modelA)).toMatchObject({ calls: 3, costUsdMicros: 525 });
  });

  it("skips usage rows whose model was removed, instead of failing", async () => {
    await owner.db.insert(aiUsage).values({
      ...usage(modelA, "2026-10-12T05:00:00Z", 1),
      modelId: null,
      providerId: null,
    });
    await expect(rollupAiSpend(worker.db, NOW)).resolves.toBeGreaterThanOrEqual(0);
  });
});
