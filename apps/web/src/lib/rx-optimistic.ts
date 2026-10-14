import { RX_UNMATCHED_CONFIDENCE_CAP, confidenceBadge } from "@wasfa/shared/rx-result";

import type { RxResultItem } from "@wasfa/shared/schemas/rx";

/** What the person chose in the picker: a candidate drug, or typed text. */
export type RxPick =
  { kind: "candidate"; drugId: string; name: string } | { kind: "text"; text: string };

/**
 * The line as the API will return it after `POST /rx/:id/corrections` with `field = drug`, computed
 * in the browser so the row changes the moment the person taps (the same rules as the API's
 * `applyCorrection`: a picked drug is the person's own decision, typed text is an unmatched name
 * capped below "high"). The response replaces it; ingredients are filled in by that response.
 */
export function optimisticDrugCorrection(item: RxResultItem, pick: RxPick): RxResultItem {
  if (pick.kind === "candidate") {
    return {
      ...item,
      name: pick.name,
      matchedDrugId: pick.drugId,
      matchScore: 1,
      activeIngredients: [],
      confidence: 1,
      badge: "high",
      verified: "corrected",
    };
  }
  const confidence = Math.min(item.confidence, RX_UNMATCHED_CONFIDENCE_CAP);
  return {
    ...item,
    name: pick.text,
    matchedDrugId: null,
    matchScore: null,
    activeIngredients: [],
    confidence,
    badge: confidenceBadge(confidence),
    verified: "corrected",
  };
}
