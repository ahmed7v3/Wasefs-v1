import { readFile } from "node:fs/promises";

import { presetMapping } from "@wasfa/shared/drugs";
import { describe, expect, it } from "vitest";

import { readImportFile } from "../src/jobs/drug-import.file.js";
import {
  fieldColumns,
  parseImportRow,
  planRow,
  rowKey,
  type ExistingDrug,
  type ImportRow,
} from "../src/jobs/drug-import.plan.js";

/*
 * The dwaprices preset end to end without a database: real rows of docs/datat/egyptian_medicines.json
 * (the fixture) go through the file reader, the preset mapping and the row parser.
 */

const fixture = await readFile(new URL("./fixtures/dwaprices-sample.json", import.meta.url));
const parsed = await readImportFile(fixture);
const columns = fieldColumns(presetMapping("dwaprices", parsed.headers));

function parseRef(sourceRef: string): ImportRow {
  const raw = parsed.rows.find((row) => row.cells["id"] === sourceRef);
  if (raw === undefined) throw new Error(`fixture has no row ${sourceRef}`);
  const row = parseImportRow(raw, columns, "dwaprices");
  if (!row.ok) throw new Error(`row ${sourceRef} is invalid: ${row.reason}`);
  return row.value;
}

describe("dwaprices rows", () => {
  it("maps the preset onto the file headers", () => {
    expect(columns).toMatchObject({
      brandEn: "trade_name_en",
      ingredients: "active_ingredient",
      strength: "concentration",
      category: "category",
      manufacturer: "company",
      price: "current_price",
      oldPrice: "old_price",
      unitsCount: "units_count",
      barcode: "barcode",
      sourceRef: "id",
    });
    expect(Object.values(columns)).not.toContain("trade_name_ar");
  });

  it("parses a tablet row: name, family, form, pack, strength, prices, barcode, ingredients", () => {
    const row = parseRef("5008");
    expect(row).toMatchObject({
      sourceRef: "5008",
      packText: "15 f.c. tabs",
      priceMinor: 12_200,
      oldPriceMinor: 9_200,
      unitsCount: 15,
      barcode: "6221032116666",
    });
    expect(row.columns).toMatchObject({
      brandEn: "Flumox 1000mg 15 f.c. tabs",
      brandKey: "flumox",
      form: "tablet",
      strengthText: "1000 mg",
      strengthValueMicro: 1_000_000_000,
      strengthUnit: "mg",
    });
    expect(row.ingredients.length).toBeGreaterThan(0);
  });

  it("splits combination ingredients on +", () => {
    const row = parseRef("1");
    expect(row.ingredients.map((ingredient) => ingredient.normalized)).toEqual([
      "chlorpheniramine",
      "paracetamol",
      "pseudoephedrine",
    ]);
    expect(row.columns.brandKey).toBe("1 2 3");
    expect(row.packText).toBe("120 ml");
    expect(row.columns.form).toBe("syrup");
    // Written twice in the file, kept once.
    expect(row.barcode).toBe("6221000003295");
  });

  it("reads a glued form abbreviation and keeps decimal prices exact", () => {
    expect(parseRef("2").columns.form).toBe("tablet");
    expect(parseRef("101")).toMatchObject({ priceMinor: 625, oldPriceMinor: null });
  });

  it("uses the concentration column as the strength and parses per-volume strengths", () => {
    expect(parseRef("3").columns).toMatchObject({
      strengthText: "250mg/5ml",
      strengthValueMicro: 250_000_000,
      brandKey: "5 fluorouracil ebewe",
    });
    expect(parseRef("5002").columns).toMatchObject({
      brandKey: "guzalin",
      strengthText: "650 mg / 5ml",
    });
  });

  it("treats a zero price and a missing barcode as unknown", () => {
    const row = parseRef("501");
    expect(row).toMatchObject({ priceMinor: null, oldPriceMinor: null, barcode: null });
    expect(row.columns.brandKey).toBe("natamet");
  });

  it("rejects a filler entry as invalid but not for other sources", () => {
    const cells = { id: "9001", trade_name_en: "Aaa-9001", active_ingredient: "", category: "" };
    const raw = { row: 1, cells };
    expect(parseImportRow(raw, columns, "dwaprices")).toMatchObject({
      ok: false,
      reason: "placeholder",
    });
    expect(parseImportRow(raw, columns, "eda").ok).toBe(true);
  });

  it("gives every fixture row a family key", () => {
    for (const raw of parsed.rows) {
      const row = parseImportRow(raw, columns, "dwaprices");
      if (!row.ok) {
        // The only rejected fixture row is the filler entry.
        expect(row.reason).toBe("placeholder");
        continue;
      }
      expect(row.value.columns.brandKey).not.toBe("");
    }
    expect(parseRef("101").columns.brandKey).toBe("actifed expectorant");
    expect(parseRef("5").columns.brandKey).toBe("limitless lactoferrin");
    expect(parseRef("5006").columns.brandKey).toBe("flumocin");
  });

  it("leaves unmapped columns undefined so a generic file never blanks stored values", () => {
    const generic = parseImportRow(
      { row: 1, cells: { "Trade Name": "Panadol 500mg Tablets" } },
      fieldColumns({ "Trade Name": "brandEn" }),
      "eda",
    );
    expect(generic.ok).toBe(true);
    if (!generic.ok) return;
    expect(generic.value).toMatchObject({
      sourceRef: null,
      category: undefined,
      priceMinor: undefined,
      packText: undefined,
      barcode: undefined,
    });
    expect(rowKey(generic.value)).toBe("panadol|500000000|mg|tablet");
  });
});

