import { DRUG_SIMILARITY_THRESHOLD } from "@wasfa/shared/drugs";
import { normalizeDrugName } from "@wasfa/shared/normalize";
import { asc, eq, inArray, sql } from "drizzle-orm";

import { activeIngredients, drugIngredients, drugs, type Drug } from "./schema/index.js";

import type { Database } from "./client.js";
import type {
  MedicationCard,
  MedicationDetail,
  MedicationSummary,
} from "@wasfa/shared/schemas/medications";

/*
 * Medication search for users, alternatives and the website assistant's reference cards
 * (docs/MEDICATIONS.md sections 5 and 6). Read-only, no AI. Search ranks exact brand family first,
 * then drugs of an exactly named active ingredient, then trigram similarity (the `%` operator needs
 * `pg_trgm.similarity_threshold`, set per transaction like the matcher does). Withdrawn drugs are
 * never shown.
 */

/** Deepest page offset a search can reach: users refine the query instead of paging forever. */
export const MEDICATION_MAX_OFFSET = 500;
export const MEDICATION_MAX_LIMIT = 50;

const BARCODE = /^\d{8,14}$/;
const ARABIC_LETTER = /[؀-ۿݐ-ݿ]/;

/** n-grams per message that are looked up (the cards query is cheap, but not unbounded). */
const CARD_MAX_NGRAMS = 60;
const CARD_MAX_STRENGTHS = 6;
const CARD_MAX_FORMS = 4;
const CARD_MAX_INGREDIENTS = 5;
const NGRAM_MAX_WORDS = 3;
const NGRAM_MIN_CHARS = 3;

export interface MedicationSearchOptions {
  q: string;
  category?: string | undefined;
  /** Rows per page, 1-50. */
  limit: number;
  /** The `nextCursor` of the previous page. */
  cursor?: string | undefined;
}

const encodeCursor = (offset: number): string => Buffer.from(String(offset)).toString("base64url");

function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const text = Buffer.from(cursor, "base64url").toString();
  if (!/^\d{1,4}$/.test(text)) return 0;
  return Math.min(Number(text), MEDICATION_MAX_OFFSET);
}

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

interface DrugWithIngredients {
  drug: Drug;
  ingredients: { name: string; strength: string | null }[];
}

/** The drugs with their ingredients, in the order of `ids` (ids that no longer exist are skipped). */
async function load(db: Database, ids: readonly string[]): Promise<DrugWithIngredients[]> {
  if (ids.length === 0) return [];
  const [drugRows, ingredientRows] = await Promise.all([
    db
      .select()
      .from(drugs)
      .where(inArray(drugs.id, [...ids])),
    db
      .select({
        drugId: drugIngredients.drugId,
        name: activeIngredients.nameEn,
        strength: drugIngredients.strengthText,
      })
      .from(drugIngredients)
      .innerJoin(activeIngredients, eq(activeIngredients.id, drugIngredients.ingredientId))
      .where(inArray(drugIngredients.drugId, [...ids]))
      .orderBy(asc(activeIngredients.nameEn)),
  ]);
  const byId = new Map(drugRows.map((drug) => [drug.id, drug]));
  return ids.flatMap((id) => {
    const drug = byId.get(id);
    if (drug === undefined) return [];
    return [
      {
        drug,
        ingredients: ingredientRows
          .filter((row) => row.drugId === id)
          .map((row) => ({ name: row.name, strength: row.strength })),
      },
    ];
  });
}

const summaryOf = ({ drug, ingredients }: DrugWithIngredients): MedicationSummary => ({
  id: drug.id,
  brandEn: drug.brandEn,
  brandAr: drug.brandAr,
  brandKey: drug.brandKey,
  form: drug.form,
  strengthText: drug.strengthText,
  packText: drug.packText,
  category: drug.category,
  manufacturer: drug.manufacturer,
  ingredients: ingredients.map((ingredient) => ingredient.name),
  priceMinor: drug.priceMinor,
  currency: drug.currency,
  priceUpdatedAt: iso(drug.priceUpdatedAt),
});

/** Summaries for ids, in that order. */
export async function medicationSummaries(
  db: Database,
  ids: readonly string[],
): Promise<MedicationSummary[]> {
  return (await load(db, ids)).map(summaryOf);
}

/**
 * A page of medications for a typed name. Digits only (8-14) is a barcode lookup; anything else is
 * normalized like drug names are, then ranked: brand family, active ingredient, trigram similarity.
 */
