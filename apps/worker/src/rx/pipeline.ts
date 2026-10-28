import { matchDrug, type Database } from "@wasfa/db";
import {
  decideMatch,
  type Decision,
  type MatchVia,
  type RankedCandidate,
} from "@wasfa/shared/drug-decision";
import { normalizeDrugName, parseStrength } from "@wasfa/shared/normalize";
import { normalizeDose, normalizeDuration, normalizeFrequency } from "@wasfa/shared/rx-normalize";
import {
  RX_FLAG_CONFIDENCE,
  RX_VERIFY_CONFIDENCE,
  confidenceBadge,
  duplicateIngredientFindings,
  finalConfidence,
} from "@wasfa/shared/rx-result";
import {
  RX_SCHEMA_VERSION,
  rxResultSchema,
  type RxDetailsAnswer,
  type RxExtraction,
  type RxResult,
  type RxResultItem,
  type RxVerifyAnswer,
} from "@wasfa/shared/schemas/rx";

import type { DrugMatchClass } from "@wasfa/shared/drugs";
import type { MedicationSettings } from "@wasfa/shared/settings";

type ExtractedItem = RxExtraction["items"][number];
type Verified = RxResultItem["verified"];

/** A line while the pipeline works on it (never stored: `buildResult` turns it into a result item). */
export interface WorkItem {
  extracted: ExtractedItem;
  candidates: RankedCandidate[];
  matchClass: DrugMatchClass;
  /** The drug the line is matched to: accepted by the decision, or chosen in verification. */
  chosen: RankedCandidate | null;
  /**
   * Matched by brand family only (no strength written, several in the family): finalize takes brand,
   * ingredients and form from the database, but the strength stays the prescription's.
   */
  familyOnly: boolean;
  flagged: boolean;
  verified: Verified;
  /** Ceiling the verification outcome puts on the confidence. */
  verifyCeiling: number | undefined;
  /** Text the verification read instead of the first reading. */
  nameOverride: string | null;
}

export interface MatchOutcome {
  candidates: RankedCandidate[];
  decision: Decision;
}

/** The part of the `medications` settings that recognition reads. */
export type RecognitionSettings = Pick<
  MedicationSettings,
  | "similarityFloor"
  | "acceptScore"
  | "reviewScore"
  | "minMargin"
  | "strengthBonus"
  | "strengthConflictPenalty"
  | "formBonus"
  | "maxCandidates"
  | "useAlternatives"
>;

/** `value.slice` on code points, so a trim never splits a surrogate pair. */
const clamp = (value: string | null, max: number): string | null => {
  if (value === null) return null;
  const text = value.trim();
  return text === "" ? null : Array.from(text).slice(0, max).join("");
};

/**
 * Matches one line. Retrieval: the model's `name` (primary) first, then, with `useAlternatives`, each
 * other reading of it and the raw line. A drug found several times keeps its best score and the `via`
 * of that hit. Without `useAlternatives` the raw line is still tried when the name finds nothing worth
 * reviewing. `decideMatch` then decides. The strength and form the doctor wrote narrow the candidates
 * (the matcher scores them). A verification re-read (`nameOverride`) is matched on its own text only.
 */
