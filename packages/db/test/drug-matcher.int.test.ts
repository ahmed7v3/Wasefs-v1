import { drugColumns } from "@wasfa/shared/drugs";
import { normalizeDrugName } from "@wasfa/shared/normalize";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb } from "../src/client.js";
import { matchDrug } from "../src/drug-matcher.js";
import { activeIngredients, drugAliases, drugIngredients, drugs } from "../src/schema/index.js";

import { startTestDb, type TestDb } from "./db-fixture.js";

/*
 * The matcher against a real PostgreSQL 18 with pg_trgm. The first block is a small, hand-made
 * list for accuracy; the last one adds 50,000 synthetic drugs and times 100 queries (the Task 2.7
 * budget: p95 under 30 ms), so it needs the same container and the GIN indexes of the migration.
 */

let fixture: TestDb;

beforeAll(async () => {
  fixture = await startTestDb();
}, 180_000);

afterAll(async () => {
  await fixture?.stop();
});

interface SeedIngredient {
  name: string;
  nameAr?: string;
  strength?: string;
}

interface SeedDrug {
  brandEn: string;
  brandAr?: string;
  form?: string;
  strength?: string;
  ingredients?: SeedIngredient[];
  aliases?: { alias: string; lang: "ar" | "en" }[];
}

const ingredientIds = new Map<string, string>();

async function ingredientId(item: SeedIngredient): Promise<string> {
  const normalized = normalizeDrugName(item.name).name;
  const known = ingredientIds.get(normalized);
  if (known !== undefined) return known;
  const [row] = await fixture.handle.db
    .insert(activeIngredients)
    .values({ nameEn: item.name, nameAr: item.nameAr ?? null, normalized })
    .returning({ id: activeIngredients.id });
  if (!row) throw new Error("ingredient was not stored");
  ingredientIds.set(normalized, row.id);
  return row.id;
}

async function seed(drug: SeedDrug): Promise<string> {
  const columns = drugColumns({
    brandEn: drug.brandEn,
    brandAr: drug.brandAr,
    form: drug.form,
    strengthText: drug.strength,
  });
  const [row] = await fixture.handle.db.insert(drugs).values(columns).returning({ id: drugs.id });
  if (!row) throw new Error("drug was not stored");
  for (const ingredient of drug.ingredients ?? []) {
    const strength = drugColumns({ brandEn: ingredient.name, strengthText: ingredient.strength });
    await fixture.handle.db.insert(drugIngredients).values({
      drugId: row.id,
      ingredientId: await ingredientId(ingredient),
      strengthText: strength.strengthText,
      strengthValueMicro: strength.strengthValueMicro,
      strengthUnit: strength.strengthUnit,
    });
  }
  for (const alias of drug.aliases ?? []) {
    await fixture.handle.db.insert(drugAliases).values({
      drugId: row.id,
      alias: alias.alias,
      normalized: normalizeDrugName(alias.alias).name,
      lang: alias.lang,
    });
  }
  return row.id;
}

const ids: Record<string, string> = {};

