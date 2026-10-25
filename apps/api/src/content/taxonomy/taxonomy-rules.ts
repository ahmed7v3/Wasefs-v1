import type { ContentLocale } from "@wasfa/shared/content/constants";

/*
 * Pure rules of the content taxonomy (categories, tags, people), kept free of the database so the
 * unit test covers every branch. The services call them and turn the verdict into an `AppError`.
 */

// ---------------------------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------------------------

export type CategoryDepthIssue = "self_parent" | "parent_missing" | "too_deep" | "has_children";

/**
 * Categories nest two levels at most (CONTENT-PLATFORM section 3): a child cannot get children, and
 * a parent that has children cannot become a child. `parent` is the row the new `parentId` points
 * at (null when it does not exist).
 */
export function categoryDepthIssue(input: {
  selfId: string | null;
  parentId: string | null;
  parent: { parentId: string | null } | null;
  selfChildCount: number;
}): CategoryDepthIssue | null {
  if (input.parentId === null) return null;
  if (input.selfId !== null && input.parentId === input.selfId) return "self_parent";
  if (input.parent === null) return "parent_missing";
  if (input.parent.parentId !== null) return "too_deep";
  if (input.selfChildCount > 0) return "has_children";
  return null;
}

export interface CategoryOrderRow {
  id: string;
  parentId: string | null;
  sort: number;
  nameAr: string;
}

const byOrder = (a: CategoryOrderRow, b: CategoryOrderRow): number =>
  a.sort - b.sort || a.nameAr.localeCompare(b.nameAr, "ar") || a.id.localeCompare(b.id);

/** Tree order: each root by (sort, name), followed by its children by (sort, name). Orphans go last. */
export function orderCategoryTree<T extends CategoryOrderRow>(rows: readonly T[]): T[] {
  const ids = new Set(rows.map((row) => row.id));
  const roots = rows.filter((row) => row.parentId === null || !ids.has(row.parentId));
  const childrenOf = (parentId: string) =>
    rows.filter((row) => row.parentId === parentId).sort(byOrder);
  return [...roots].sort(byOrder).flatMap((root) => [root, ...childrenOf(root.id)]);
}

/** What still uses a category; an empty verdict means it may be deleted. */
export function categoryInUse(input: { itemCount: number; childCount: number }): {
  itemCount: number;
  childCount: number;
} | null {
  return input.itemCount > 0 || input.childCount > 0 ? input : null;
}

/** A reorder request must list exactly the siblings of the parent, each once. */
export function isCompleteSiblingList(
  siblingIds: readonly string[],
  requestedIds: readonly string[],
): boolean {
  if (siblingIds.length !== requestedIds.length) return false;
  const requested = new Set(requestedIds);
  return requested.size === requestedIds.length && siblingIds.every((id) => requested.has(id));
}

/** `requiresMedicalReview` is the one category field whose change is audited with before/after. */
export function reviewRequirementChanged(before: boolean, after: boolean): boolean {
  return before !== after;
}

// ---------------------------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------------------------

export interface TagSlugs {
  slugAr: string | null;
  slugEn: string | null;
}

/** Public tag page: `/blog/t/<slug>` in Arabic, `/en/blog/t/<slug>` in English. */
export function tagPath(locale: ContentLocale, slug: string): string {
  return `${locale === "en" ? "/en" : ""}/blog/t/${slug}`;
}

/** The blog index of a locale: where a merged tag lands when the surviving tag has no page there. */
export function blogIndexPath(locale: ContentLocale): string {
  return locale === "en" ? "/en/blog" : "/blog";
}

export interface TagMergePlan {
  /** Items that had only the merged tag: they get the surviving tag. */
  repoint: string[];
  /** Items that had both: the merged tag's link is dropped, no duplicate row. */
  drop: string[];
}

/** Which `content_item_tags` rows move and which vanish when `from` is merged into `into`. */
export function planTagMerge(input: {
  fromItemIds: readonly string[];
  intoItemIds: readonly string[];
}): TagMergePlan {
  const already = new Set(input.intoItemIds);
  const seen = new Set<string>();
  const plan: TagMergePlan = { repoint: [], drop: [] };
  for (const itemId of input.fromItemIds) {
    if (seen.has(itemId)) continue;
    seen.add(itemId);
    (already.has(itemId) ? plan.drop : plan.repoint).push(itemId);
  }
  return plan;
}

export interface PlannedPathMove {
  fromPath: string;
  toPath: string;
}

/**
 * The URL moves a merge causes: one per locale where the merged tag had a page. A locale where the
 * surviving tag has no page falls back to the blog index so the old URL never 404s.
 */