export async function matchLine(
  db: Database,
  line: Pick<
    ExtractedItem,
    "name" | "rawText" | "strength" | "form" | "alternatives" | "legibility"
  >,
  settings: RecognitionSettings,
  nameOverride: string | null = null,
): Promise<MatchOutcome> {
  const options = {
    strength: line.strength === null ? null : parseStrength(line.strength),
    form: line.form,
    limit: settings.maxCandidates,
    similarityFloor: settings.similarityFloor,
    strengthBonus: settings.strengthBonus,
    strengthConflictPenalty: settings.strengthConflictPenalty,
    formBonus: settings.formBonus,
  };
  const primary = (nameOverride ?? line.name ?? line.rawText).trim();
  const merged = new Map<string, RankedCandidate>();
  const run = async (text: string, via: MatchVia): Promise<void> => {
    if (text === "") return;
    for (const candidate of await matchDrug(db, text, options)) {
      const known = merged.get(candidate.drugId);
      if (known === undefined || candidate.score > known.score) {
        merged.set(candidate.drugId, { ...candidate, via });
      }
    }
  };

  await run(primary, "primary");
  if (nameOverride === null) {
    const seen = new Set([normalizeDrugName(primary).name]);
    if (settings.useAlternatives) {
      for (const alternative of line.alternatives) {
        const key = normalizeDrugName(alternative).name;
        if (key === "" || seen.has(key)) continue;
        seen.add(key);
        await run(alternative.trim(), "alternative");
      }
    }
    const raw = line.rawText.trim();
    const bestPrimary = Math.max(0, ...[...merged.values()].map((candidate) => candidate.score));
    if (
      raw !== "" &&
      raw !== primary &&
      (settings.useAlternatives || bestPrimary < settings.reviewScore)
    ) {
      await run(raw, "raw");
    }
  }

  const candidates = [...merged.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, settings.maxCandidates);
  const decision = decideMatch(
    {
      candidates,
      // A re-read of the crop is a second look, not a clear one.
      legibility: nameOverride === null ? line.legibility : "partial",
      strengthWritten: (line.strength ?? "").trim() !== "",
    },
    settings,
  );
  return { candidates, decision };
}

/** Step 2: match every line and normalize dose, frequency and duration. Flagging is decided here. */
export async function matchItems(
  db: Database,
  extraction: RxExtraction,
  settings: RecognitionSettings,
): Promise<WorkItem[]> {
  const items: WorkItem[] = [];
  for (const extracted of extraction.items) {
    const { candidates, decision } = await matchLine(db, extracted, settings);
    const top = candidates[0];
    items.push({
      extracted: {
        ...extracted,
        dose: normalizeDose(extracted.dose),
        frequency: normalizeFrequency(extracted.frequency),
        duration: normalizeDuration(extracted.duration),
      },
      candidates,
      matchClass: decision.matchClass,
      chosen: decision.chosen,
      familyOnly: decision.familyOnly,
      flagged:
        extracted.confidence < RX_FLAG_CONFIDENCE ||
        decision.matchClass === "verify" ||
        extracted.legibility === "unclear" ||
        top?.explanation.strength === "conflict",
      verified: "not_needed",
      verifyCeiling: undefined,
      nameOverride: null,
    });
  }
  return items;
}

/**
 * Step 2 without the drug database: no matching, only the dictionary for dose, frequency and
 * duration. A line the model is unsure of is still flagged, but nothing re-reads it (there is no
 * candidate list to choose from); its lower confidence is what the person sees.
 */
export function modelItems(extraction: RxExtraction): WorkItem[] {
  return extraction.items.map((extracted) => ({
    extracted: {
      ...extracted,
      dose: normalizeDose(extracted.dose),
      frequency: normalizeFrequency(extracted.frequency),
      duration: normalizeDuration(extracted.duration),
    },
    candidates: [],
    matchClass: "unmatched" as const,
    chosen: null,
    familyOnly: false,
    flagged: extracted.confidence < RX_FLAG_CONFIDENCE,
    verified: "not_needed" as const,
    verifyCeiling: undefined,
    nameOverride: null,
  }));
}

/** How urgently a flagged line needs a second look: a strength conflict, then the verify zone, then low confidence. */
export function riskOf(item: WorkItem): number {
  return (
    (item.candidates[0]?.explanation.strength === "conflict" ? 3 : 0) +
    (item.matchClass === "verify" ? 2 : 0) +
    (1 - item.extracted.confidence)
  );
}

/** The flagged lines to re-read: highest risk first, at most `max`. Ties keep the order on the paper. */
export function pickForVerification(items: readonly WorkItem[], max: number): number[] {
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.flagged)
    .sort((a, b) => riskOf(b.item) - riskOf(a.item) || a.index - b.index)
    .slice(0, Math.max(0, max))
    .map(({ index }) => index);
}

/** The flagged lines that are left alone (over the cap, no readable page or box): honest about it. */
export function markSkipped(items: WorkItem[], verifiedIndexes: ReadonlySet<number>): void {
  items.forEach((item, index) => {
    if (item.flagged && !verifiedIndexes.has(index)) {
      item.verified = "skipped";
      item.verifyCeiling = RX_VERIFY_CONFIDENCE.skipped;
    }
  });
}

