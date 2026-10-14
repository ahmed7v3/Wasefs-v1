/*
 * Closed value sets for prescription analysis (Phase 2, Task 2.1). One tuple types the column,
 * builds the DB CHECK and drives the zod schemas, so they cannot drift.
 */

/** Lifecycle of one analysis (a worker job on the `rx` queue). */
export const RX_STATUSES = [
  "queued",
  "processing",
  "verifying",
  "done",
  "failed",
  "refunded",
] as const;
export type RxStatus = (typeof RX_STATUSES)[number];

/** The fields of one prescription line a user can correct; also the unit the eval scores. */
export const RX_FIELDS = [
  "drug",
  "ingredient",
  "strength",
  "form",
  "dose",
  "frequency",
  "duration",
  "route",
] as const;
export type RxField = (typeof RX_FIELDS)[number];

/** A prescription has one to four pages (one file each). */
export const RX_MAX_PAGES = 4;

/** Patient and prescriber names are stored redacted: initials only (ARCHITECTURE section 5.7). */
export const RX_INITIALS_MAX_LENGTH = 8;

/** Kind of an eval item, so accuracy is reported separately for printed and handwritten. */
export const EVAL_ITEM_KINDS = ["printed", "handwritten"] as const;
export type EvalItemKind = (typeof EVAL_ITEM_KINDS)[number];

/** The skill (`skills/<name>/SKILL.md`) the prescription pipeline runs; its version is part of the exact-match cache key. */
export const RX_SKILL_NAME = "prescription-analysis";
