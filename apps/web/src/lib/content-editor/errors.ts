import { QUALITY_GATE_IDS, type QualityGateId } from "@wasfa/shared/content/constants";
import { t, type MessageKey } from "@wasfa/shared/i18n";

import { ApiRequestError } from "../api-error";

import type { ErrorCode } from "@wasfa/shared/errors";

/*
 * API error -> the sentence an editor reads. Every `CONTENT_*` code has its own message (typed:
 * adding a code without a key here fails the build) because "what do I do now" differs for each:
 * reload, ask for review, pick another slug, fix a gate. The generic API message is only the fallback
 * for codes that are not content-specific.
 */

export type ContentErrorCode = Extract<ErrorCode, `CONTENT_${string}`>;

export const CONTENT_ERROR_KEYS = {
  CONTENT_CONFLICT: "admin.editor.error.CONTENT_CONFLICT",
  CONTENT_ILLEGAL_TRANSITION: "admin.editor.error.CONTENT_ILLEGAL_TRANSITION",
  CONTENT_GATES_BLOCK: "admin.editor.error.CONTENT_GATES_BLOCK",
  CONTENT_PUBLISH_CAP: "admin.editor.error.CONTENT_PUBLISH_CAP",
  CONTENT_FOUR_EYES: "admin.editor.error.CONTENT_FOUR_EYES",
  CONTENT_NOT_A_REVIEWER: "admin.editor.error.CONTENT_NOT_A_REVIEWER",
  CONTENT_COMMENT_REQUIRED: "admin.editor.error.CONTENT_COMMENT_REQUIRED",
  CONTENT_SCHEDULE_IN_PAST: "admin.editor.error.CONTENT_SCHEDULE_IN_PAST",
  CONTENT_REVIEW_NOT_REQUIRED: "admin.editor.error.CONTENT_REVIEW_NOT_REQUIRED",
  CONTENT_NOT_APPROVED: "admin.editor.error.CONTENT_NOT_APPROVED",
  CONTENT_SLUG_TAKEN: "admin.editor.error.CONTENT_SLUG_TAKEN",
  CONTENT_IN_USE: "admin.editor.error.CONTENT_IN_USE",
  CONTENT_REDIRECT_INVALID: "admin.editor.error.CONTENT_REDIRECT_INVALID",
} as const satisfies Record<ContentErrorCode, MessageKey>;

const GENERIC_KEYS: Partial<Record<string, MessageKey>> = {
  VALIDATION_FAILED: "admin.editor.error.VALIDATION_FAILED",
  NOT_FOUND: "admin.editor.error.NOT_FOUND",
  FORBIDDEN: "admin.editor.error.FORBIDDEN",
  UPSTREAM_UNAVAILABLE: "admin.editor.error.OFFLINE",
};

const GATE_ID_SET: ReadonlySet<string> = new Set(QUALITY_GATE_IDS);

/** Gate ids a `CONTENT_GATES_BLOCK` answer lists (`details.gates`; `gateIds` and `blocking` are accepted too). */
export function gateIdsFromError(error: unknown): QualityGateId[] {
  if (!(error instanceof ApiRequestError)) return [];
  for (const name of ["gates", "gateIds", "blocking"]) {
    const value = error.details?.[name];
    if (Array.isArray(value)) {
      const ids = value.filter(
        (entry): entry is QualityGateId => typeof entry === "string" && GATE_ID_SET.has(entry),
      );
      if (ids.length > 0) return ids;
    }
  }
  return [];
}

export interface DescribedError {
  code: string | null;
  message: string;
  gateIds: QualityGateId[];
}

export function describeContentError(error: unknown): DescribedError {
  if (!(error instanceof ApiRequestError)) {
    return { code: null, message: t("admin.editor.error.unknown"), gateIds: [] };
  }
  const key =
    error.code in CONTENT_ERROR_KEYS
      ? CONTENT_ERROR_KEYS[error.code as ContentErrorCode]
      : GENERIC_KEYS[error.code];
  return {
    code: error.code,
    message: key ? t(key) : error.message,
    gateIds: error.code === "CONTENT_GATES_BLOCK" ? gateIdsFromError(error) : [],
  };
}
