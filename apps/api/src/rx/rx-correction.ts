import {
  RX_UNMATCHED_CONFIDENCE_CAP,
  confidenceBadge,
  duplicateIngredientFindings,
} from "@wasfa/shared/rx-result";

import type { RxField } from "@wasfa/shared/rx";
import type { RxResult, RxResultItem } from "@wasfa/shared/schemas/rx";

/** A drug the user picked from the candidates. */
export interface PickedDrug {
  id: string;
  brandEn: string;
  ingredients: readonly string[];
}

export interface AppliedCorrection {
  result: RxResult;
  /** The value shown before the fix, as text (stored in `rx_corrections.before`). */
  before: string | null;
}

type TextField = Exclude<RxField, "drug" | "ingredient">;

const clamp = (text: string): string => Array.from(text.trim()).slice(0, 200).join("");

/** What the item showed for `field` before the fix. */
export function currentValue(item: RxResultItem, field: RxField): string | null {
  switch (field) {
    case "drug":
      return item.name;
    case "ingredient":
      return item.activeIngredients.length === 0 ? null : item.activeIngredients.join(", ");
    default:
      return item[field];
  }
}

/**
 * Applies one user fix to a stored result and re-derives what depends on it. Pure.
 *
 * A picked drug is the user's own decision, so the line becomes matched with the highest confidence;
 * free text is an unmatched name and stays capped below "high" (Decision 8), except when the model
 * read on its own (no database to match against): then the person's own typing is the confirmation
 * and the line is `high`. A new name makes the line's details stale, so they are dropped. Findings are
 * recomputed for the duplicate-ingredient rule; a strength warning about the line is dropped when the
 * drug or the strength was just changed. Returns `null` when the line does not exist.
 */
export function applyCorrection(
  result: RxResult,
  correction: { itemIndex: number; field: RxField; after: string },
  drug: PickedDrug | null,
): AppliedCorrection | null {
  const { itemIndex, field } = correction;
  const current = result.items[itemIndex];
  if (current === undefined) return null;
  const after = clamp(correction.after);
  const before = currentValue(current, field);

  let next: RxResultItem = { ...current, verified: "corrected" };
  if (field === "drug") {
    if (drug === null) {
      const modelOnly = result.matching === "model";
      const confidence = modelOnly ? 1 : Math.min(current.confidence, RX_UNMATCHED_CONFIDENCE_CAP);
      next = {
        ...next,
        name: after,
        source: "ai",
        matchedDrugId: null,
        matchScore: null,
        activeIngredients: [],
        details: null,
        confidence,
        badge: confidenceBadge(confidence),
      };
    } else {
      next = {
        ...next,
        name: clamp(drug.brandEn),
        source: "database",
        matchedDrugId: drug.id,
        matchScore: 1,
        details: null,
        activeIngredients: drug.ingredients.slice(0, 10).map((name) => name.slice(0, 120)),
        confidence: 1,
        badge: "high",
      };
    }
  } else if (field === "ingredient") {
    next = { ...next, activeIngredients: [after.slice(0, 120)] };
  } else {
    next = { ...next, [field satisfies TextField]: after };
  }

  const items = result.items.map((item, index) => (index === itemIndex ? next : item));
  const keepsStrengthWarning = field !== "drug" && field !== "strength";
  const strengthFindings = result.findings.filter(
    (finding) =>
      finding.kind === "strength_unknown" &&
      (keepsStrengthWarning || !finding.itemIndexes.includes(itemIndex)),
  );
  return {
    result: {
      ...result,
      items,
      findings: [...duplicateIngredientFindings(items), ...strengthFindings],
    },
    before,
  };
}
