import { cleanDrugQuery } from "@wasfa/shared/drug-query";
import { arabicToLatinCandidates } from "@wasfa/shared/drug-translit";
import {
  DRUG_FORM_BONUS,
  DRUG_MATCH_LIMIT,
  DRUG_SIMILARITY_THRESHOLD,
  DRUG_STRENGTH_BONUS,
  DRUG_STRENGTH_CONFLICT_PENALTY,
  type DrugFormState,
  type DrugMatchCandidate,
  type DrugMatchedOn,
  type DrugStrengthState,
} from "@wasfa/shared/drugs";
import { normalizeDrugName, strengthMicro, type Strength } from "@wasfa/shared/normalize";
import { sql } from "drizzle-orm";

import type { Database } from "./client.js";

/*
 * Drug name matching (Task 2.7). The text is cleaned first (`cleanDrugQuery`: bullets, "x -", Arabic
 * directions and doses go), then one SQL statement finds every drug whose brand family, product name,
 * Arabic brand, alias or active ingredient is trigram-similar to it, keeps the best name per drug, adds
 * the strength / form adjustments and returns the top few. It lives in this package so the API (admin
 * search) and the worker (prescription pipeline) run the very same query.
 *
 * The brand name score is the best of: trigram similarity to `brand_key` (the family, "riopan"), word
 * similarity to the product name (a short handwritten brand inside a long product name, discounted by
 * how little of the name the text covers) and the whole-name similarity. A name written in Arabic
 * script is also tried through its likely Latin spellings; a drug only such a spelling found is marked
 * `transliterated`, and the decision never auto-accepts it.
 *
 * The `%` and `<%` operators are what lets the GIN trigram indexes work, and they compare against the
 * session's `pg_trgm` thresholds, so each match runs in a short transaction with `SET LOCAL`.
 */

export interface MatchDrugOptions {
  /** Strength found next to the name (already parsed). */
  strength?: Strength | null;
  /** Dosage form found next to the name, in any spelling the normalizer knows. */
  form?: string | null;
  /** Candidates to return; default 5. */
  limit?: number;
  /** Trigram floor for a candidate; default `DRUG_SIMILARITY_THRESHOLD`. The `medications` settings override it. */
  similarityFloor?: number;
  /** Score adjustments; default to the constants in `@wasfa/shared/drugs`. */
  strengthBonus?: number;
  strengthConflictPenalty?: number;
  formBonus?: number;
}

type MatchRow = {
  drug_id: string;
  brand_en: string;
  brand_ar: string | null;
  brand_key: string;
  form: string | null;
  strength_text: string | null;
  manufacturer: string | null;
  status: "active" | "withdrawn";
  name_score: number;
  score: number;
  matched_on: DrugMatchedOn;
  transliterated: boolean;
  strength_state: DrugStrengthState;
  form_state: DrugFormState;
};

const ARABIC_LETTER = /[؀-ۿݐ-ݿ]/;

interface Prepared {
  /** The text to look up: the cleaned Latin brand, else the Arabic name, else the normalized text. */
  name: string;
  /** Likely Latin spellings of an Arabic-script name (at most 4). */
  spellings: string[];
  /** `value x 10^6`; `null` when no strength is known. */
  micro: number | null;
  /** `null` with a `micro` means the number had no unit: match on the value only, never conflict. */
  unit: string | null;
  form: string | null;
}

