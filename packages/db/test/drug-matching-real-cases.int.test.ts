import { decideMatch } from "@wasfa/shared/drug-decision";
import { drugColumns } from "@wasfa/shared/drugs";
import { normalizeDrugName } from "@wasfa/shared/normalize";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { matchDrug } from "../src/drug-matcher.js";
import { medicationCardsFor, searchMedications } from "../src/medication-search.js";
import { activeIngredients, drugIngredients, drugs } from "../src/schema/index.js";

import { startTestDb, type TestDb } from "./db-fixture.js";

import type { DrugMatchCandidate } from "@wasfa/shared/drugs";

/*
 * The real failures of a production prescription ("Relaxon", "x - Glibimet 5" + Arabic directions,
 * "Bepra 20", "Riopan susp", "Motidyl") against a small Egyptian-style list, plus the Arabic-script
 * name, the typo and the made-up name that must never be accepted.
 */

let fixture: TestDb;

const settings = { acceptScore: 0.85, reviewScore: 0.5, minMargin: 0.06 };

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

async function seed(brandEn: string, ingredients: string[] = []): Promise<void> {
  const [row] = await fixture.handle.db
    .insert(drugs)
    .values(drugColumns({ brandEn }))
    .returning({ id: drugs.id });
  if (!row) throw new Error("drug was not stored");
  for (const name of ingredients) {
    await fixture.handle.db
      .insert(drugIngredients)
      .values({ drugId: row.id, ingredientId: await ingredient(name) });
  }
}

// brand names exactly as dwaprices writes them
const LIST: [string, string[]?][] = [
  ["Riopan 800mg/10ml susp. 200 ml", ["Magaldrate"]],
  ["Riopan plus 800mg/10ml susp. 200 ml", ["Magaldrate", "Simethicone"]],
  ["Riopan gel 10 sachets", ["Magaldrate"]],
  ["Bepra 20mg 14 f.c. tabs", ["Esomeprazole"]],
  ["Bepra 40mg 14 f.c. tabs", ["Esomeprazole"]],
  ["Glibimet 2.5/500 mg 30 f.c. tabs", ["Glibenclamide", "Metformin"]],
  ["Glibimet 5/500 mg 30 f.c. tabs", ["Glibenclamide", "Metformin"]],
  ["Relaxon 50mg 20 tabs", ["Orphenadrine"]],
  ["Motidyl 10mg 30 f.c. tabs", ["Domperidone"]],
  ["Motilium 10mg 30 f.c. tabs", ["Domperidone"]],
  ["Panadol 500mg 24 f.c. tabs", ["Paracetamol"]],
  ["Panadol extra 500mg 24 f.c. tabs", ["Paracetamol", "Caffeine"]],
  ["Panadol advance 500mg 24 f.c. tabs", ["Paracetamol"]],
  ["Panadol cold & flu 24 f.c. tabs", ["Paracetamol", "Pseudoephedrine"]],
  ["Panadol night 20 f.c. tabs", ["Paracetamol", "Diphenhydramine"]],
  ["Panadol syrup 100 ml", ["Paracetamol"]],
  ["Augmentin 1gm 14 f.c. tabs", ["Amoxicillin", "Clavulanic acid"]],
  ["Augmentin 625mg 14 f.c. tabs", ["Amoxicillin", "Clavulanic acid"]],
  ["Augmentin 457mg/5ml susp. 70 ml", ["Amoxicillin", "Clavulanic acid"]],
  ["Concor 5mg 30 f.c. tabs", ["Bisoprolol"]],
  ["Concor 10mg 30 f.c. tabs", ["Bisoprolol"]],
  ["Cataflam 50mg 20 tabs", ["Diclofenac"]],
  ["Voltaren 50mg 20 tabs", ["Diclofenac"]],
  ["Voltaren emulgel 50 gm", ["Diclofenac"]],
  ["Brufen 400mg 30 tabs", ["Ibuprofen"]],
  ["Novalgin 500mg 20 tabs", ["Metamizole"]],
  ["Flumox 500mg 20 caps", ["Amoxicillin"]],
  ["Flucoxin 250mg 10 caps", ["Flucloxacillin"]],
  ["Cipro 500mg 10 f.c. tabs", ["Ciprofloxacin"]],
  ["Ciprocin 500mg 10 f.c. tabs", ["Ciprofloxacin"]],
  ["Antinal 200mg 24 caps", ["Nifuroxazide"]],
  ["Digestin 20 tabs", ["Simethicone"]],
  ["Nexium 40mg 14 tabs", ["Esomeprazole"]],
  ["Lipitor 20mg 30 f.c. tabs", ["Atorvastatin"]],
  ["Congestal 20 tabs", ["Paracetamol", "Chlorpheniramine"]],
  ["Cetal 500mg 20 tabs", ["Paracetamol"]],
  ["Adol 500mg 24 tabs", ["Paracetamol"]],
  ["Amaryl 3mg 30 tabs", ["Glimepiride"]],
  ["Glucophage 1000mg 30 tabs", ["Metformin"]],
  ["Ventolin inhaler 200 dose", ["Salbutamol"]],
];

