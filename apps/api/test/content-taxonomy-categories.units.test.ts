import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { describe, expect, it } from "vitest";

import {
  categoryDepthIssue,
  categoryInUse,
  isCompleteSiblingList,
  orderCategoryTree,
  reviewRequirementChanged,
} from "../src/content/taxonomy/taxonomy-rules.js";
import { slugTakenError } from "../src/content/taxonomy/taxonomy.service.js";

describe("categoryDepthIssue", () => {
  const root = { parentId: null };
  const child = { parentId: "root" };

  it.each([
    ["top level", { selfId: null, parentId: null, parent: null, selfChildCount: 0 }, null],
    ["a child of a root", { selfId: null, parentId: "r", parent: root, selfChildCount: 0 }, null],
    [
      "a child of a child",
      { selfId: null, parentId: "c", parent: child, selfChildCount: 0 },
      "too_deep",
    ],
    [
      "a parent with children becoming a child",
      { selfId: "p", parentId: "r", parent: root, selfChildCount: 2 },
      "has_children",
    ],
    [
      "a parent with children staying top level",
      { selfId: "p", parentId: null, parent: null, selfChildCount: 2 },
      null,
    ],
    [
      "its own parent",
      { selfId: "p", parentId: "p", parent: root, selfChildCount: 0 },
      "self_parent",
    ],
    [
      "a parent that does not exist",
      { selfId: null, parentId: "x", parent: null, selfChildCount: 0 },
      "parent_missing",
    ],
  ])("%s", (_name, input, expected) => {
    expect(categoryDepthIssue(input)).toBe(expected);
  });
});

describe("orderCategoryTree", () => {
  it("orders roots by sort then name and puts each child group after its parent", () => {
    const rows = [
      { id: "c2", parentId: "b", sort: 1, nameAr: "ب" },
      { id: "a", parentId: null, sort: 5, nameAr: "أ" },
      { id: "b", parentId: null, sort: 1, nameAr: "ز" },
      { id: "c1", parentId: "b", sort: 0, nameAr: "ت" },
      { id: "d", parentId: null, sort: 1, nameAr: "ا" },
    ];
    expect(orderCategoryTree(rows).map((row) => row.id)).toEqual(["d", "b", "c1", "c2", "a"]);
  });
});

describe("in-use and reorder rules", () => {
  it("refuses a delete while items or children exist", () => {
    expect(categoryInUse({ itemCount: 0, childCount: 0 })).toBeNull();
    expect(categoryInUse({ itemCount: 3, childCount: 0 })).toEqual({ itemCount: 3, childCount: 0 });
    expect(categoryInUse({ itemCount: 0, childCount: 1 })).toEqual({ itemCount: 0, childCount: 1 });
  });

  it("accepts a reorder only when it lists every sibling exactly once", () => {
    expect(isCompleteSiblingList(["a", "b"], ["b", "a"])).toBe(true);
    expect(isCompleteSiblingList(["a", "b"], ["a"])).toBe(false);
    expect(isCompleteSiblingList(["a", "b"], ["a", "a"])).toBe(false);
    expect(isCompleteSiblingList(["a", "b"], ["a", "c"])).toBe(false);
  });

  it("notices a change of the review requirement", () => {
    expect(reviewRequirementChanged(true, false)).toBe(true);
    expect(reviewRequirementChanged(true, true)).toBe(false);
  });
});

describe("slugTakenError", () => {
  const violation = (constraint: string) => ({ code: "23505", constraint_name: constraint });

  it("names the field of the violated slug constraint", () => {
    const error = slugTakenError(violation("content_categories_slug_en_key"), {
      content_categories_slug_ar_key: "slugAr",
      content_categories_slug_en_key: "slugEn",
    });
    expect(error).toBeInstanceOf(AppError);
    expect(error?.code).toBe(ErrorCode.CONTENT_SLUG_TAKEN);
    expect(error?.details).toEqual({ fields: ["slugEn"] });
  });

  it("ignores other errors", () => {
    expect(slugTakenError(new Error("x"), { a: "b" })).toBeUndefined();
    expect(slugTakenError(violation("other"), { a: "b" })).toBeUndefined();
  });
});