function existingOf(row: ImportRow, patch: Partial<ExistingDrug> = {}): ExistingDrug {
  return {
    id: "00000000-0000-7000-8000-000000000001",
    brandEn: row.columns.brandEn,
    normalizedEn: row.columns.normalizedEn,
    brandAr: null,
    brandKey: row.columns.brandKey,
    form: row.columns.form,
    strengthText: row.columns.strengthText,
    strengthValueMicro: row.columns.strengthValueMicro,
    strengthUnit: row.columns.strengthUnit,
    manufacturer: row.manufacturer,
    country: row.country,
    category: row.category ?? null,
    priceMinor: row.priceMinor ?? null,
    oldPriceMinor: row.oldPriceMinor ?? null,
    packText: row.packText ?? null,
    unitsCount: row.unitsCount ?? null,
    barcode: row.barcode ?? null,
    sourceRef: row.sourceRef,
    adminEditedAt: null,
    importBatchId: "00000000-0000-7000-8000-0000000000aa",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ingredients: new Set(row.ingredients.map((ingredient) => ingredient.normalized)),
    aliases: new Set<string>(),
    ...patch,
  };
}

const context = { batchId: "00000000-0000-7000-8000-0000000000bb", committedAt: null };

describe("planRow for source-identified rows", () => {
  it("identifies the row by its id, not its name", () => {
    expect(rowKey(parseRef("5008"))).toBe("ref|5008");
  });

  it("is new when the id is unknown", () => {
    const plan = planRow(parseRef("5008"), undefined, new Set(), context);
    expect(plan).toMatchObject({ status: "new", write: true });
  });

  it("counts an unchanged re-import as a duplicate and writes nothing", () => {
    const row = parseRef("5008");
    const plan = planRow(row, existingOf(row), new Set(), context);
    expect(plan).toMatchObject({ status: "duplicate", reason: "unchanged", write: false });
  });

  it("updates a changed price and says so", () => {
    const row = parseRef("5008");
    const plan = planRow(row, existingOf(row, { priceMinor: 10_000 }), new Set(), context);
    expect(plan).toMatchObject({ status: "updated", write: true, changes: ["price"] });
  });

  it("follows a renamed product by its id", () => {
    const row = parseRef("5008");
    const stale = existingOf(row, { brandEn: "Flumox old", normalizedEn: "flumox old" });
    expect(planRow(row, stale, new Set(), context).changes).toEqual(["brandEn"]);
  });

  it("never touches a row an admin edited, prices included", () => {
    const row = parseRef("5008");
    const edited = existingOf(row, { priceMinor: 1, adminEditedAt: new Date() });
    const plan = planRow(row, edited, new Set(), context);
    expect(plan).toMatchObject({ status: "duplicate", reason: "admin_edited", write: false });
  });

  it("fills the family key of a row that predates it", () => {
    const row = parseRef("5008");
    const plan = planRow(row, existingOf(row, { brandKey: "" }), new Set(), context);
    expect(plan).toMatchObject({ status: "updated", changes: ["brandKey"] });
  });

  it("flags a repeated id in the file", () => {
    const row = parseRef("5008");
    const seen = new Set<string>();
    planRow(row, undefined, seen, context);
    expect(planRow(row, undefined, seen, context)).toMatchObject({
      status: "duplicate",
      reason: "duplicate_in_file",
    });
  });
});
