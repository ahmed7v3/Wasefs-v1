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
 * Drug name matching (Task 2.7). One SQL statement finds every drug whose brand (English or
 * Arabic), alias or active ingredient is trigram-similar to the text, keeps the best name per
 * drug, adds the strength / form adjustments and returns the top few. It lives in this package so
 * the API (admin search) and the worker (prescription pipeline) run the very same query.
 *
 * The `%` operator is what lets the GIN trigram indexes work, and it compares against the session's
 * `pg_trgm.similarity_threshold`, so each match runs in a short transaction with `SET LOCAL`.
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
  strength_state: DrugStrengthState;
  form_state: DrugFormState;
};

const ARABIC_LETTER = /[؀-ۿݐ-ݿ]/;

/** A trailing bare number ("Panadol 500") is probably a strength without its unit. */
const BARE_NUMBER = /^\d{1,5}(?:\.\d+)?$/;

interface Prepared {
  name: string;
  /** `value x 10^6`; `null` when no strength is known. */
  micro: number | null;
  /** `null` with a `micro` means the number had no unit: match on the value only, never conflict. */
  unit: string | null;
  form: string | null;
}

export function prepareMatch(text: string, options: MatchDrugOptions): Prepared {
  const parsed = normalizeDrugName(text);
  let name = parsed.name;
  const strength: Strength | null = options.strength ?? parsed.strength;
  let bareValue: number | null = null;
  if (strength === null) {
    const tokens = name.split(" ");
    const last = tokens.at(-1) ?? "";
    if (tokens.length > 1 && BARE_NUMBER.test(last)) {
      bareValue = Number(last);
      name = tokens.slice(0, -1).join(" ");
    }
  }
  let form: string | null = parsed.form;
  if (options.form !== undefined && options.form !== null && options.form.trim() !== "") {
    // The caller's word may be "Tablets" or "اقراص": the normalizer knows both.
    form = normalizeDrugName(options.form).form ?? options.form.trim().toLowerCase();
  }
  if (strength === null && bareValue !== null) {
    return { name, micro: strengthMicro(bareValue), unit: null, form };
  }
  return {
    name,
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
  const { name, micro, unit, form } = prepared;
  const floor = clamp01(options.similarityFloor ?? DRUG_SIMILARITY_THRESHOLD);
  const strengthBonus = clamp01(options.strengthBonus ?? DRUG_STRENGTH_BONUS);
  const strengthPenalty = clamp01(
    options.strengthConflictPenalty ?? DRUG_STRENGTH_CONFLICT_PENALTY,
  );
  const formBonus = clamp01(options.formBonus ?? DRUG_FORM_BONUS);

  // Latin text shares no trigram with an Arabic name: skip scanning that index for it.
  const arabicBrands = ARABIC_LETTER.test(name)
    ? sql`union all
        select d.id, similarity(d.normalized_ar, ${name}::text), 'brand'
        from drugs d
        where d.normalized_ar % ${name}::text`
    : sql``;

  const rows = await db.transaction(async (tx) => {
    // SET LOCAL takes no parameters; the value is a finite number clamped to 0-1 above, never raw input.
    await tx.execute(sql.raw(`set local pg_trgm.similarity_threshold = ${floor}`));
    return await tx.execute<MatchRow>(sql`
      with hits as (
        select d.id as drug_id, similarity(d.normalized_en, ${name}::text) as s, 'brand' as src
        from drugs d
        where d.normalized_en % ${name}::text
        ${arabicBrands}
        union all
        select a.drug_id, 1::float4, 'alias_exact'
        from drug_aliases a
        where a.normalized = ${name}::text and a.source in ('learned', 'admin')
        union all
        select a.drug_id, similarity(a.normalized, ${name}::text), 'alias'
        from drug_aliases a
        where a.normalized % ${name}::text
        union all
        select di.drug_id, similarity(i.normalized, ${name}::text), 'ingredient'
        from active_ingredients i
        join drug_ingredients di on di.ingredient_id = i.id
        where i.normalized % ${name}::text
      ),
      best as (
        select distinct on (drug_id) drug_id, s, src
        from hits
        order by drug_id, s desc,
          (case src when 'alias_exact' then 0 when 'brand' then 1 when 'alias' then 2 else 3 end)
      ),
      judged as (
        select
          d.id, d.brand_en, d.brand_ar, d.brand_key, d.form, d.strength_text, d.manufacturer, d.status,
          b.s, b.src,
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
        src as matched_on, strength_state, form_state
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
    explanation: {
      nameScore: round4(row.name_score),
      matchedOn: row.matched_on,
      strength: row.strength_state,
      form: row.form_state,
    },
  }));
}
