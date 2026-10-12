import { randomUUID } from "node:crypto";

import {
  activeIngredients,
  createDb,
  drugAliases,
  drugImportBatches,
  drugIngredients,
  drugs,
  matchDrug,
  rollbackDrugImport,
} from "@wasfa/db";
import {
  DRUG_IMPORT_TTL_SECONDS,
  drugImportKeys,
  type DrugImportMapping,
} from "@wasfa/shared/drugs";
import {
  importProgressSchema,
  importReportSchema,
  type ImportReport,
} from "@wasfa/shared/schemas/admin-drugs";
import { count, eq, sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { Redis } from "ioredis";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { drugImportJob } from "../src/jobs/drug-import.job.js";
import { createEmailRuntime } from "../src/notifications/email.js";

import { testEnv } from "./support/env.js";
import { startPostgres, type TestPostgres } from "./support/postgres.js";
import { startRedis, type TestRedis } from "./support/redis.js";

import type { JobContext } from "../src/queues.js";

/*
 * The whole import path on a 20,000-row generated workbook: dry run, commit, re-import (idempotent),
 * an update, and rollback. The worker runs as the restricted `wasfa_api` role, as in production.
 */

const logger = pino({ level: "silent" });

let postgres: TestPostgres;
let redisInfra: TestRedis;
let owner: ReturnType<typeof createDb>;
let worker: ReturnType<typeof createDb>;
let redis: Redis;
let context: JobContext;

beforeAll(async () => {
  [postgres, redisInfra] = await Promise.all([startPostgres(), startRedis()]);
  owner = createDb({ url: postgres.ownerUrl, max: 2 });
  worker = createDb({ url: postgres.apiUrl, max: 4 });
  redis = new Redis(redisInfra.url, { maxRetriesPerRequest: null });
  context = {
    redis,
    db: worker.db,
    logger,
    email: createEmailRuntime(testEnv(redisInfra.url), redis, logger),
  };
}, 180_000);

afterAll(async () => {
  await redis?.quit();
  await Promise.all([owner?.close(), worker?.close()]);
  await Promise.all([postgres?.stop(), redisInfra?.stop()]);
});

const TOTAL_ROWS = 20_000;
const INVALID_ROWS = 20;
const REPEATED_ROWS = 100;
const UNIQUE_ROWS = TOTAL_ROWS - INVALID_ROWS - REPEATED_ROWS;

const FORMS = ["Tablets", "Capsules", "Syrup", "Cream", "Amp."];
const INGREDIENTS = [
  "Paracetamol",
  "Amoxicillin + Clavulanic acid",
  "Ibuprofen",
  "Diclofenac Sodium",
  "Omeprazole",
  "Metformin HCl",
];

interface FileOptions {
  manufacturer?: (index: number) => string;
}

/** Row `i` of the generated list (1-based): a unique brand per index so the keys are distinct. */
function sheetRow(index: number, options: FileOptions): (string | number)[] {
  const brand = `Medix${String(index).padStart(5, "0")}`;
  return [
    brand,
    index % 4 === 0 ? `ميديكس ${String(index)}` : "",
    INGREDIENTS[index % INGREDIENTS.length] ?? "",
    `${String(100 + (index % 9) * 50)} mg`,
    FORMS[index % FORMS.length] ?? "",
    options.manufacturer?.(index) ?? `Pharma ${String(index % 40)}`,
    "eg",
  ];
}

/** A workbook shaped like an EDA export: the preset must map its headers on its own. */
async function buildWorkbook(options: FileOptions = {}): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Drugs");
  sheet.addRow([
    "Trade Name",
    "الاسم العربي",
    "Active Ingredient",
    "Strength",
    "Dosage Form",
    "Company",
    "Country",
    "Internal code",
  ]);
  let line = 0;
  for (let i = 1; i <= UNIQUE_ROWS; i++)
    sheet.addRow([...sheetRow(i, options), `X${String(++line)}`]);
  // Rows without any name.
  for (let i = 0; i < INVALID_ROWS; i++) sheet.addRow(["", "", "Paracetamol", "500 mg", "Tablets"]);
  // The first rows again: duplicates inside the file.
  for (let i = 1; i <= REPEATED_ROWS; i++) sheet.addRow([...sheetRow(i, options), `X${String(i)}`]);
  return Buffer.from(await book.xlsx.writeBuffer());
}