export function prepareMatch(text: string, options: MatchDrugOptions): Prepared {
  const cleaned = cleanDrugQuery(text);
  const name = cleaned.latin ?? cleaned.arabic ?? normalizeDrugName(text).name;
  const spellings = cleaned.latin === null ? arabicToLatinCandidates(cleaned.arabic ?? "") : [];
  const strength: Strength | null = options.strength ?? cleaned.strength;
  let form: string | null = cleaned.form;
  if (options.form !== undefined && options.form !== null && options.form.trim() !== "") {
    // The caller's word may be "Tablets" or "اقراص": the normalizer knows both.
    form = normalizeDrugName(options.form).form ?? options.form.trim().toLowerCase();
  }
  if (strength === null && cleaned.bareNumber !== null) {
    // "Panadol 500" is probably a strength without its unit: match on the value only.
    return { name, spellings, micro: strengthMicro(cleaned.bareNumber), unit: null, form };
  }
  return {
    name,
    spellings,
    micro: strength === null ? null : strengthMicro(strength.value),
    unit: strength?.unit ?? null,
    form,
  };
}

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

/**
 * The best candidates for a name as printed on a prescription, a box or a list.
 * Score = name similarity, +0.10 for an equal strength, -0.15 for a conflicting one (a strength was
 * given and the drug has strengths, none equal), +0.05 for the same form, clamped to 0-1 (the numbers
 * are the defaults of `options`). A text equal to a learned or admin alias is an `alias_exact` hit with
 * name score 1.
 */
