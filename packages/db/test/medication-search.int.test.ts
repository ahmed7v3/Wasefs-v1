import { drugColumns } from "@wasfa/shared/drugs";
import { normalizeDrugName } from "@wasfa/shared/normalize";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  getMedication,
  medicationAlternatives,
  medicationCardsFor,
  searchMedications,
} from "../src/medication-search.js";
import { activeIngredients, drugIngredients, drugs } from "../src/schema/index.js";

import { startTestDb, type TestDb } from "./db-fixture.js";

/*
 * Medication search against a real PostgreSQL 18 with pg_trgm: ranking (brand family, ingredient,
 * trigram), barcode lookup, withdrawn drugs, alternatives and the reference cards.
 */

let fixture: TestDb;

beforeAll(async () => {
  fixture = await startTestDb();
}, 180_000);

afterAll(async () => {
  await fixture?.stop();
});

const ingredientIds = new Map<string, string>();

async function ingredient(name: string): Promise<string> {
  const normalized = normalizeDrugName(name).name;
  const known = ingredientIds.get(normalized);
  if (known !== undefined) return known;
  const [row] = await fixture.handle.db
    .insert(activeIngredients)
    .values({ nameEn: name, normalized })
    .returning({ id: activeIngredients.id });
  if (!row) throw new Error("ingredient was not stored");
  ingredientIds.set(normalized, row.id);
  return row.id;
}

async function seed(
  brandEn: string,
  extra: {
    ingredients?: string[];
    priceMinor?: number;
    barcode?: string;
    category?: string;
    status?: "active" | "withdrawn";
    strengthText?: string;
  } = {},
): Promise<string> {
  const columns = drugColumns({ brandEn, strengthText: extra.strengthText });
  const [row] = await fixture.handle.db
    .insert(drugs)
    .values({
      ...columns,
      priceMinor: extra.priceMinor ?? null,
      barcode: extra.barcode ?? null,
      category: extra.category ?? null,
      status: extra.status ?? "active",
    })
    .returning({ id: drugs.id });
  if (!row) throw new Error("drug was not stored");
  for (const name of extra.ingredients ?? []) {
    await fixture.handle.db
      .insert(drugIngredients)
      .values({ drugId: row.id, ingredientId: await ingredient(name) });
  }
  return row.id;
}

describe("searchMedications", () => {
  it("ranks the brand family first, then the ingredient, then similar names", async () => {
    const flumox = await seed("Flumox 500mg 20 caps", { ingredients: ["Flucloxacillin"] });
    const flucox = await seed("Flucoxin 250mg 10 caps", { ingredients: ["Flucloxacillin"] });
    const similar = await seed("Flumoxx 125mg suspension 60 ml");

    const byBrand = await searchMedications(fixture.handle.db, { q: "flumox", limit: 20 });
    expect(byBrand.items[0]?.id).toBe(flumox);
    expect(byBrand.items.map((item) => item.id)).toContain(similar);

    const byIngredient = await searchMedications(fixture.handle.db, {
      q: "flucloxacillin",
      limit: 20,
    });
    expect(byIngredient.items.map((item) => item.id).sort()).toEqual([flucox, flumox].sort());
  });

  it("finds a drug by barcode and hides withdrawn ones", async () => {
    const live = await seed("Barcodex 100mg", { barcode: "6221000012345" });
    await seed("Barcodex old", { barcode: "6221000099999", status: "withdrawn" });
    const hit = await searchMedications(fixture.handle.db, { q: "6221000012345", limit: 20 });
    expect(hit.items.map((item) => item.id)).toEqual([live]);
    const gone = await searchMedications(fixture.handle.db, { q: "6221000099999", limit: 20 });
    expect(gone.items).toEqual([]);
    const text = await searchMedications(fixture.handle.db, { q: "barcodex", limit: 20 });
    expect(text.items.map((item) => item.brandEn)).not.toContain("Barcodex old");
  });

  it("pages with an opaque cursor", async () => {
    for (let i = 0; i < 5; i++) await seed(`Pagedrug ${String(i)}`, { category: "Paging" });
    const first = await searchMedications(fixture.handle.db, {
      q: "pagedrug",
      category: "Paging",
      limit: 2,
    });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await searchMedications(fixture.handle.db, {
      q: "pagedrug",
      category: "Paging",
      limit: 2,
      ...(first.nextCursor === null ? {} : { cursor: first.nextCursor }),
    });
    expect(second.items).toHaveLength(2);
    expect(second.items.map((item) => item.id)).not.toEqual(first.items.map((item) => item.id));
  });
});