export async function searchMedications(
  db: Database,
  options: MedicationSearchOptions,
): Promise<{ items: MedicationSummary[]; nextCursor: string | null }> {
  const q = options.q.trim();
  const limit = Math.max(1, Math.min(options.limit, MEDICATION_MAX_LIMIT));
  const offset = decodeCursor(options.cursor);
  const category = options.category ?? null;
  const empty = { items: [], nextCursor: null };
  if (q === "") return empty;

  let ids: string[];
  if (BARCODE.test(q)) {
    const rows = await db.execute<{ id: string }>(sql`
      select d.id from drugs d
      where d.barcode = ${q}::text and d.status <> 'withdrawn'
        and (${category}::text is null or d.category = ${category}::text)
      order by d.brand_en, d.id
      limit ${limit + 1} offset ${offset}
    `);
    ids = Array.from(rows, (row) => row.id);
  } else {
    const key = normalizeDrugName(q).name;
    if (key === "") return empty;
    const prefix = `${key.replace(/[\\%_]/g, "\\$&")}%`;
    // Latin text shares no trigram with an Arabic name: scan that index only for Arabic text.
    const arabicBrands = ARABIC_LETTER.test(key)
      ? sql`union all
          select d.id, 3, similarity(d.normalized_ar, ${key}::text)::float8
          from drugs d
          where d.normalized_ar % ${key}::text`
      : sql``;
    const rows = await db.transaction(async (tx) => {
      // SET LOCAL takes no parameters; the value is a constant of ours, never input.
      await tx.execute(
        sql.raw(`set local pg_trgm.similarity_threshold = ${DRUG_SIMILARITY_THRESHOLD}`),
      );
      return await tx.execute<{ id: string }>(sql`
        with hits as (
          select d.id, 1 as rank, similarity(d.normalized_en, ${key}::text)::float8 as s
          from drugs d
          where d.brand_key = ${key}::text or d.brand_key like ${prefix}
          union all
          select di.drug_id, 2, 1.0::float8
          from active_ingredients i
          join drug_ingredients di on di.ingredient_id = i.id
          where i.normalized = ${key}::text
          union all
          select d.id, 3, similarity(d.normalized_en, ${key}::text)::float8
          from drugs d
          where d.normalized_en % ${key}::text
          ${arabicBrands}
        ),
        best as (
          select distinct on (id) id, rank, s from hits order by id, rank, s desc
        )
        select d.id
        from best b
        join drugs d on d.id = b.id
        where d.status <> 'withdrawn'
          and (${category}::text is null or d.category = ${category}::text)
        order by b.rank, b.s desc, d.brand_en, d.id
        limit ${limit + 1} offset ${offset}
      `);
    });
    ids = Array.from(rows, (row) => row.id);
  }

  const more = ids.length > limit && offset + limit < MEDICATION_MAX_OFFSET;
  return {
    items: await medicationSummaries(db, ids.slice(0, limit)),
    nextCursor: more ? encodeCursor(offset + limit) : null,
  };
}

/** One medication with its ingredient strengths; `null` when it does not exist. */
export async function getMedication(db: Database, id: string): Promise<MedicationDetail | null> {
  const [row] = await load(db, [id]);
  if (row === undefined) return null;
  const { drug } = row;
  return {
    ...summaryOf(row),
    oldPriceMinor: drug.oldPriceMinor,
    unitsCount: drug.unitsCount,
    barcode: drug.barcode,
    status: drug.status,
    ingredientStrengths: row.ingredients,
  };
}

/**
 * Other active drugs with exactly this drug's set of active ingredients (never fewer, never more),
 * cheapest first; drugs without a price come last. A drug with no ingredient has no alternatives.
 */
export async function medicationAlternatives(
  db: Database,
  id: string,
  limit = 10,
): Promise<MedicationSummary[]> {
  const mine = await db
    .select({ ingredientId: drugIngredients.ingredientId })
    .from(drugIngredients)
    .where(eq(drugIngredients.drugId, id));
  if (mine.length === 0) return [];
  const list = sql.join(
    mine.map((row) => sql`${row.ingredientId}::uuid`),
    sql`, `,
  );
  const count = mine.length;
  const rows = await db.execute<{ id: string }>(sql`
    select d.id
    from drugs d
    where d.status = 'active'
      and d.id <> ${id}::uuid
      and d.id in (select drug_id from drug_ingredients where ingredient_id in (${list}))
      and (select count(*) from drug_ingredients x where x.drug_id = d.id) = ${count}
      and (select count(*) from drug_ingredients x
           where x.drug_id = d.id and x.ingredient_id in (${list})) = ${count}
    order by d.price_minor asc nulls last, d.brand_en, d.id
    limit ${Math.max(1, Math.min(limit, MEDICATION_MAX_LIMIT))}
  `);
  return medicationSummaries(
    db,
    Array.from(rows, (row) => row.id),
  );
}

/**
 * The normalized 1-3-word n-grams of a text, in order of first appearance, without duplicates, at most
 * 60. Grams shorter than 3 characters once normalized (a stray letter, a form or strength word that
 * normalizes away) are dropped.
 */