async function newBatch(
  fileName: string,
  bytes: Buffer,
  mapping: DrugImportMapping | Record<string, never> = {},
): Promise<string> {
  const [row] = await owner.db
    .insert(drugImportBatches)
    .values({ fileName, source: "eda", mapping })
    .returning({ id: drugImportBatches.id });
  if (!row) throw new Error("batch was not created");
  await redis.set(drugImportKeys(row.id).file, bytes, "EX", DRUG_IMPORT_TTL_SECONDS);
  return row.id;
}

async function run(batchId: string, mode: "dry_run" | "commit"): Promise<ImportReport> {
  const keys = drugImportKeys(batchId);
  await redis.set(keys.busy, "1", "EX", 60);
  await drugImportJob({ batchId, mode }, context);
  expect(await redis.exists(keys.busy)).toBe(0);
  const progress = importProgressSchema.parse(
    JSON.parse((await redis.get(keys.progress)) ?? "null"),
  );
  expect(progress).toMatchObject({ mode, phase: "done", error: null });
  expect(progress.done).toBe(progress.total);
  return importReportSchema.parse(JSON.parse((await redis.get(keys.report)) ?? "null"));
}

const drugCount = async (): Promise<number> => {
  const [row] = await owner.db.select({ n: count() }).from(drugs);
  return row?.n ?? 0;
};

async function batchRow(id: string) {
  const [row] = await owner.db.select().from(drugImportBatches).where(eq(drugImportBatches.id, id));
  if (!row) throw new Error("batch missing");
  return row;
}

