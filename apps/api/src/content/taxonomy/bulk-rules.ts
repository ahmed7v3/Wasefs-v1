import { requiresMedicalReview } from "@wasfa/shared/content";

import type { ContentStatus, ContentType } from "@wasfa/shared/content/constants";

/** Pure parts of the bulk actions: result shaping, series timing, tag modes, schedulability. */

export type BulkOutcome = { ok: true } | { ok: false; code: string };

/** One entry per requested id, in order; an id nobody handled answers `NOT_FOUND`. */
export function shapeBulkResults(
  ids: readonly string[],
  outcomes: ReadonlyMap<string, BulkOutcome>,
): { id: string; ok: boolean; code?: string }[] {
  return ids.map((id) => {
    const outcome = outcomes.get(id);
    if (outcome === undefined) return { id, ok: false, code: "NOT_FOUND" };
    return outcome.ok ? { id, ok: true } : { id, ok: false, code: outcome.code };
  });
}

/** Distinct ids, first occurrence wins (a duplicate would otherwise be scheduled twice). */
export function distinctIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/** First instant, then one every `everyHours`, in order. */
export function scheduleSeriesTimes(startAt: Date, everyHours: number, count: number): Date[] {
  return Array.from(
    { length: count },
    (_, index) => new Date(startAt.getTime() + index * everyHours * 3_600_000),
  );
}

export function applyTagMode(
  current: readonly string[],
  mode: "add" | "remove" | "replace",
  tagIds: readonly string[],
): string[] {
  if (mode === "replace") return [...new Set(tagIds)];
  if (mode === "add") return [...new Set([...current, ...tagIds])];
  const drop = new Set(tagIds);
  return current.filter((id) => !drop.has(id));
}

/**
 * A series may only schedule items that can be scheduled at once: `approved`, or `draft` when no
 * review is required. The workflow re-checks (and runs the quality gates) when the action is applied.
 */
export function bulkScheduleVerdict(input: {
  status: ContentStatus;
  type: ContentType;
  categoryRequiresReview: boolean | null;
}): { ok: true } | { ok: false; code: string } {
  if (input.status === "approved") return { ok: true };
  if (input.status === "draft") {
    const needsReview = requiresMedicalReview({
      type: input.type,
      categoryRequiresReview: input.categoryRequiresReview,
    });
    return needsReview ? { ok: false, code: "CONTENT_NOT_APPROVED" } : { ok: true };
  }
  return { ok: false, code: "CONTENT_ILLEGAL_TRANSITION" };
}