beforeAll(async () => {
  fixture = await startTestDb();
  for (const [name, ingredients] of LIST) await seed(name, ingredients);
  await fixture.handle.sql`analyze`;
}, 180_000);

afterAll(async () => {
  await fixture?.stop();
});

const decide = (candidates: DrugMatchCandidate[], strengthWritten = false) =>
  decideMatch(
    {
      candidates: candidates.map((candidate) => ({ ...candidate, via: "primary" as const })),
      legibility: "clear",
      strengthWritten,
    },
    settings,
  );

describe("matchDrug on prescription lines", () => {
  it.each([
    ["Relaxon", "relaxon"],
    ["x - Glibimet 5 نصف ساعة قبل الاكل", "glibimet"],
    ["Bepra 20 قرص بعد الأكل", "bepra"],
    ["Riopan susp ملعقة ٣ مرات", "riopan"],
    ["Motidyl", "motidyl"],
    ["1) Rx Panadol 500mg tab", "panadol"],
    ["Voltaren", "voltaren"],
  ])("%s is accepted as %s", async (line, key) => {
    const candidates = await matchDrug(fixture.handle.db, line);
    expect(candidates[0]?.brandKey).toBe(key);
    const decision = decide(candidates);
    expect(decision.matchClass).toBe("accept");
    expect(decision.chosen?.brandKey).toBe(key);
  });

  it("finds a short brand that is only one word of a longer product name", async () => {
    // "Panadol" is a family of its own beside "Panadol extra": the plain one wins.
    const [top] = await matchDrug(fixture.handle.db, "Panadol");
    expect(top?.brandKey).toBe("panadol");
  });

  it("offers an Arabic-script name through its Latin spellings but never accepts it", async () => {
    const candidates = await matchDrug(fixture.handle.db, "ريوبان قرص بعد الأكل");
    expect(candidates.slice(0, 3).map((c) => c.brandKey)).toContain("riopan");
    expect(candidates[0]?.transliterated).toBe(true);
    expect(decide(candidates).matchClass).toBe("verify");
  });

  it("does not accept a misspelling or a made-up name", async () => {
    const typo = await matchDrug(fixture.handle.db, "Augmntin");
    expect(typo[0]?.brandKey).toBe("augmentin");
    expect(decide(typo).matchClass).not.toBe("accept");

    const fake = await matchDrug(fixture.handle.db, "Zexorin 20");
    expect(decide(fake).matchClass).not.toBe("accept");
  });

  it("does not take two near brands for each other", async () => {
    const cipro = await matchDrug(fixture.handle.db, "Cipro");
    expect(cipro[0]?.brandKey).toBe("cipro");
    const ciprocin = await matchDrug(fixture.handle.db, "Ciprocin");
    expect(ciprocin[0]?.brandKey).toBe("ciprocin");
  });
});

describe("searchMedications on real cases", () => {
  it("finds the Panadol family from the Arabic name", async () => {
    const { items } = await searchMedications(fixture.handle.db, { q: "بانادول", limit: 10 });
    expect(items[0]?.brandKey).toBe("panadol");
  });

  it("finds Riopan by name, with a note after it", async () => {
    for (const q of ["riopan", "Riopan شراب بعد الاكل", "ريوبان"]) {
      const { items, didYouMean } = await searchMedications(fixture.handle.db, { q, limit: 10 });
      expect(items[0]?.brandKey, q).toBe("riopan");
      expect(didYouMean, q).toBeNull();
    }
  });

  it("suggests the right brand for a typo", async () => {
    const { items, didYouMean } = await searchMedications(fixture.handle.db, {
      q: "augmntin",
      limit: 10,
    });
    expect(items[0]?.brandKey).toBe("augmentin");
    expect(didYouMean).toBe("Augmentin");
  });
});

describe("medicationCardsFor on Arabic words", () => {
  it("builds a card for a brand written in Arabic inside a sentence", async () => {
    const cards = await medicationCardsFor(fixture.handle.db, "عندي ريوبان و بانادول", 3);
    expect(cards.map((card) => card.title)).toEqual(["Riopan", "Panadol"]);
  });
});