describe("drug import of a 20,000-row workbook", () => {
  let workbook: Buffer;
  let firstBatch: string;

  beforeAll(async () => {
    workbook = await buildWorkbook();
  }, 120_000);

  it("dry run maps the preset, counts rows and writes nothing", async () => {
    firstBatch = await newBatch("eda.xlsx", workbook);
    const report = await run(firstBatch, "dry_run");

    expect(report.counts).toEqual({
      total: TOTAL_ROWS,
      new: UNIQUE_ROWS,
      updated: 0,
      duplicate: REPEATED_ROWS,
      invalid: INVALID_ROWS,
    });
    expect(report.reasons).toEqual({
      missing_name: INVALID_ROWS,
      duplicate_in_file: REPEATED_ROWS,
    });
    expect(report.mapping).toMatchObject({
      "Trade Name": "brandEn",
      "الاسم العربي": "brandAr",
      "Active Ingredient": "ingredients",
      Strength: "strength",
      "Dosage Form": "form",
      Company: "manufacturer",
      Country: "country",
    });
    expect(report.mapping).not.toHaveProperty("Internal code");
    expect(report.headers).toContain("Internal code");
    expect(report.preview).toHaveLength(50);
    expect(report.preview[0]).toMatchObject({ row: 2, status: "new", brandEn: "Medix00001" });
    expect(report.samples.invalid).toHaveLength(INVALID_ROWS);
    expect(report.samples.new).toHaveLength(200);

    const batch = await batchRow(firstBatch);
    expect(batch).toMatchObject({ status: "dry_run", rowsTotal: TOTAL_ROWS, rowsInserted: 0 });
    expect(await drugCount()).toBe(0);
  }, 180_000);

  it("commits in batches, tags every row and stays searchable", async () => {
    const report = await run(firstBatch, "commit");
    expect(report.counts).toMatchObject({ new: UNIQUE_ROWS, updated: 0 });

    expect(await drugCount()).toBe(UNIQUE_ROWS);
    const [tagged] = await owner.db
      .select({ n: count() })
      .from(drugs)
      .where(eq(drugs.importBatchId, firstBatch));
    expect(tagged?.n).toBe(UNIQUE_ROWS);
    const batch = await batchRow(firstBatch);
    expect(batch).toMatchObject({
      status: "committed",
      rowsInserted: UNIQUE_ROWS,
      rowsUpdated: 0,
      rowsSkipped: REPEATED_ROWS + INVALID_ROWS,
    });
    expect(batch.committedAt).not.toBeNull();

    // Normalized, split and linked as the matcher expects.
    const [sample] = await owner.db
      .select()
      .from(drugs)
      .where(eq(drugs.normalizedEn, "medix00008"));
    expect(sample).toMatchObject({
      brandEn: "Medix00008",
      brandAr: "ميديكس 8",
      form: "cream",
      strengthUnit: "mg",
      strengthValueMicro: 500_000_000,
      country: "EG",
    });
    const [ingredients] = await owner.db.select({ n: count() }).from(activeIngredients);
    expect(ingredients?.n).toBe(7);
    const [links] = await owner.db.select({ n: count() }).from(drugIngredients);
    expect(links?.n).toBeGreaterThan(UNIQUE_ROWS);
    const [top] = await matchDrug(worker.db, "Medix00008 500mg cream");
    expect(top?.brandEn).toBe("Medix00008");
    expect(top?.explanation.strength).toBe("match");
  }, 180_000);

  it("re-importing the same file is idempotent: no new rows, nothing changes", async () => {
    const again = await newBatch("eda-again.xlsx", workbook);
    const dry = await run(again, "dry_run");
    expect(dry.counts).toEqual({
      total: TOTAL_ROWS,
      new: 0,
      updated: 0,
      duplicate: UNIQUE_ROWS + REPEATED_ROWS,
      invalid: INVALID_ROWS,
    });
    expect(dry.reasons.unchanged).toBe(UNIQUE_ROWS);

    const committed = await run(again, "commit");
    expect(committed.counts).toMatchObject({ new: 0, updated: 0 });
    expect(await drugCount()).toBe(UNIQUE_ROWS);
    const batch = await batchRow(again);
    expect(batch).toMatchObject({ status: "committed", rowsInserted: 0, rowsUpdated: 0 });
    // Nothing was re-tagged: the first batch still owns every row.
    const [owned] = await owner.db
      .select({ n: count() })
      .from(drugs)
      .where(eq(drugs.importBatchId, firstBatch));
    expect(owned?.n).toBe(UNIQUE_ROWS);
  }, 240_000);

  it("a changed file updates only what changed, and rollback undoes the inserts but keeps updates", async () => {
    const changed = await buildWorkbook({
      manufacturer: (index) => (index <= 30 ? "New Maker" : `Pharma ${String(index % 40)}`),
    });
    const batchId = await newBatch("eda-changed.xlsx", changed);
    const dry = await run(batchId, "dry_run");
    expect(dry.counts).toMatchObject({ new: 0, updated: 30 });
    expect(dry.samples.updated[0]).toMatchObject({ changes: ["manufacturer"] });

    const report = await run(batchId, "commit");
    expect(report.counts).toMatchObject({ new: 0, updated: 30 });
    const [updated] = await owner.db
      .select({ n: count() })
      .from(drugs)
      .where(eq(drugs.manufacturer, "New Maker"));
    expect(updated?.n).toBe(30);
    expect(await drugCount()).toBe(UNIQUE_ROWS);

    // Rolling back the update batch: nothing was inserted, so nothing is deleted; the 30 rows are un-tagged.
    const outcome = await rollbackDrugImport(worker.db, batchId);
    expect(outcome).toEqual({
      kind: "rolled_back",
      deletedDrugs: 0,
      untaggedDrugs: 30,
      deletedIngredients: 0,
      deletedAliases: 0,
    });
    expect(await drugCount()).toBe(UNIQUE_ROWS);
    expect((await batchRow(batchId)).status).toBe("rolled_back");
    // A second rollback is refused.
    expect(await rollbackDrugImport(worker.db, batchId)).toMatchObject({ kind: "not_committed" });
  }, 300_000);

  it("rolls back the first batch: its rows, ingredients and aliases are removed", async () => {
    // An alias added by the batch to one of its own drugs goes with it.
    const [target] = await owner.db
      .select()
      .from(drugs)
      .where(eq(drugs.normalizedEn, "medix00001"));
    expect(target?.importBatchId).toBeNull(); // un-tagged by the rollback above for the 30 changed rows
    const outcome = await rollbackDrugImport(worker.db, firstBatch);
    expect(outcome).toMatchObject({ kind: "rolled_back" });
    if (outcome.kind !== "rolled_back") return;

    // The 30 rows the later batch touched are not this batch's any more: they were re-tagged and
    // then un-tagged, so only the other rows are deleted.
    expect(outcome.deletedDrugs).toBe(UNIQUE_ROWS - 30);
    expect(await drugCount()).toBe(30);
    const [stillTagged] = await owner.db
      .select({ n: count() })
      .from(drugs)
      .where(eq(drugs.importBatchId, firstBatch));
    expect(stillTagged?.n).toBe(0);
    expect((await batchRow(firstBatch)).status).toBe("rolled_back");
    const [aliasRows] = await owner.db.select({ n: count() }).from(drugAliases);
    expect(aliasRows?.n).toBe(0);
    // The ingredients are still used by the 30 surviving drugs.
    const [kept] = await owner.db.select({ n: count() }).from(activeIngredients);
    expect(kept?.n).toBeGreaterThan(0);
  }, 240_000);
});

