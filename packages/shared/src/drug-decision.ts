import type { DrugMatchCandidate } from "./drugs.js";
import type { RxLegibility } from "./rx.js";
import type { MedicationSettings } from "./settings.js";

/*
 * The one place a recognition decision is made (docs/MEDICATIONS.md section 4.3): pure, driven by the
 * `medications` settings, shared by the worker (prescriptions) and any caller asking "what drug is
 * this text". Retrieval and scoring happen in SQL; this only weighs the evidence.
 */

/** Where a candidate came from: the primary reading, an alternative reading, or the raw line. */
export type MatchVia = "primary" | "alternative" | "raw";

export interface RankedCandidate extends DrugMatchCandidate {
  via: MatchVia;
}

export interface DecisionInput {
  candidates: RankedCandidate[];
  legibility: RxLegibility;
  /** The prescription wrote a strength for this line (it then picks among same-brand variants). */
  strengthWritten: boolean;
}

export const DECISION_REASONS = [
  "accepted",
  "no_candidates",
  "below_review",
  "below_accept",
  "strength_conflict",
  "ingredient_only",
  "via_alternative",
  "unclear_handwriting",
  "ambiguous_family",
  "alias_exact",
] as const;
export type DecisionReason = (typeof DECISION_REASONS)[number];

export interface Decision {
  matchClass: "accept" | "verify" | "unmatched";
  /** The accepted candidate; `null` for `verify` and `unmatched` (verification chooses later). */
  chosen: RankedCandidate | null;
  /**
   * Accepted by brand only: several strengths of the family exist and the prescription named none, so
   * finalize takes brand, ingredients and form from the database but not strength or pack.
   */
  familyOnly: boolean;
  reason: DecisionReason;
}

export type DecisionSettings = Pick<
  MedicationSettings,
  "acceptScore" | "reviewScore" | "minMargin"
>;

const decision = (
  matchClass: Decision["matchClass"],
  reason: DecisionReason,
  chosen: RankedCandidate | null = null,
  familyOnly = false,
): Decision => ({ matchClass, chosen, familyOnly, reason });

export function decideMatch(input: DecisionInput, settings: DecisionSettings): Decision {
  const ranked = [...input.candidates].sort((a, b) => b.score - a.score);
  const top = ranked[0];
  if (top === undefined) return decision("unmatched", "no_candidates");
  if (top.score < settings.reviewScore) return decision("unmatched", "below_review");

  // An exact learned / admin alias is a statement of fact: only a written strength it contradicts stops it.
  if (top.explanation.matchedOn === "alias_exact" && top.explanation.strength !== "conflict") {
    return decision("accept", "alias_exact", top);
  }

  // Variants of one brand family (strengths, packs) are not competitors; an empty key is no family.
  const inFamily = (candidate: RankedCandidate): boolean =>
    candidate.drugId === top.drugId || (top.brandKey !== "" && candidate.brandKey === top.brandKey);
  const rival = ranked.find((candidate) => !inFamily(candidate));
  const margin = top.score - (rival?.score ?? 0);

  let reason: DecisionReason | null = null;
  if (top.score < settings.acceptScore) reason = "below_accept";
  else if (top.explanation.strength === "conflict") reason = "strength_conflict";
  else if (top.explanation.matchedOn === "ingredient") reason = "ingredient_only";
  else if (top.via !== "primary") reason = "via_alternative";
  else if (input.legibility === "unclear") reason = "unclear_handwriting";
  else if (margin < settings.minMargin) reason = "ambiguous_family";
  if (reason !== null) return decision("verify", reason);

  // Nothing written separates the strengths of the family: the brand is right, the product is not known.
  const family = ranked.filter(inFamily);
  const strengths = new Set(family.map((candidate) => candidate.strengthText ?? ""));
  const familyOnly = !input.strengthWritten && family.length > 1 && strengths.size > 1;
  return decision("accept", "accepted", top, familyOnly);
}
