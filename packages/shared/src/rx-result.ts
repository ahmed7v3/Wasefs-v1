/*
 * Deterministic rules that turn a reading into a trustworthy result (Phase 2, Task 2.8,
 * Decision 8). The worker applies them when it finalizes an analysis and the API re-applies the
 * affected ones when a user corrects a line, so both sides decide the same way.
 */
import { normalizeArabic } from "./normalize.js";
import { RX_BADGE_HIGH, RX_BADGE_MEDIUM } from "./schemas/rx.js";

import type { RxConfidenceBadge, RxResult, RxResultItem } from "./schemas/rx.js";

/** Below this the reading itself is doubtful and the line goes to the verification pass. */
export const RX_FLAG_CONFIDENCE = 0.8;
/** An unmatched name can never be `high`: the cap sits just under the `high` threshold. */
export const RX_UNMATCHED_CONFIDENCE_CAP = 0.84;
/** Confidence ceilings per verification outcome (verification can only lower trust, never raise it). */
export const RX_VERIFY_CONFIDENCE = {
  /** The re-read agrees with, or picks, one of the offered drugs. */
  candidate: 0.9,
  /** The re-read produced free text that is not one of the offered drugs. */
  other: 0.6,
  unreadable: 0.3,
  /** Flagged, but not re-read (over the cap, or the model gave no usable answer). */
  skipped: RX_UNMATCHED_CONFIDENCE_CAP,
} as const;

/**
 * A verification pick of a database candidate is `likely` when the model is at least this sure;
 * below it the line stays the model's reading (`ai`) and the candidate is only offered first.
 */
export const RX_LIKELY_CONFIDENCE = 0.75;

/**
 * What a verification candidate answer means for the line: `likely` (shown with the database name and
 * the "مرجّح" badge) or `suggestion` (the line stays `ai`, the candidate is offered first). Pure.
 */
export function verifiedCandidateOutcome(confidence: number): "likely" | "suggestion" {
  return confidence >= RX_LIKELY_CONFIDENCE ? "likely" : "suggestion";
}

export function confidenceBadge(confidence: number): RxConfidenceBadge {
  if (confidence >= RX_BADGE_HIGH) return "high";
  return confidence >= RX_BADGE_MEDIUM ? "medium" : "low";
}

export interface ConfidenceInput {
  /** The model's own confidence in the reading, 0-1. */
  model: number;
  /** The matcher's score of the accepted drug, or `null` when the name is not matched. */
  match: number | null;
  /** Ceiling from the verification outcome, if the line went through one. */
  verify?: number | undefined;
  /** No drug database in play (rx.drugMatching off): the model's confidence stands on its own. */
  modelOnly?: boolean | undefined;
}

/**
 * min(model, match, verify). An unmatched name has no match score; it is capped at
 * `RX_UNMATCHED_CONFIDENCE_CAP` instead, so it is never shown as high confidence.
 */
export function finalConfidence({ model, match, verify, modelOnly }: ConfidenceInput): number {
  const parts = modelOnly === true ? [model] : [model, match ?? RX_UNMATCHED_CONFIDENCE_CAP];
  if (verify !== undefined) parts.push(verify);
  return Math.round(Math.min(...parts) * 10_000) / 10_000;
}

type Finding = RxResult["findings"][number];

const ingredientKey = (name: string): string => normalizeArabic(name).toLowerCase();

/**
 * Two or more different lines that share an active ingredient (the same medicine written twice,
 * or two brands of it): the pharmacist should look. Only lines matched to a drug carry ingredients.
 */
export function duplicateIngredientFindings(
  items: readonly Pick<RxResultItem, "activeIngredients">[],
): Finding[] {
  const byIngredient = new Map<string, { label: string; lines: Set<number> }>();
  items.forEach((item, index) => {
    for (const name of item.activeIngredients) {
      const key = ingredientKey(name);
      if (key === "") continue;
      const entry = byIngredient.get(key) ?? { label: name, lines: new Set<number>() };
      entry.lines.add(index);
      byIngredient.set(key, entry);
    }
  });
  return [...byIngredient.values()]
    .filter((entry) => entry.lines.size >= 2)
    .map((entry) => ({
      kind: "duplicate_ingredient" as const,
      itemIndexes: [...entry.lines].sort((a, b) => a - b),
      ingredient: entry.label.slice(0, 120),
    }));
}
