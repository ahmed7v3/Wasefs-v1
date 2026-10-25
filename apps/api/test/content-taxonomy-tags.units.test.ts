import { describe, expect, it } from "vitest";

import {
  planTagMerge,
  tagMergePathMoves,
  tagPaths,
  tagRenamePathMoves,
} from "../src/content/taxonomy/taxonomy-rules.js";

describe("planTagMerge", () => {
  it("moves items that only had the merged tag and drops the overlap", () => {
    expect(planTagMerge({ fromItemIds: ["a", "b", "c"], intoItemIds: ["b", "z"] })).toEqual({
      repoint: ["a", "c"],
      drop: ["b"],
    });
  });

  it("is a no-op for an unused tag and tolerates duplicate rows", () => {
    expect(planTagMerge({ fromItemIds: [], intoItemIds: ["a"] })).toEqual({
      repoint: [],
      drop: [],
    });
    expect(planTagMerge({ fromItemIds: ["a", "a"], intoItemIds: [] })).toEqual({
      repoint: ["a"],
      drop: [],
    });
  });
});

describe("tag URL moves", () => {
  it("redirects each locale where the merged tag had a page", () => {
    expect(
      tagMergePathMoves(
        { slugAr: "sukkar", slugEn: "sugar" },
        { slugAr: "sukkari", slugEn: "diabetes" },
      ),
    ).toEqual([
      { fromPath: "/blog/t/sukkar", toPath: "/blog/t/sukkari" },
      { fromPath: "/en/blog/t/sugar", toPath: "/en/blog/t/diabetes" },
    ]);
  });

  it("falls back to the blog index where the surviving tag has no page, and skips missing slugs", () => {
    expect(tagMergePathMoves({ slugAr: "a", slugEn: null }, { slugAr: null, slugEn: "x" })).toEqual(
      [{ fromPath: "/blog/t/a", toPath: "/blog" }],
    );
  });

  it("writes a slug_changed move only for the slug that changed", () => {
    expect(
      tagRenamePathMoves({ slugAr: "old", slugEn: "same" }, { slugAr: "new", slugEn: "same" }),
    ).toEqual([{ fromPath: "/blog/t/old", toPath: "/blog/t/new" }]);
    expect(tagRenamePathMoves({ slugAr: null, slugEn: "a" }, { slugAr: "b", slugEn: "a" })).toEqual(
      [],
    );
  });

  it("lists the public paths of a tag", () => {
    expect(tagPaths({ slugAr: "a", slugEn: "b" })).toEqual(["/blog/t/a", "/en/blog/t/b"]);
    expect(tagPaths({ slugAr: null, slugEn: "b" })).toEqual(["/en/blog/t/b"]);
  });
});
