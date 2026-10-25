import { describe, expect, it } from "vitest";

import {
  applyTagMode,
  bulkScheduleVerdict,
  distinctIds,
  scheduleSeriesTimes,
  shapeBulkResults,
} from "../src/content/taxonomy/bulk-rules.js";
import {
  ageHours,
  inboxDiffStats,
  isAssignedTo,
  resolveMineFilter,
  scoreSuggestion,
} from "../src/content/taxonomy/inbox-rules.js";

describe("shapeBulkResults", () => {
  it("answers once per requested id, in order, and NOT_FOUND for an id nobody handled", () => {
    const outcomes = new Map<string, { ok: true } | { ok: false; code: string }>([
      ["a", { ok: true }],
      ["b", { ok: false, code: "CONTENT_GATES_BLOCK" }],
    ]);
    expect(shapeBulkResults(["b", "a", "z", "a"], outcomes)).toEqual([
      { id: "b", ok: false, code: "CONTENT_GATES_BLOCK" },
      { id: "a", ok: true },
      { id: "z", ok: false, code: "NOT_FOUND" },
      { id: "a", ok: true },
    ]);
  });

  it("keeps the first occurrence of a repeated id", () => {
    expect(distinctIds(["a", "b", "a"])).toEqual(["a", "b"]);
  });
});

describe("series and tag modes", () => {
  it("spaces a series by the interval", () => {
    const times = scheduleSeriesTimes(new Date("2030-01-01T08:00:00Z"), 6, 3);
    expect(times.map((time) => time.toISOString())).toEqual([
      "2030-01-01T08:00:00.000Z",
      "2030-01-01T14:00:00.000Z",
      "2030-01-01T20:00:00.000Z",
    ]);
  });

  it("applies add, remove and replace without duplicates", () => {
    expect(applyTagMode(["a", "b"], "add", ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(applyTagMode(["a", "b"], "remove", ["b", "z"])).toEqual(["a"]);
    expect(applyTagMode(["a", "b"], "replace", ["c", "c"])).toEqual(["c"]);
  });
});

describe("bulkScheduleVerdict", () => {
  it.each([
    ["approved", { status: "approved", type: "article", categoryRequiresReview: true }, true],
    [
      "draft that needs no review",
      { status: "draft", type: "article", categoryRequiresReview: false },
      true,
    ],
    ["page draft", { status: "draft", type: "page", categoryRequiresReview: null }, true],
    [
      "draft that needs review",
      { status: "draft", type: "article", categoryRequiresReview: true },
      false,
    ],
    ["guide draft", { status: "draft", type: "guide", categoryRequiresReview: false }, false],
    ["in review", { status: "in_review", type: "article", categoryRequiresReview: false }, false],
    ["published", { status: "published", type: "article", categoryRequiresReview: false }, false],
  ] as const)("%s", (_name, input, ok) => {
    expect(bulkScheduleVerdict(input).ok).toBe(ok);
  });

  it("tells a missing approval from an illegal state", () => {
    expect(
      bulkScheduleVerdict({ status: "draft", type: "article", categoryRequiresReview: true }),
    ).toEqual({ ok: false, code: "CONTENT_NOT_APPROVED" });
    expect(
      bulkScheduleVerdict({ status: "archived", type: "article", categoryRequiresReview: true }),
    ).toEqual({ ok: false, code: "CONTENT_ILLEGAL_TRANSITION" });
  });
});

describe("review inbox", () => {
  it("never turns mine=true into everything", () => {
    expect(resolveMineFilter(undefined, "p")).toEqual({ kind: "all" });
    expect(resolveMineFilter(false, "p")).toEqual({ kind: "all" });
    expect(resolveMineFilter(true, null)).toEqual({ kind: "none" });
    expect(resolveMineFilter(true, "p")).toEqual({ kind: "person", personId: "p" });
  });

  it("assigns by the item's reviewer or the category default", () => {
    expect(isAssignedTo({ reviewerId: "p", categoryDefaultReviewerId: null }, "p")).toBe(true);
    expect(isAssignedTo({ reviewerId: null, categoryDefaultReviewerId: "p" }, "p")).toBe(true);
    expect(isAssignedTo({ reviewerId: "q", categoryDefaultReviewerId: "r" }, "p")).toBe(false);
  });

  it("counts whole hours of age, never negative", () => {
    const now = new Date("2030-01-01T10:30:00Z");
    expect(ageHours(new Date("2030-01-01T07:45:00Z"), now)).toBe(2);
    expect(ageHours(new Date("2030-01-02T00:00:00Z"), now)).toBe(0);
  });

  it("diffs against the last approved revision, or counts everything as added", () => {
    const first = inboxDiffStats(null, { title: "t", bodyMd: "one two three" });
    expect(first.added).toBeGreaterThan(0);
    expect(first.removed).toBe(0);
    const edit = inboxDiffStats(
      { title: "t", bodyMd: "one two three" },
      { title: "t", bodyMd: "one two four five" },
    );
    expect(edit.added).toBe(2);
    expect(edit.removed).toBe(1);
  });
});

describe("scoreSuggestion", () => {
  it("prefers the same category and shared entities, capped", () => {
    const base = scoreSuggestion({ similarity: 0.3, sameCategory: false, sharedEntities: 0 });
    expect(
      scoreSuggestion({ similarity: 0.3, sameCategory: true, sharedEntities: 0 }),
    ).toBeGreaterThan(base);
    expect(
      scoreSuggestion({ similarity: 0.3, sameCategory: false, sharedEntities: 9 }),
    ).toBeCloseTo(0.6);
  });
});