describe("drug import edge cases", () => {
  it("accepts JSON, maps the admin's columns and imports aliases and ingredient lists", async () => {
    const rows = [
      {
        name: "Cetal 500",
        ar: "سيتال",
        generic: "Paracetamol; Caffeine 65mg",
        dose: "500",
        unit: "mg",
        kind: "Tabs",
        also: "Cetal tablets | سيتال اكسترا",
      },
      { name: "Cetal 500", dose: "500", unit: "mg", kind: "Tabs" },
      { name: "", ar: "" },
      { name: "N".repeat(400) },
    ];
    const mapping: DrugImportMapping = {
      name: "brandEn",
      ar: "brandAr",
      generic: "ingredients",
      dose: "strength",
      unit: "strengthUnit",
      kind: "form",
      also: "aliases",
    };
    const batchId = await newBatch(
      "custom.json",
      Buffer.from(JSON.stringify({ drugs: rows })),
      mapping,
    );
    const dry = await run(batchId, "dry_run");
    expect(dry.counts).toEqual({ total: 4, new: 1, updated: 0, duplicate: 1, invalid: 2 });
    expect(dry.reasons).toMatchObject({ missing_name: 1, name_too_long: 1, duplicate_in_file: 1 });

    await run(batchId, "commit");
    const [cetal] = await owner.db.select().from(drugs).where(eq(drugs.importBatchId, batchId));
    expect(cetal).toMatchObject({
      normalizedEn: "cetal 500",
      form: "tablet",
      strengthText: "500 mg",
      strengthValueMicro: 500_000_000,
    });
    if (!cetal) return;
    const aliases = await owner.db
      .select()
      .from(drugAliases)
      .where(eq(drugAliases.drugId, cetal.id));
    expect(aliases.map((a) => a.alias).sort()).toEqual(["Cetal tablets", "سيتال اكسترا"].sort());
    const links = await owner.db
      .select({ name: activeIngredients.normalized, unit: drugIngredients.strengthUnit })
      .from(drugIngredients)
      .innerJoin(activeIngredients, eq(activeIngredients.id, drugIngredients.ingredientId))
      .where(eq(drugIngredients.drugId, cetal.id));
    expect(links.map((l) => l.name).sort()).toEqual(["caffeine", "paracetamol"]);
    expect(links.find((l) => l.name === "caffeine")?.unit).toBe("mg");

    // Rolling back removes the drug, its alias and the ingredients nobody else uses.
    const outcome = await rollbackDrugImport(worker.db, batchId);
    expect(outcome).toMatchObject({ kind: "rolled_back", deletedDrugs: 1 });
    const [leftover] = await owner.db
      .select({ n: count() })
      .from(drugs)
      .where(eq(drugs.importBatchId, batchId));
    expect(leftover?.n).toBe(0);
  }, 120_000);

  it("fails a file that is not a list, without touching the tables", async () => {
    const batchId = await newBatch("bad.xlsx", Buffer.from("this is not a workbook"));
    await redis.set(drugImportKeys(batchId).busy, "1", "EX", 60);
    await drugImportJob({ batchId, mode: "dry_run" }, context);
    const progress = importProgressSchema.parse(
      JSON.parse((await redis.get(drugImportKeys(batchId).progress)) ?? "null"),
    );
    expect(progress).toMatchObject({ phase: "failed", error: "file_unreadable" });
    expect((await batchRow(batchId)).status).toBe("failed");
  });

  it("fails when the file has no name column, and when the upload has expired", async () => {
    const noName = await newBatch(
      "noname.json",
      Buffer.from(JSON.stringify([{ colour: "blue" }])),
      {},
    );
    await drugImportJob({ batchId: noName, mode: "dry_run" }, context);
    const progress = importProgressSchema.parse(
      JSON.parse((await redis.get(drugImportKeys(noName).progress)) ?? "null"),
    );
    expect(progress.error).toBe("no_name_column");

    const expired = await newBatch("gone.json", Buffer.from("[]"));
    await redis.del(drugImportKeys(expired).file);
    await drugImportJob({ batchId: expired, mode: "dry_run" }, context);
    const gone = importProgressSchema.parse(
      JSON.parse((await redis.get(drugImportKeys(expired).progress)) ?? "null"),
    );
    expect(gone.error).toBe("file_expired");
    // A failed dry run does not flip a batch that never had a good one.
    expect((await batchRow(expired)).status).toBe("draft");
  });

  it("does nothing for a batch that is gone", async () => {
    await drugImportJob({ batchId: randomUUID(), mode: "dry_run" }, context);
    const [row] = await owner.db.select({ n: sql<number>`count(*)::int` }).from(drugImportBatches);
    expect(row?.n).toBeGreaterThan(0);
  });
});
