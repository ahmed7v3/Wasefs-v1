import { z } from "zod";

import { ApiRequestError } from "../api-error";

/*
 * `CONTENT_CONFLICT` (409): somebody saved a newer revision while this editor held an older
 * `lockVersion`. The details carry only ids and counters (never text); the editor fetches the newer
 * revision by id to say who changed it and to diff it against the local text.
 */

const conflictDetailsSchema = z.object({
  currentLockVersion: z.number().int().min(0),
  currentRevisionId: z.uuid().optional(),
});

export interface ConflictInfo {
  currentLockVersion: number;
  currentRevisionId: string | null;
}

/** The conflict an error describes, or null when it is some other error. */
export function conflictFromError(error: unknown): ConflictInfo | null {
  if (!(error instanceof ApiRequestError) || error.code !== "CONTENT_CONFLICT") return null;
  const parsed = conflictDetailsSchema.safeParse(error.details ?? {});
  if (!parsed.success) return { currentLockVersion: -1, currentRevisionId: null };
  return {
    currentLockVersion: parsed.data.currentLockVersion,
    currentRevisionId: parsed.data.currentRevisionId ?? null,
  };
}

export type ConflictChoice = "diff" | "overwrite" | "copy" | "reload";

/**
 * What each choice does to the editor, as data so it is testable without the dialog:
 * - `overwrite`: retry the same PATCH with the server's lock version (creates a new revision on top);
 *   impossible when the details did not carry a usable lock version (the editor reloads instead).
 * - `copy`: nothing is lost either way; the text goes to the clipboard and the local mirror stays.
 * - `reload`: the draft is replaced by the server copy.
 */
export function resolveConflict(
  choice: ConflictChoice,
  conflict: ConflictInfo,
): { retryWithLockVersion: number | null; replaceDraft: boolean; keepMirror: boolean } {
  switch (choice) {
    case "overwrite":
      return conflict.currentLockVersion >= 0
        ? {
            retryWithLockVersion: conflict.currentLockVersion,
            replaceDraft: false,
            keepMirror: true,
          }
        : { retryWithLockVersion: null, replaceDraft: true, keepMirror: true };
    case "reload":
      return { retryWithLockVersion: null, replaceDraft: true, keepMirror: false };
    case "copy":
    case "diff":
      return { retryWithLockVersion: null, replaceDraft: false, keepMirror: true };
  }
}
