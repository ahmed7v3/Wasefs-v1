import { matchDrug, type Database } from "@wasfa/db";
import { classifyMatch, type DrugMatchCandidate, type DrugMatchClass } from "@wasfa/shared/drugs";
import { parseStrength } from "@wasfa/shared/normalize";
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

type ExtractedItem = RxExtraction["items"][number];
type Verified = RxResultItem["verified"];

/** A line while the pipeline works on it (never stored: `buildResult` turns it into a result item). */
export interface WorkItem {
  extracted: ExtractedItem;
  candidates: DrugMatchCandidate[];
  matchClass: DrugMatchClass;
  /** The drug the line is matched to: accepted by the matcher, or chosen in verification. */
  chosen: DrugMatchCandidate | null;
  flagged: boolean;
  verified: Verified;
  /** Ceiling the verification outcome puts on the confidence. */
  verifyCeiling: number | undefined;
  /** Text the verification read instead of the first reading. */
  nameOverride: string | null;
}

export interface MatchOutcome {
  candidates: DrugMatchCandidate[];
  matchClass: DrugMatchClass;
}

/** `value.slice` on code points, so a trim never splits a surrogate pair. */
const clamp = (value: string | null, max: number): string | null => {
  if (value === null) return null;
  const text = value.trim();
  return text === "" ? null : Array.from(text).slice(0, max).join("");
};

/**
 * Matches one line: the model's `name` first, the raw line when the name is missing or finds
 * nothing. The strength and form the doctor wrote narrow the candidates (the matcher scores them).
 */
export async function matchLine(
  db: Database,
  line: Pick<ExtractedItem, "name" | "rawText" | "strength" | "form">,
  nameOverride: string | null = null,
): Promise<MatchOutcome> {
  const options = {
    strength: line.strength === null ? null : parseStrength(line.strength),
    form: line.form,
  };
  const primary = nameOverride ?? line.name ?? line.rawText;
  let candidates = primary.trim() === "" ? [] : await matchDrug(db, primary, options);
  let matchClass = classifyMatch(candidates[0]);
  const raw = line.rawText.trim();
  if (matchClass === "unmatched" && nameOverride === null && raw !== "" && raw !== primary.trim()) {
    const fromRaw = await matchDrug(db, raw, options);
    if ((fromRaw[0]?.score ?? 0) > (candidates[0]?.score ?? 0)) {
      candidates = fromRaw;
      matchClass = classifyMatch(fromRaw[0]);
    }
  }
  return { candidates, matchClass };
}

/** Step 2: match every line and normalize dose, frequency and duration. Flagging is decided here. */
export async function matchItems(db: Database, extraction: RxExtraction): Promise<WorkItem[]> {
  const items: WorkItem[] = [];
  for (const extracted of extraction.items) {
    const { candidates, matchClass } = await matchLine(db, extracted);
    const top = candidates[0];
    items.push({
      extracted: {
        ...extracted,
        dose: normalizeDose(extracted.dose),
        frequency: normalizeFrequency(extracted.frequency),
        duration: normalizeDuration(extracted.duration),
      },
      candidates,
      matchClass,
      chosen: matchClass === "accept" && top !== undefined ? top : null,
      flagged:
        extracted.confidence < RX_FLAG_CONFIDENCE ||
        matchClass === "verify" ||
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
 * is treated as unreadable. A line without an answer stays "skipped". First answer per line wins.
 */
export async function applyVerification(
  db: Database,
  items: WorkItem[],
  offered: ReadonlyMap<number, readonly DrugMatchCandidate[]>,
  answers: RxVerifyAnswer,
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
        item.verified = same ? "confirmed" : "corrected";
        item.verifyCeiling = RX_VERIFY_CONFIDENCE.candidate;
        continue;
      }
      // An id nobody offered: the model made it up, so the reading is not trusted at all.
    } else if (answer.kind === "other") {
      const text = clamp(answer.text, 200);
      if (text !== null) {
        const outcome = await matchLine(db, item.extracted, text);
        item.nameOverride = text;
        item.candidates = outcome.candidates;
        item.matchClass = outcome.matchClass;
        item.chosen = outcome.matchClass === "accept" ? (outcome.candidates[0] ?? null) : null;
        item.verified = "corrected";
        item.verifyCeiling = RX_VERIFY_CONFIDENCE.other;
        continue;
      }
    }
    item.chosen = null;
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
    return {
      rawText: Array.from(extracted.rawText).slice(0, 300).join(""),
      name:
        chosen === null
          ? clamp(item.nameOverride ?? extracted.name, 200)
          : clamp(chosen.brandEn, 200),
      matchedDrugId: chosen?.drugId ?? null,
      matchScore: chosen?.score ?? null,
      activeIngredients:
        chosen === null
          ? generic === null
            ? []
            : [generic]
          : [...(ingredients.get(chosen.drugId) ?? [])].slice(0, 10),
      strength: clamp(extracted.strength, 200),
      form: clamp(extracted.form, 200),
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