export function medicationNgrams(text: string): string[] {
  const words = text.split(/[^\p{L}\p{N}]+/u).filter((word) => word !== "");
  const seen = new Set<string>();
  const grams: string[] = [];
  for (let start = 0; start < words.length && grams.length < CARD_MAX_NGRAMS; start++) {
    for (let size = 1; size <= NGRAM_MAX_WORDS && start + size <= words.length; size++) {
      const name = normalizeDrugName(words.slice(start, start + size).join(" ")).name;
      if (name.length < NGRAM_MIN_CHARS || seen.has(name)) continue;
      seen.add(name);
      grams.push(name);
      if (grams.length >= CARD_MAX_NGRAMS) break;
    }
  }
  return grams;
}

type AggregateRow = {
  key: string;
  title: string | null;
  strengths: string[] | null;
  forms: string[] | null;
  category: string | null;
  price_min: number | null;
  price_max: number | null;
  currency: string | null;
};

const titleCase = (text: string): string =>
  text.replace(
    /(^|\s)(\p{L})/gu,
    (_match, space: string, letter: string) => `${space}${letter.toUpperCase()}`,
  );

const firstOf = (values: string[] | null, max: number): string[] =>
  [...(values ?? [])].sort().slice(0, max);

/**
 * Reference cards for the medicines named in a text: every 1-3-word n-gram is looked up exactly
 * (indexed equality) against brand families and active-ingredient names, nothing fuzzy. A longer match
 * hides the shorter ones inside it ("actifed expectorant" over "actifed"), a brand hides an ingredient
 * of the same name, and cards come in the order the names appear. At most `max` cards.
 */
export async function medicationCardsFor(
  db: Database,
  text: string,
  max: number,
): Promise<MedicationCard[]> {
  if (max <= 0) return [];
  const grams = medicationNgrams(text);
  if (grams.length === 0) return [];
  const list = sql.join(
    grams.map((gram) => sql`${gram}::text`),
    sql`, `,
  );

  const [brands, brandIngredients, ingredients] = await Promise.all([
    db.execute<AggregateRow>(sql`
      select d.brand_key as key, null::text as title,
        array_agg(distinct d.strength_text) filter (where d.strength_text is not null) as strengths,
        array_agg(distinct d.form) filter (where d.form is not null) as forms,
        min(d.category) as category,
        min(d.price_minor)::int as price_min, max(d.price_minor)::int as price_max,
        min(d.currency) as currency
      from drugs d
      where d.status = 'active' and d.brand_key in (${list})
      group by d.brand_key
    `),
    db.execute<{ key: string; name: string }>(sql`
      select d.brand_key as key, i.name_en as name
      from drugs d
      join drug_ingredients di on di.drug_id = d.id
      join active_ingredients i on i.id = di.ingredient_id
      where d.status = 'active' and d.brand_key in (${list})
      group by d.brand_key, i.name_en
      order by d.brand_key, count(*) desc, i.name_en
    `),
    db.execute<AggregateRow>(sql`
      select i.normalized as key, i.name_en as title,
        array_agg(distinct di.strength_text) filter (where di.strength_text is not null) as strengths,
        array_agg(distinct d.form) filter (where d.form is not null) as forms,
        min(d.category) as category,
        min(d.price_minor)::int as price_min, max(d.price_minor)::int as price_max,
        min(d.currency) as currency
      from active_ingredients i
      join drug_ingredients di on di.ingredient_id = i.id
      join drugs d on d.id = di.drug_id and d.status = 'active'
      where i.normalized in (${list})
      group by i.id, i.normalized, i.name_en
    `),
  ]);

  const namesByKey = new Map<string, string[]>();
  for (const row of brandIngredients) {
    const names = namesByKey.get(row.key) ?? [];
    if (names.length < CARD_MAX_INGREDIENTS) names.push(row.name);
    namesByKey.set(row.key, names);
  }
  const cardOf = (row: AggregateRow, kind: MedicationCard["kind"]): MedicationCard => ({
    kind,
    title: row.title ?? titleCase(row.key),
    ingredients: kind === "brand" ? (namesByKey.get(row.key) ?? []) : [row.title ?? row.key],
    strengths: firstOf(row.strengths, CARD_MAX_STRENGTHS),
    forms: firstOf(row.forms, CARD_MAX_FORMS),
    category: row.category,
    priceMinMinor: row.price_min,
    priceMaxMinor: row.price_max,
    currency: row.currency ?? "EGP",
  });

  const brandKeys = new Set(Array.from(brands, (row) => row.key));
  const found = [
    ...Array.from(brands, (row) => ({ key: row.key, card: cardOf(row, "brand") })),
    // A brand named like an ingredient is the brand.
    ...Array.from(ingredients)
      .filter((row) => !brandKeys.has(row.key))
      .map((row) => ({ key: row.key, card: cardOf(row, "ingredient") })),
  ];
  return found
    .filter((a) => !found.some((b) => b.key !== a.key && ` ${b.key} `.includes(` ${a.key} `)))
    .sort((a, b) => grams.indexOf(a.key) - grams.indexOf(b.key))
    .slice(0, max)
    .map((entry) => entry.card);
}