export function tagMergePathMoves(from: TagSlugs, into: TagSlugs): PlannedPathMove[] {
  const moves: PlannedPathMove[] = [];
  for (const locale of ["ar", "en"] as const) {
    const fromSlug = locale === "ar" ? from.slugAr : from.slugEn;
    const intoSlug = locale === "ar" ? into.slugAr : into.slugEn;
    if (fromSlug === null) continue;
    const fromPath = tagPath(locale, fromSlug);
    const toPath = intoSlug === null ? blogIndexPath(locale) : tagPath(locale, intoSlug);
    if (fromPath !== toPath) moves.push({ fromPath, toPath });
  }
  return moves;
}

/** The URL moves a slug edit causes (reason `slug_changed`), per locale whose slug changed. */
export function tagRenamePathMoves(before: TagSlugs, after: TagSlugs): PlannedPathMove[] {
  const moves: PlannedPathMove[] = [];
  for (const locale of ["ar", "en"] as const) {
    const oldSlug = locale === "ar" ? before.slugAr : before.slugEn;
    const newSlug = locale === "ar" ? after.slugAr : after.slugEn;
    if (oldSlug === null || oldSlug === newSlug) continue;
    moves.push({
      fromPath: tagPath(locale, oldSlug),
      toPath: newSlug === null ? blogIndexPath(locale) : tagPath(locale, newSlug),
    });
  }
  return moves;
}

/** Public paths of a tag (the pages an `taxonomy` change touches). */
export function tagPaths(tag: TagSlugs): string[] {
  return [
    ...(tag.slugAr === null ? [] : [tagPath("ar", tag.slugAr)]),
    ...(tag.slugEn === null ? [] : [tagPath("en", tag.slugEn)]),
  ];
}

// ---------------------------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------------------------

export type PersonRole = "author" | "reviewer" | "both";

export interface PersonReferences {
  /** Categories that name the person as their default reviewer. */
  categoryCount: number;
  /** Items (any status) naming the person as `reviewer_id`. */
  reviewerItemCount: number;
  /** Items (any status) naming the person as primary author. */
  authorItemCount: number;
  /** Items currently `in_review` whose `reviewer_id` is the person. */
  inReviewCount: number;
}

/**
 * Setting a person to author-only is refused while they still serve as a reviewer: a category's
 * default reviewer, or the assigned reviewer of an item in review (the reviewer inbox would orphan).
 */
export function roleChangeBlock(
  newRole: PersonRole,
  refs: Pick<PersonReferences, "categoryCount" | "inReviewCount">,
): { categoryCount: number; inReviewCount: number } | null {
  if (newRole !== "author") return null;
  return refs.categoryCount > 0 || refs.inReviewCount > 0
    ? { categoryCount: refs.categoryCount, inReviewCount: refs.inReviewCount }
    : null;
}

/** A person referenced anywhere cannot be deleted; deactivate instead. */
export function personDeleteBlock(refs: PersonReferences): { itemCount: number } | null {
  const itemCount = refs.reviewerItemCount + refs.authorItemCount;
  return itemCount > 0 || refs.categoryCount > 0 ? { itemCount } : null;
}

export type UserLinkIssue = "user_missing" | "user_taken";

/**
 * A person linked to an account must reference an existing user, and an account backs at most one
 * profile. `linkedPersonId` is the profile that already holds that user (null when none).
 */
export function userLinkIssue(input: {
  userId: string | null;
  userExists: boolean;
  linkedPersonId: string | null;
  selfId: string | null;
}): UserLinkIssue | null {
  if (input.userId === null) return null;
  if (!input.userExists) return "user_missing";
  if (input.linkedPersonId !== null && input.linkedPersonId !== input.selfId) return "user_taken";
  return null;
}

export interface PersonAuditView {
  slug: string;
  role: string;
  active: boolean;
  showLicence: boolean;
  hasLicence: boolean;
  userId: string | null;
  photoMediaId: string | null;
}

/** What the audit trail keeps of a person: no names, no licence number (only that one exists). */
export function personAuditView(person: {
  slug: string;
  role: string;
  active: boolean;
  showLicence: boolean;
  licenceNumber: string | null;
  userId: string | null;
  photoMediaId: string | null;
}): PersonAuditView {
  return {
    slug: person.slug,
    role: person.role,
    active: person.active,
    showLicence: person.showLicence,
    hasLicence: person.licenceNumber !== null && person.licenceNumber.trim() !== "",
    userId: person.userId,
    photoMediaId: person.photoMediaId,
  };
}