/**
 * Applies the verification answers. A candidate id must be one the model was offered, else the line
 * is treated as unreadable. "none" keeps the AI reading (never the closest name). A line without an
 * answer stays "skipped". First answer per line wins.
 */
export async function applyVerification(
  db: Database,
  items: WorkItem[],
  offered: ReadonlyMap<number, readonly RankedCandidate[]>,
  answers: RxVerifyAnswer,
  settings: RecognitionSettings,
): Promise<void> {
  const seen = new Set<number>();
  for (const answer of answers.answers) {
    const item = items[answer.index];
    const options = offered.get(answer.index);
    if (item === undefined || options === undefined || seen.has(answer.index)) continue;
    seen.add(answer.index);

    if (answer.kind === "candidate") {
      const picked = options.find((candidate) => candidate.drugId === answer.id);
      if (picked !== undefined) {
        const same = picked.drugId === item.candidates[0]?.drugId;
        item.chosen = picked;
        // Several strengths of the picked family were offered and the line wrote none: the choice
        // was a brand, not a product, so the strength stays the prescription's.
        item.familyOnly =
          (item.extracted.strength ?? "").trim() === "" &&
          picked.brandKey !== "" &&
          options.some(
            (other) =>
              other.drugId !== picked.drugId &&
              other.brandKey === picked.brandKey &&
              other.strengthText !== picked.strengthText,
          );
        item.verified = same ? "confirmed" : "corrected";
        item.verifyCeiling = RX_VERIFY_CONFIDENCE.candidate;
        continue;
      }
      // An id nobody offered: the model made it up, so the reading is not trusted at all.
    } else if (answer.kind === "none") {
      item.chosen = null;
      item.familyOnly = false;
      item.matchClass = "unmatched";
      item.verified = "confirmed";
      item.verifyCeiling = RX_VERIFY_CONFIDENCE.other;
      continue;
    } else if (answer.kind === "other") {
      const text = clamp(answer.text, 200);
      if (text !== null) {
        const outcome = await matchLine(db, item.extracted, settings, text);
        item.nameOverride = text;
        item.candidates = outcome.candidates;
        item.matchClass = outcome.decision.matchClass;
        item.chosen = outcome.decision.chosen;
        item.familyOnly = outcome.decision.familyOnly;
        item.verified = "corrected";
        item.verifyCeiling = RX_VERIFY_CONFIDENCE.other;
        continue;
      }
    }
    item.chosen = null;
    item.familyOnly = false;
    item.verified = "unreadable";
    item.verifyCeiling = RX_VERIFY_CONFIDENCE.unreadable;
  }
  // Offered but unanswered lines: flagged and not re-read.
  for (const index of offered.keys()) {
    const item = items[index];
    if (item !== undefined && !seen.has(index)) {
      item.verified = "skipped";
      item.verifyCeiling = RX_VERIFY_CONFIDENCE.skipped;
    }
  }
}

/** A line the user can still read something from: not judged unreadable, and some text survived. */
export function isReadable(item: RxResultItem): boolean {
  return (
    item.verified !== "unreadable" &&
    ((item.name ?? "").trim() !== "" || item.rawText.trim() !== "")
  );
}

/**
 * Step 4: merges everything into the stored result and validates it with the shared schema. Pure.
 * `ingredients` maps a drug id to its active ingredients.
 *
 * A matched line takes brand, ingredients and form from the database, and its strength too unless the
 * match is by family only or the database strength conflicts with the one written (that stays visible,
 * with its finding, instead of being silently fixed). Dose, frequency and duration are always the
 * prescription's. An unmatched line keeps the AI reading and says so (`source: "ai"`).
 */
