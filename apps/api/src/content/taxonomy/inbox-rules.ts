import { diffStats, diffWords } from "@wasfa/shared/content";

/** Pure parts of the review inbox and link suggestions. */

export type MineFilter = { kind: "all" } | { kind: "none" } | { kind: "person"; personId: string };

/**
 * `mine=true` narrows to the actor's linked person. An actor with no linked person has no items of
 * their own: the answer is empty, never "everything".
 */
export function resolveMineFilter(mine: boolean | undefined, personId: string | null): MineFilter {
  if (mine !== true) return { kind: "all" };
  return personId === null ? { kind: "none" } : { kind: "person", personId };
}

/** Row-level mirror of the SQL filter: category default reviewer or the item's own reviewer. */
export function isAssignedTo(
  row: { reviewerId: string | null; categoryDefaultReviewerId: string | null },
  personId: string,
): boolean {
  return row.reviewerId === personId || row.categoryDefaultReviewerId === personId;
}

export function ageHours(submittedAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - submittedAt.getTime()) / 3_600_000));
}

/** Words added/removed between the last approved revision and the submitted one (no approval: all added). */
export function inboxDiffStats(
  approved: { title: string; bodyMd: string } | null,
  submitted: { title: string; bodyMd: string },
): { added: number; removed: number } {
  const text = (rev: { title: string; bodyMd: string }) => `${rev.title}\n${rev.bodyMd}`;
  return diffStats(diffWords(approved === null ? "" : text(approved), text(submitted)));
}

/** Ranking of a link candidate: title similarity first, then shared category and entities. */
export function scoreSuggestion(input: {
  similarity: number;
  sameCategory: boolean;
  sharedEntities: number;
}): number {
  return (
    input.similarity + (input.sameCategory ? 0.2 : 0) + Math.min(input.sharedEntities, 3) * 0.1
  );
}