describe("getMedication and medicationAlternatives", () => {
  it("returns the detail with ingredient names", async () => {
    const id = await seed("Detailzol 10mg", { ingredients: ["Detailzolamide"], priceMinor: 1250 });
    const detail = await getMedication(fixture.handle.db, id);
    expect(detail?.ingredients).toEqual(["Detailzolamide"]);
    expect(detail?.priceMinor).toBe(1250);
    expect(
      await getMedication(fixture.handle.db, "00000000-0000-7000-8000-000000000000"),
    ).toBeNull();
  });

  it("lists drugs with exactly the same ingredient set, cheapest first, no price last", async () => {
    const base = await seed("Altbase 500mg", {
      ingredients: ["Altone", "Alttwo"],
      priceMinor: 5000,
    });
    const cheap = await seed("Altcheap 500mg", {
      ingredients: ["Altone", "Alttwo"],
      priceMinor: 2000,
    });
    const noPrice = await seed("Altnone 500mg", { ingredients: ["Altone", "Alttwo"] });
    await seed("Altsingle 500mg", { ingredients: ["Altone"], priceMinor: 100 });
    await seed("Altmore 500mg", { ingredients: ["Altone", "Alttwo", "Altthree"], priceMinor: 100 });
    await seed("Altgone 500mg", {
      ingredients: ["Altone", "Alttwo"],
      priceMinor: 1,
      status: "withdrawn",
    });
    const alternatives = await medicationAlternatives(fixture.handle.db, base);
    expect(alternatives.map((item) => item.id)).toEqual([cheap, noPrice]);
  });

  it("has no alternatives for a drug without ingredients", async () => {
    const id = await seed("Loner 1mg");
    expect(await medicationAlternatives(fixture.handle.db, id)).toEqual([]);
  });
});

describe("medicationCardsFor", () => {
  it("builds a brand card with ingredients, strengths and the price range", async () => {
    await seed("Cardex 100mg 10 tabs", {
      ingredients: ["Cardexamide"],
      priceMinor: 1000,
      strengthText: "100 mg",
      category: "Cardio",
    });
    await seed("Cardex 200mg 10 tabs", {
      ingredients: ["Cardexamide"],
      priceMinor: 1800,
      strengthText: "200 mg",
      category: "Cardio",
    });
    const cards = await medicationCardsFor(fixture.handle.db, "Is cardex safe?", 3);
    const card = cards.find((item) => item.title === "Cardex");
    expect(card).toMatchObject({
      kind: "brand",
      ingredients: ["Cardexamide"],
      strengths: ["100 mg", "200 mg"],
      category: "Cardio",
      priceMinMinor: 1000,
      priceMaxMinor: 1800,
      currency: "EGP",
    });
  });

  it("makes an ingredient card, lets the longer brand win and respects the max", async () => {
    await seed("Longname Forte 10mg", { ingredients: ["Longnamide"] });
    await seed("Longname 5mg", { ingredients: ["Longnamide"] });
    const cards = await medicationCardsFor(fixture.handle.db, "longname forte and longnamide", 5);
    expect(cards.map((item) => `${item.kind}:${item.title}`)).toEqual([
      "brand:Longname Forte",
      "ingredient:Longnamide",
    ]);
    expect(
      await medicationCardsFor(fixture.handle.db, "longname forte and longnamide", 1),
    ).toHaveLength(1);
  });

  it("returns nothing for text that names no medicine", async () => {
    expect(await medicationCardsFor(fixture.handle.db, "how are you today", 3)).toEqual([]);
  });
});