export async function matchDrug(
  db: Database,
  text: string,
  options: MatchDrugOptions = {},
): Promise<DrugMatchCandidate[]> {
  const prepared = prepareMatch(text, options);
  if (prepared.name === "") return [];
  const limit = Math.max(1, Math.min(options.limit ?? DRUG_MATCH_LIMIT, 100));
  const { name, spellings, micro, unit, form } = prepared;
  const floor = clamp01(options.similarityFloor ?? DRUG_SIMILARITY_THRESHOLD);
  const strengthBonus = clamp01(options.strengthBonus ?? DRUG_STRENGTH_BONUS);
  const strengthPenalty = clamp01(
    options.strengthConflictPenalty ?? DRUG_STRENGTH_CONFLICT_PENALTY,
  );
  const formBonus = clamp01(options.formBonus ?? DRUG_FORM_BONUS);

  // Latin text shares no trigram with an Arabic name: scan that index only for Arabic text.
  const isArabic = ARABIC_LETTER.test(name);
  const arabicBrands = isArabic
    ? sql`union all
        select d.id, similarity(d.normalized_ar, ${name}::text), 'brand', false
        from drugs d
        where d.normalized_ar % ${name}::text`
    : sql``;

  // The texts the brand columns are searched with: the name and, for an Arabic-script name, its Latin
  // spellings. Each is three index-friendly lookups; the score is computed once, below.
  const lookups = [
    ...(isArabic ? [] : [{ text: name, guessed: false }]),
    ...spellings.map((spelling) => ({ text: spelling, guessed: true })),
  ];
  const brandCandidates =
    lookups.length === 0
      ? sql`select null::uuid as drug_id, null::text as t, null::boolean as guessed where false`
      : sql.join(
          lookups.map(
            ({ text: lookup, guessed }) => sql`
          select d.id as drug_id, ${lookup}::text as t, ${guessed}::boolean as guessed
          from drugs d where d.brand_key % ${lookup}::text
          union
          select d.id, ${lookup}::text, ${guessed}::boolean
          from drugs d where d.normalized_en % ${lookup}::text
          union
          select d.id, ${lookup}::text, ${guessed}::boolean
          from drugs d where ${lookup}::text <% d.normalized_en`,
          ),
          sql` union `,
        );

  const rows = await db.transaction(async (tx) => {
    // SET LOCAL takes no parameters; the value is a finite number clamped to 0-1 above, never raw input.
    await tx.execute(sql.raw(`set local pg_trgm.similarity_threshold = ${floor}`));
    await tx.execute(sql.raw(`set local pg_trgm.word_similarity_threshold = ${floor}`));
    return await tx.execute<MatchRow>(sql`
      with brand_candidates as (${brandCandidates}),
      hits as (
        -- A short brand inside a long product name scores by word similarity, discounted by how little
        -- of the name the text covers, so "actifed" still ranks the plain brand above a longer family.
        select c.drug_id,
               greatest(
                 similarity(d.brand_key, c.t),
                 similarity(d.normalized_en, c.t),
                 word_similarity(c.t, d.normalized_en)
                   * power(least(1, length(c.t)::float8 / greatest(length(d.normalized_en), 1)), 0.7)
               )::float4 as s,
               'brand' as src, c.guessed
        from brand_candidates c
        join drugs d on d.id = c.drug_id
        ${arabicBrands}
        union all
        select a.drug_id, 1::float4, 'alias_exact', false
        from drug_aliases a
        where a.normalized = ${name}::text and a.source in ('learned', 'admin')
        union all
        select a.drug_id, similarity(a.normalized, ${name}::text), 'alias', false
        from drug_aliases a
        where a.normalized % ${name}::text
        union all
        select di.drug_id, similarity(i.normalized, ${name}::text), 'ingredient', false
        from active_ingredients i
        join drug_ingredients di on di.ingredient_id = i.id
        where i.normalized % ${name}::text
      ),
      best as (
        select distinct on (drug_id) drug_id, s, src, guessed
        from hits
        order by drug_id, s desc,
          (case src when 'alias_exact' then 0 when 'brand' then 1 when 'alias' then 2 else 3 end),
          guessed
      ),
      judged as (
        select
          d.id, d.brand_en, d.brand_ar, d.brand_key, d.form, d.strength_text, d.manufacturer, d.status,
          b.s, b.src, b.guessed,
          case
            when ${micro}::bigint is null then 'unknown'
            when (d.strength_value_micro = ${micro}::bigint
                  and (${unit}::text is null or d.strength_unit = ${unit}::text))
              or exists (
                select 1 from drug_ingredients di
                where di.drug_id = d.id
                  and di.strength_value_micro = ${micro}::bigint
                  and (${unit}::text is null or di.strength_unit = ${unit}::text)
              ) then 'match'
            when ${unit}::text is null then 'unknown'
            when d.strength_value_micro is null and not exists (
              select 1 from drug_ingredients di
              where di.drug_id = d.id and di.strength_value_micro is not null
            ) then 'unknown'
            else 'conflict'
          end as strength_state,
          case
            when ${form}::text is null or d.form is null then 'unknown'
            when d.form = ${form}::text then 'match'
            else 'mismatch'
          end as form_state
        from best b
        join drugs d on d.id = b.drug_id
      ),
      scored as (
        select
          judged.*,
          s
          + (case strength_state when 'match' then ${strengthBonus}::float8
                                 when 'conflict' then -${strengthPenalty}::float8
                                 else 0 end)
          + (case form_state when 'match' then ${formBonus}::float8 else 0 end) as raw
        from judged
      )
      select
        id as drug_id, brand_en, brand_ar, brand_key, form, strength_text, manufacturer, status,
        round(s::numeric, 4)::float8 as name_score,
        round(least(1, greatest(0, raw))::numeric, 4)::float8 as score,
        src as matched_on, guessed as transliterated, strength_state, form_state
      from scored
      -- The clamp would tie everything above 1; the raw sum still ranks a form match first.
      order by raw desc,
               (case src when 'alias_exact' then 0 when 'brand' then 1 when 'alias' then 2 else 3 end),
               brand_en, id
      limit ${limit}
    `);
  });

  return Array.from(rows, (row) => ({
    drugId: row.drug_id,
    brandEn: row.brand_en,
    brandAr: row.brand_ar,
    brandKey: row.brand_key,
    form: row.form,
    strengthText: row.strength_text,
    manufacturer: row.manufacturer,
    status: row.status,
    score: round4(row.score),
    ...(row.transliterated ? { transliterated: true } : {}),
    explanation: {
      nameScore: round4(row.name_score),
      matchedOn: row.matched_on,
      strength: row.strength_state,
      form: row.form_state,
    },
  }));
}