describe("matchDrug accuracy", () => {
  beforeAll(async () => {
    const paracetamol = { name: "Paracetamol", nameAr: "باراسيتامول" };
    ids.panadol = await seed({
      brandEn: "Panadol",
      brandAr: "بنادول",
      form: "tablet",
      strength: "500 mg",
      ingredients: [{ ...paracetamol, strength: "500 mg" }],
    });
    ids.panadolExtra = await seed({
      brandEn: "Panadol Extra",
      brandAr: "بنادول اكسترا",
      form: "tablet",
      strength: "500 mg",
      ingredients: [
        { ...paracetamol, strength: "500 mg" },
        { name: "Caffeine", strength: "65 mg" },
      ],
    });
    ids.panadolJoint = await seed({
      brandEn: "Panadol Joint",
      form: "tablet",
      strength: "665 mg",
      ingredients: [{ ...paracetamol, strength: "665 mg" }],
    });
    ids.augmentin1g = await seed({
      brandEn: "Augmentin",
      brandAr: "اوجمنتين",
      form: "tablet",
      strength: "1 g",
      ingredients: [
        { name: "Amoxicillin", strength: "875 mg" },
        { name: "Clavulanic acid", strength: "125 mg" },
      ],
      aliases: [{ alias: "أوغمنتين", lang: "ar" }],
    });
    ids.augmentin625 = await seed({
      brandEn: "Augmentin",
      brandAr: "اوجمنتين",
      form: "tablet",
      strength: "625 mg",
      ingredients: [
        { name: "Amoxicillin", strength: "500 mg" },
        { name: "Clavulanic acid", strength: "125 mg" },
      ],
    });
    ids.augmentinSyrup = await seed({
      brandEn: "Augmentin",
      form: "suspension",
      strength: "457 mg",
      ingredients: [{ name: "Amoxicillin" }],
    });
    ids.brufen = await seed({
      brandEn: "Brufen",
      brandAr: "بروفين",
      form: "tablet",
      strength: "400 mg",
      ingredients: [{ name: "Ibuprofen", strength: "400 mg" }],
    });
    ids.cataflam = await seed({
      brandEn: "Cataflam",
      brandAr: "كاتافلام",
      form: "tablet",
      strength: "50 mg",
      ingredients: [{ name: "Diclofenac", strength: "50 mg" }],
      aliases: [{ alias: "Diclofenac potassium brand", lang: "en" }],
    });
    await fixture.handle.sql`analyze`;
  }, 60_000);

  it("accepts an exact English brand with its strength", async () => {
    const [top] = await matchDrug(fixture.handle.db, "Panadol 500mg tablets");
    expect(top?.drugId).toBe(ids.panadol);
    expect(top?.score).toBeGreaterThanOrEqual(0.95);
    expect(top?.explanation).toMatchObject({
      matchedOn: "brand",
      strength: "match",
      form: "match",
    });
  });

  it("ignores case, spacing and punctuation", async () => {
    const [top] = await matchDrug(fixture.handle.db, "  PANADOL   500 mg. Tabs ");
    expect(top?.drugId).toBe(ids.panadol);
    expect(top?.score).toBeGreaterThanOrEqual(0.95);
  });

  it("finds an Arabic brand, with Arabic digits and unit", async () => {
    const [top] = await matchDrug(fixture.handle.db, "بنادول ٥٠٠ ملجم");
    expect(top?.drugId).toBe(ids.panadol);
    expect(top?.explanation.strength).toBe("match");
    expect(top?.score).toBeGreaterThanOrEqual(0.95);
  });

  it("finds an Arabic brand through hamza and tashkeel variants", async () => {
    for (const text of ["أوجمنتين", "اوجمنتين", "أَوْجْمَنْتِين", "اوجـمنتين"]) {
      const [top] = await matchDrug(fixture.handle.db, text);
      expect(top?.brandEn, text).toBe("Augmentin");
      expect(top?.score, text).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("finds a drug by an Arabic alias and says so", async () => {
    const candidates = await matchDrug(fixture.handle.db, "اوغمنتين");
    expect(candidates[0]?.brandEn).toBe("Augmentin");
    expect(candidates[0]?.explanation.matchedOn).toBe("alias");
  });

  it("finds an English alias", async () => {
    const [top] = await matchDrug(fixture.handle.db, "diclofenac potassium brand");
    expect(top?.drugId).toBe(ids.cataflam);
    expect(top?.explanation.matchedOn).toBe("alias");
  });

  it("returns the brand family key of every candidate", async () => {
    const [top] = await matchDrug(fixture.handle.db, "Panadol Extra");
    expect(top?.brandKey).toBe("panadol extra");
  });

  it("finds a learned or admin alias exactly, but not a source-less one", async () => {
    const db = fixture.handle.db;
    await db.insert(drugAliases).values([
      {
        drugId: ids.panadolJoint ?? "",
        alias: "Zzfoo",
        normalized: "zzfoo",
        lang: "en",
        source: "learned",
      },
      { drugId: ids.panadol ?? "", alias: "Zzbar", normalized: "zzbar", lang: "en" },
    ]);
    const [exact] = await matchDrug(db, "Zzfoo");
    expect(exact).toMatchObject({ drugId: ids.panadolJoint, score: 1 });
    expect(exact?.explanation.matchedOn).toBe("alias_exact");
    const [plain] = await matchDrug(db, "Zzbar");
    expect(plain?.explanation.matchedOn).toBe("alias");
  });

  it("takes the score adjustments from the options", async () => {
    const db = fixture.handle.db;
    // A typo keeps the name score under 1, so the clamp at 1 cannot hide the bonus.
    const base = await matchDrug(db, "Panadl 500 mg");
    const raised = await matchDrug(db, "Panadl 500 mg", { strengthBonus: 0 });
    expect(base.find((c) => c.drugId === ids.panadol)?.score).toBeLessThan(1);
    expect(raised.find((c) => c.drugId === ids.panadol)?.score).toBeLessThan(
      base.find((c) => c.drugId === ids.panadol)?.score ?? 0,
    );
    const limited = await matchDrug(db, "Panadol", { limit: 2 });
    expect(limited.length).toBeLessThanOrEqual(2);
    expect(await matchDrug(db, "Pandol", { similarityFloor: 1 })).toEqual([]);
  });

  it("puts a typo in the verify zone but still first", async () => {
    const candidates = await matchDrug(fixture.handle.db, "Augmentn");
    expect(candidates[0]?.brandEn).toBe("Augmentin");
    expect(candidates[0]?.score).toBeGreaterThanOrEqual(0.5);
    expect(candidates[0]?.score).toBeLessThan(0.85);
  });

  it("tells a brand from an ingredient", async () => {
    const brand = await matchDrug(fixture.handle.db, "Panadol");
    expect(brand[0]?.explanation.matchedOn).toBe("brand");

    const generic = await matchDrug(fixture.handle.db, "Paracetamol");
    expect(generic.length).toBeGreaterThan(0);
    expect(generic.every((c) => c.explanation.matchedOn === "ingredient")).toBe(true);
    expect(generic.map((c) => c.drugId)).toEqual(
      expect.arrayContaining([ids.panadol, ids.panadolExtra, ids.panadolJoint]),
    );
  });

  it("uses the ingredient strength to rank generics", async () => {
    const [top] = await matchDrug(fixture.handle.db, "Paracetamol 665mg");
    expect(top?.drugId).toBe(ids.panadolJoint);
    expect(top?.explanation.strength).toBe("match");
  });

  it("separates Panadol 500 from Panadol Extra", async () => {
    const plain = await matchDrug(fixture.handle.db, "Panadol 500");
    expect(plain[0]?.drugId).toBe(ids.panadol);
    expect(plain[0]?.explanation.strength).toBe("match");
    expect(plain[0]?.score).toBeGreaterThan(plain[1]?.score ?? 1);

    const extra = await matchDrug(fixture.handle.db, "Panadol Extra", {
      strength: { value: 500, unit: "mg" },
    });
    expect(extra[0]?.drugId).toBe(ids.panadolExtra);
    expect(extra[0]?.score).toBeGreaterThanOrEqual(0.95);
    expect(extra[0]?.score).toBeGreaterThan(extra[1]?.score ?? 1);
  });

  it("picks the strength variant of the same brand", async () => {
    const small = await matchDrug(fixture.handle.db, "Augmentin 625mg");
    expect(small[0]?.drugId).toBe(ids.augmentin625);
    expect(small[0]?.explanation.strength).toBe("match");
    const other = small.find((c) => c.drugId === ids.augmentin1g);
    expect(other?.explanation.strength).toBe("conflict");
    expect(other?.score).toBeLessThan(small[0]?.score ?? 0);

    const big = await matchDrug(fixture.handle.db, "اوجمنتين 1 جم");
    expect(big[0]?.drugId).toBe(ids.augmentin1g);
  });

  it("flags a strength that the database does not have as a conflict", async () => {
    const [top] = await matchDrug(fixture.handle.db, "Brufen 800mg");
    expect(top?.drugId).toBe(ids.brufen);
    expect(top?.explanation.strength).toBe("conflict");
    // 1.0 - 0.15: high, but the classifier must not accept it.
    expect(top?.score).toBeCloseTo(0.85, 2);
  });

  it("rewards the right dosage form", async () => {
    const candidates = await matchDrug(fixture.handle.db, "Augmentin", { form: "Susp." });
    const syrup = candidates.find((c) => c.drugId === ids.augmentinSyrup);
    const tablet = candidates.find((c) => c.drugId === ids.augmentin1g);
    expect(syrup?.explanation.form).toBe("match");
    expect(tablet?.explanation.form).toBe("mismatch");
    expect(candidates[0]?.drugId).toBe(ids.augmentinSyrup);
  });

  it("knows a strength is unknown when the drug has none", async () => {
    const [top] = await matchDrug(fixture.handle.db, "Augmentin", {
      strength: { value: 457, unit: "mg" },
    });
    expect(top?.explanation.strength).toBe("match");
  });

  it("returns nothing for text that resembles no drug", async () => {
    expect(await matchDrug(fixture.handle.db, "xylophone quartz")).toEqual([]);
    expect(await matchDrug(fixture.handle.db, "   ")).toEqual([]);
  });

  it("returns at most 5 candidates by default and honours a limit", async () => {
    const all = await matchDrug(fixture.handle.db, "Augmentin", { limit: 2 });
    expect(all).toHaveLength(2);
    const some = await matchDrug(fixture.handle.db, "Panadol");
    expect(some.length).toBeLessThanOrEqual(5);
  });

  it("orders candidates by score and keeps every score within 0..1", async () => {
    const candidates = await matchDrug(fixture.handle.db, "Panadol 500mg");
    const scores = candidates.map((c) => c.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    for (const score of scores) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});

// --- Speed on a realistic table size ---

const CONSONANTS = [
  "b",
  "c",
  "d",
  "f",
  "g",
  "h",
  "k",
  "l",
  "m",
  "n",
  "p",
  "r",
  "s",
  "t",
  "v",
  "z",
  "th",
  "ph",
];
const VOWELS = ["a", "e", "i", "o", "u", "ia", "ou"];
const ARABIC_CONSONANTS = [..."بتثجحخدرزسشصطعفقكلمنهـ".replace("ـ", "")];
const ARABIC_VOWELS = ["ا", "و", "ي", ""];

/** Small deterministic generator: the same table every run. */
function prng(seedValue: number): () => number {
  let state = seedValue >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe("matchDrug speed", () => {
  const TOTAL = 50_000;
  const random = prng(2027);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
  // A syllable is consonant + vowel, sometimes closed by a consonant: words as varied as brand names.
  const syllable = (): string =>
    pick(CONSONANTS) + pick(VOWELS) + (random() < 0.35 ? pick(CONSONANTS) : "");
  const word = (parts: number): string => Array.from({ length: parts }, syllable).join("");
  const arabicWord = (parts: number): string =>
    Array.from({ length: parts }, () => pick(ARABIC_CONSONANTS) + pick(ARABIC_VOWELS)).join("");

  // One connection created after the setting below, so every query runs with production tuning.
  let timed: ReturnType<typeof createDb>;
  afterAll(async () => {
    await timed?.close();
  });

  const queries: { text: string; strength?: { value: number; unit: "mg" } }[] = [];

  beforeAll(async () => {
    const { db, sql: client } = fixture.handle;
    // 2,000 ingredients; most drugs carry one or two.
    const ingredientRows = Array.from({ length: 2000 }, (_, i) => {
      const name = `${word(4)}${i}ine`;
      return { nameEn: name, nameAr: null, normalized: normalizeDrugName(name).name };
    });
    const insertedIngredients: { id: string }[] = [];
    for (let i = 0; i < ingredientRows.length; i += 1000) {
      insertedIngredients.push(
        ...(await db
          .insert(activeIngredients)
          .values(ingredientRows.slice(i, i + 1000))
          .onConflictDoNothing()
          .returning({ id: activeIngredients.id })),
      );
    }

    for (let start = 0; start < TOTAL; start += 2500) {
      const batch = Array.from({ length: 2500 }, (_, k) => {
        const index = start + k;
        const brandEn = `${word(3)}${index % 7 === 0 ? ` ${word(2)}` : ""}`;
        const brandAr = index % 3 === 0 ? arabicWord(3) : undefined;
        const strengthValue = pick([5, 10, 20, 50, 100, 250, 500, 1000]);
        const columns = drugColumns({
          brandEn,
          brandAr,
          form: pick(["tablet", "capsule", "syrup", "cream", "ampoule"]),
          strengthText: `${strengthValue} mg`,
        });
        if (index % 500 === 0) {
          queries.push({
            text: index % 1000 === 0 ? brandEn : `${brandEn.slice(0, -1)}`,
            strength: { value: strengthValue, unit: "mg" },
          });
        }
        return columns;
      });
      const inserted = await db.insert(drugs).values(batch).returning({ id: drugs.id });
      const links = inserted.flatMap((row, k) => {
        const first = insertedIngredients[(start + k) % insertedIngredients.length];
        const second = insertedIngredients[(start + k * 7 + 1) % insertedIngredients.length];
        return [first, ...(k % 3 === 0 ? [second] : [])]
          .filter((ingredient): ingredient is { id: string } => ingredient !== undefined)
          .map((ingredient) => ({ drugId: row.id, ingredientId: ingredient.id }));
      });
      // Duplicates of (drug, ingredient) are possible when both picks coincide.
      await db.insert(drugIngredients).values(links).onConflictDoNothing();
    }
    // Bulk inserts leave a GIN pending list that every query would scan; autovacuum clears it in
    // production, the test does it by hand.
    await client`vacuum analyze drugs`;
    await client`analyze drug_ingredients`;
    await client`analyze active_ingredients`;
    // infra/docker/postgres/postgresql.conf sets random_page_cost = 1.1 (SSD); the stock 4 makes the
    // planner prefer scanning 50,000 rows to the trigram index.
    await client.unsafe(
      `alter database "${new URL(fixture.url).pathname.slice(1)}" set random_page_cost = 1.1`,
    );
    timed = createDb({ url: fixture.url, max: 1 });
  }, 300_000);

  it("answers 100 queries with p95 under 30 ms on 50,000 drugs", async () => {
    const [{ count }] = (await fixture.handle.sql`select count(*)::int as count from drugs`) as [
      { count: number },
    ];
    expect(count).toBeGreaterThanOrEqual(TOTAL);

    const texts: { text: string; strength?: { value: number; unit: "mg" } }[] = [
      { text: "Panadol 500mg" },
      { text: "Augmentn" },
      { text: "بنادول" },
      { text: "Paracetamol" },
    ];
    const rows = (await fixture.handle.sql`
      select brand_en, brand_ar, normalized_en from drugs order by id limit 40
    `) as unknown as { brand_en: string; brand_ar: string | null }[];
    for (const row of rows) {
      texts.push({ text: row.brand_en });
      if (row.brand_ar !== null) texts.push({ text: row.brand_ar });
    }
    texts.push(...queries);
    for (let i = 0; texts.length < 110; i++) texts.push({ text: `${word(3)} ${i}` });

    // Warm the connection, the plan cache and the OS cache; the budget is for steady state.
    for (const query of texts.slice(0, 10)) {
      await matchDrug(timed.db, query.text, { strength: query.strength ?? null });
    }

    const timings: number[] = [];
    for (const query of texts.slice(10, 110)) {
      const started = performance.now();
      const result = await matchDrug(timed.db, query.text, {
        strength: query.strength ?? null,
      });
      timings.push(performance.now() - started);
      expect(result.length).toBeLessThanOrEqual(5);
    }
    timings.sort((a, b) => a - b);
    const p95 = timings[Math.floor(timings.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
    // Logged so a regression can be read off the CI output, not only the assertion.
    process.stdout.write(
      `matchDrug on ${count} drugs: p50 ${timings[49]?.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${timings.at(-1)?.toFixed(1)} ms\n`,
    );
    // 30 ms is the budget on production-class hardware; a shared CI runner is several times slower.
    expect(p95).toBeLessThan(process.env.CI ? 150 : 30);
  }, 120_000);

  it("still finds a seeded drug among the 50,000", async () => {
    const [top] = await matchDrug(fixture.handle.db, "Panadol 500mg");
    expect(top?.brandEn).toBe("Panadol");
    expect(top?.explanation.strength).toBe("match");
    await fixture.handle.db.execute(sql`select 1`);
  });
});