export function buildResult(
  extraction: RxExtraction,
  items: readonly WorkItem[],
  ingredients: ReadonlyMap<string, readonly string[]>,
  matching: "database" | "model" = "database",
): RxResult {
  const modelOnly = matching === "model";
  const resultItems = items.map((item): RxResultItem => {
    const { extracted, chosen } = item;
    const confidence = finalConfidence({
      model: extracted.confidence,
      match: chosen === null ? null : chosen.score,
      verify: item.verifyCeiling,
      modelOnly,
    });
    // The cap in finalConfidence already keeps an unmatched line below "high"; this is the seat belt.
    // Without the database every line is unmatched, so the belt does not apply.
    const rawBadge = confidenceBadge(confidence);
    const badge = !modelOnly && chosen === null && rawBadge === "high" ? "medium" : rawBadge;
    const generic = clamp(extracted.activeIngredient, 120);
    const databaseStrength =
      chosen !== null && !item.familyOnly && chosen.explanation.strength !== "conflict"
        ? clamp(chosen.strengthText, 200)
        : null;
    return {
      rawText: Array.from(extracted.rawText).slice(0, 300).join(""),
      name:
        chosen === null
          ? clamp(item.nameOverride ?? extracted.name, 200)
          : clamp(chosen.brandEn, 200),
      matchedDrugId: chosen?.drugId ?? null,
      matchScore: chosen?.score ?? null,
      source: chosen === null ? "ai" : "database",
      reading: clamp(item.nameOverride ?? extracted.name, 200),
      activeIngredients:
        chosen === null
          ? generic === null
            ? []
            : [generic]
          : [...(ingredients.get(chosen.drugId) ?? [])].slice(0, 10),
      strength: databaseStrength ?? clamp(extracted.strength, 200),
      form: (chosen === null ? null : clamp(chosen.form, 200)) ?? clamp(extracted.form, 200),
      dose: clamp(extracted.dose, 200),
      frequency: clamp(extracted.frequency, 200),
      duration: clamp(extracted.duration, 200),
      route: clamp(extracted.route, 200),
      notes: clamp(extracted.notes, 200),
      confidence,
      badge,
      verified: item.verified,
      box_2d: extracted.box_2d,
      page: extracted.page,
    };
  });

  const findings: RxResult["findings"] = duplicateIngredientFindings(resultItems);
  items.forEach((item, index) => {
    // The doctor wrote a strength that this drug does not come in: say so, never silently "fix" it.
    if (
      item.chosen?.explanation.strength === "conflict" &&
      item.extracted.strength !== null &&
      item.extracted.strength.trim() !== ""
    ) {
      findings.push({ kind: "strength_unknown", itemIndexes: [index], ingredient: null });
    }
  });

  return rxResultSchema.parse({
    schemaVersion: RX_SCHEMA_VERSION,
    items: resultItems,
    date: clamp(extraction.date, 40),
    prescriberLegible: extraction.prescriberLegible,
    findings,
    unreadableRegions: extraction.unreadableRegions,
    matching,
  });
}

/**
 * The readings to log in the unmatched-names queue (docs/MEDICATIONS.md section 4.5): lines that ended
 * unmatched and were not judged unreadable, by the name the result shows. Only the reading, nothing
 * else of the prescription. Pure.
 */
export function unmatchedReadings(
  items: readonly WorkItem[],
  result: RxResult,
): { normalized: string; sample: string }[] {
  const readings: { normalized: string; sample: string }[] = [];
  items.forEach((item, index) => {
    const name = result.items[index]?.name ?? null;
    if (item.chosen !== null || item.matchClass !== "unmatched" || name === null) return;
    if (item.verified === "unreadable") return;
    const normalized = normalizeDrugName(name).name;
    if (Array.from(normalized).length < 3) return;
    readings.push({ normalized, sample: Array.from(name).slice(0, 80).join("") });
  });
  return readings;
}

/**
 * Adds the details step's answer to a finished result. Entries for lines that do not exist are
 * dropped; a line without an entry simply has no details. Pure.
 */
export function withDetails(result: RxResult, answer: RxDetailsAnswer): RxResult {
  const byIndex = new Map(answer.items.map((entry) => [entry.index, entry] as const));
  return rxResultSchema.parse({
    ...result,
    items: result.items.map((item, index) => {
      const entry = byIndex.get(index);
      return entry === undefined
        ? item
        : {
            ...item,
            details: {
              purpose: entry.purpose,
              sideEffects: entry.sideEffects,
              precautions: entry.precautions,
            },
          };
    }),
    overview: answer.overview,
    detailsStatus: "ready",
  });
}
