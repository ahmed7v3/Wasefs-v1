import { matchDrug, shapeCandidates, type Database } from "@wasfa/db";
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
  verifiedCandidateOutcome,
} from "@wasfa/shared/rx-result";
import { displayName } from "@wasfa/shared/rx-sanitize";
import {
  RX_SCHEMA_VERSION,
  rxResultSchema,
  type RxDetailsAnswer,
  type RxExtraction,
  type RxMatchOutcome,
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
  /**
   * Chosen by the verification step with enough confidence (`likely`): shown with the database name and
   * the "مرجّح" badge. A decision accept is `confirmed`; a line with no chosen drug is `ai`.
   */
  likely: boolean;
  /** `ai` only: the candidate the verification leaned to but was not sure of; offered first on "عدّل". */
  suggestion: RankedCandidate | null;
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
  const primary = (nameOverride ?? line.name ?? displayName(line.rawText)).trim();
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

  // A re-read of the crop is a second look, not a clear one.
  const legibility = nameOverride === null ? line.legibility : "partial";
  const strengthWritten = (line.strength ?? "").trim() !== "";
  let candidates = [...merged.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, settings.maxCandidates);
  let decision = decideMatch({ candidates, legibility, strengthWritten }, settings);

  // An unclear name, or one nothing accepted, also gets the letter-shape lookup (T1): the medicines
  // whose name has the same first letters, a similar length and the same consonants. These are only
  // offered to the verification step, never accepted (`via: "shape"`).
  if (nameOverride === null && (legibility !== "clear" || decision.matchClass !== "accept")) {
    const readings = new Set([
      normalizeDrugName(primary).name,
      ...line.alternatives.map((alt) => normalizeDrugName(alt).name),
    ]);
    for (const reading of readings) {
      if (reading === "") continue;
      for (const candidate of await shapeCandidates(db, reading, {
        ...options,
        limit: WIDE_CANDIDATES,
      })) {
        const known = merged.get(candidate.drugId);
        if (known === undefined || candidate.score > known.score) {
          merged.set(candidate.drugId, { ...candidate, via: "shape" });
        }
      }
    }
    candidates = oneVariantPerFamily([...merged.values()]);
    decision = decideMatch({ candidates, legibility, strengthWritten }, settings);
  }
  return { candidates, decision };
}

/** Candidates offered for an unclear line: up to this many, one per brand family. */
export const WIDE_CANDIDATES = 8;

/**
 * One candidate per brand family, best first: the variant whose strength the prescription wrote when
 * there is one, otherwise the best score. Families without a brand key stand alone. Pure.
 */
export function oneVariantPerFamily(candidates: readonly RankedCandidate[]): RankedCandidate[] {
  const best = new Map<string, RankedCandidate>();
  for (const candidate of candidates) {
    const family = candidate.brandKey === "" ? candidate.drugId : candidate.brandKey;
    const known = best.get(family);
    if (known === undefined || rankOfVariant(candidate) > rankOfVariant(known)) {
      best.set(family, candidate);
    }
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.brandEn.localeCompare(b.brandEn))
    .slice(0, WIDE_CANDIDATES);
}

const rankOfVariant = (candidate: RankedCandidate): number =>
  (candidate.explanation.strength === "match" ? 10 : 0) + candidate.score;

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
      // A name that is not clear and that nothing accepted gets a second look: that is how a
      // handwritten name can become a `likely` database drug instead of staying the raw letters.
      flagged:
        extracted.confidence < RX_FLAG_CONFIDENCE ||
        decision.matchClass === "verify" ||
        extracted.legibility === "unclear" ||
        (decision.matchClass === "unmatched" && extracted.legibility !== "clear") ||
        top?.explanation.strength === "conflict",
      verified: "not_needed",
      verifyCeiling: undefined,
      nameOverride: null,
      likely: false,
      suggestion: null,
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
    likely: false,
    suggestion: null,
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

/** Most other medicines named in the context of one line: enough for the picture, short for the prompt. */
const CONTEXT_MEDICINES = 12;

/**
 * What the verification step may use besides the crop, with no extra model call: the other medicines on
 * the same prescription (name and active ingredient, the stomach medicine next to a PPI, say) and the
 * directions written with this line. Each entry is plain text for the prompt. Pure.
 */
export function verifyContext(items: readonly WorkItem[], index: number): string[] {
  const others = items
    .flatMap((item, i) => {
      if (i === index) return [];
      const name = (item.chosen?.brandEn ?? item.extracted.name ?? "").trim();
      if (name === "") return [];
      const ingredient = (item.extracted.activeIngredient ?? "").trim();
      return [ingredient === "" ? name : `${name} (${ingredient})`];
    })
    .slice(0, CONTEXT_MEDICINES);
  const own = items[index]?.extracted;
  const directions = own
    ? [own.dose, own.frequency, own.duration, own.notes]
        .map((part) => (part ?? "").trim())
        .filter((part) => part !== "")
        .join(" | ")
    : "";
  return [
    others.length === 0
      ? "Other medicines on this prescription: none read"
      : `Other medicines on this prescription: ${others.join("; ")}`,
    directions === ""
      ? "Directions written with this line: none read"
      : `Directions written with this line: ${directions}`,
  ];
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
        item.verified = same ? "confirmed" : "corrected";
        if (verifiedCandidateOutcome(answer.confidence) === "likely") {
          item.chosen = picked;
          item.likely = true;
          item.suggestion = null;
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
          item.verifyCeiling = Math.min(answer.confidence, RX_VERIFY_CONFIDENCE.candidate);
        } else {
          // Not sure enough: the model's reading stands and the candidate is offered first on "عدّل".
          item.chosen = null;
          item.likely = false;
          item.familyOnly = false;
          item.suggestion = picked;
          item.verifyCeiling = Math.min(answer.confidence, RX_VERIFY_CONFIDENCE.other);
        }
        continue;
      }
      // An id nobody offered: the model made it up, so the reading is not trusted at all.
    } else if (answer.kind === "none") {
      item.chosen = null;
      item.likely = false;
      item.suggestion = null;
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
        // A second look that the database accepts is `likely`, never `confirmed`: it is a re-read.
        item.likely = outcome.decision.chosen !== null;
        item.suggestion = null;
        item.verified = "corrected";
        item.verifyCeiling = RX_VERIFY_CONFIDENCE.other;
        continue;
      }
    }
    item.chosen = null;
    item.likely = false;
    item.suggestion = null;
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
    const outcome: RxMatchOutcome = chosen === null ? "ai" : item.likely ? "likely" : "confirmed";
    // Only a confirmed line takes the database strength. A `likely` line shows the prescription's
    // strength or none: a database strength of a family with several would be a guess.
    const databaseStrength =
      outcome === "confirmed" &&
      chosen !== null &&
      !item.familyOnly &&
      chosen.explanation.strength !== "conflict"
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
      match: outcome,
      suggestion:
        chosen === null && item.suggestion !== null
          ? { drugId: item.suggestion.drugId, name: item.suggestion.brandEn.slice(0, 200) }
          : null,
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
