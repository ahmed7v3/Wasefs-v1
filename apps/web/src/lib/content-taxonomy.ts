import type { Category } from "@wasfa/shared/schemas/content";

/*
 * Pure helpers of the categories tree (two levels, CONTENT-PLATFORM §8.5): ordering, the flat rows the
 * view draws, and the move of one sibling that `POST categories/reorder` receives as a full id list.
 */

export interface CategoryRow {
  category: Category;
  /** 0 for a top-level category, 1 for a child. */
  depth: 0 | 1;
  /** Ids of the siblings under the same parent, in display order (this one included). */
  siblings: string[];
  index: number;
}

const bySort = (a: Category, b: Category) =>
  a.sort - b.sort || a.nameAr.localeCompare(b.nameAr, "ar");

/** The tree flattened depth-first: each parent followed by its children, both ordered by `sort` then name. */
export function categoryRows(categories: readonly Category[]): CategoryRow[] {
  const ids = new Set(categories.map((category) => category.id));
  // A category whose parent is missing from the list is shown at the top level.
  const roots = categories
    .filter((category) => category.parentId === null || !ids.has(category.parentId))
    .toSorted(bySort);
  const rows: CategoryRow[] = [];
  const rootIds = roots.map((root) => root.id);
  roots.forEach((root, rootIndex) => {
    rows.push({ category: root, depth: 0, siblings: rootIds, index: rootIndex });
    const children = categories
      .filter((category) => category.parentId === root.id)
      .toSorted(bySort);
    const childIds = children.map((child) => child.id);
    children.forEach((child, childIndex) => {
      rows.push({ category: child, depth: 1, siblings: childIds, index: childIndex });
    });
  });
  return rows;
}

/** `ids` with `id` moved one place; the same array when it is already at that edge. */
export function moveSibling(
  ids: readonly string[],
  id: string,
  direction: "up" | "down",
): string[] {
  const index = ids.indexOf(id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= ids.length) return [...ids];
  const next = [...ids];
  const [moved] = next.splice(index, 1);
  if (moved !== undefined) next.splice(target, 0, moved);
  return next;
}

/** Top-level categories that can be a parent: not the category itself, and (two levels) not a child. */
export function parentCandidates(
  categories: readonly Category[],
  editingId: string | null,
): Category[] {
  return categories
    .filter((category) => category.parentId === null && category.id !== editingId)
    .toSorted(bySort);
}

/** A category with children cannot become a child itself (the tree is two levels deep). */
export function canHaveParent(categories: readonly Category[], editingId: string | null): boolean {
  if (editingId === null) return true;
  return !categories.some((category) => category.parentId === editingId);
}
