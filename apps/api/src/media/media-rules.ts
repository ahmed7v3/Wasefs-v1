import type { MediaLicence } from "@wasfa/shared/schemas/media";

/*
 * Rights rules for a media asset's metadata (CONTENT-PLATFORM section 5). Pure, so the unit test
 * covers every licence. `own` and `licensed` need nothing here (the licence reference is optional);
 * `ai-generated` is allowed for any asset (the content gate, not the library, decides where it may
 * appear and labels it in the caption credit). A medication photo has no field: out of scope.
 */

export type MediaRuleIssue = "credit_required" | "licence_ref_required";

export interface MediaRightsState {
  licence: MediaLicence;
  credit: string | null;
  licenceRef: string | null;
}

/** Optional fields may be present-but-undefined (zod output under exactOptionalPropertyTypes). */
export type MediaRightsPatch = {
  [K in keyof MediaRightsState]?: MediaRightsState[K] | undefined;
};

const blank = (value: string | null): boolean => value === null || value.trim() === "";

/** Field names (never values) that must be filled for the licence to be credible. */
export function mediaRightsIssues(state: MediaRightsState): MediaRuleIssue[] {
  switch (state.licence) {
    case "cc-by":
      // CC BY is conditional on attribution.
      return blank(state.credit) ? ["credit_required"] : [];
    case "public-domain":
      // Where it was found to be public domain, so a reviewer can check the claim.
      return blank(state.licenceRef) ? ["licence_ref_required"] : [];
    case "own":
    case "licensed":
    case "ai-generated":
      return [];
  }
}

/** The state the asset would have after the patch (only the rights fields matter here). */
export function mergeRights(current: MediaRightsState, patch: MediaRightsPatch): MediaRightsState {
  return {
    licence: patch.licence ?? current.licence,
    credit: patch.credit === undefined ? current.credit : patch.credit,
    licenceRef: patch.licenceRef === undefined ? current.licenceRef : patch.licenceRef,
  };
}

const RIGHTS_FIELDS = ["licence", "credit", "licenceRef"] as const;

/** Rights are only re-validated when the patch touches them, so older rows never block an alt-text edit. */
export function touchesRights(patch: MediaRightsPatch): boolean {
  return RIGHTS_FIELDS.some((field) => patch[field] !== undefined);
}
