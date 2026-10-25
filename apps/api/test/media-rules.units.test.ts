import { patchMediaSchema } from "@wasfa/shared/schemas/media";
import { describe, expect, it } from "vitest";

import { mediaRightsIssues, mergeRights, touchesRights } from "../src/media/media-rules.js";

describe("mediaRightsIssues", () => {
  const base = { credit: null, licenceRef: null };

  it.each([
    ["own", {}, []],
    ["licensed", {}, []],
    ["ai-generated", {}, []],
    ["cc-by", {}, ["credit_required"]],
    ["cc-by", { credit: "Jane Doe" }, []],
    ["public-domain", {}, ["licence_ref_required"]],
    ["public-domain", { licenceRef: "https://example.org/pd" }, []],
    ["cc-by", { credit: "   " }, ["credit_required"]],
  ] as const)("%s %j", (licence, extra, expected) => {
    expect(mediaRightsIssues({ licence, ...base, ...extra })).toEqual(expected);
  });
});

describe("mergeRights and touchesRights", () => {
  const current = { licence: "own", credit: "A", licenceRef: null } as const;

  it("keeps untouched fields and lets null clear one", () => {
    expect(mergeRights(current, { licence: "cc-by", credit: null })).toEqual({
      licence: "cc-by",
      credit: null,
      licenceRef: null,
    });
    expect(mergeRights(current, {})).toEqual(current);
  });

  it("only revalidates when a rights field is in the patch", () => {
    expect(touchesRights({})).toBe(false);
    expect(touchesRights({ credit: null })).toBe(true);
  });
});

describe("patchMediaSchema", () => {
  it("accepts the new metadata fields", () => {
    const parsed = patchMediaSchema.parse({
      caption: " a caption ",
      credit: "Photo: A",
      licence: "ai-generated",
      licenceRef: null,
      seoFilename: "lemon-tea",
    });
    expect(parsed).toMatchObject({
      caption: "a caption",
      licence: "ai-generated",
      seoFilename: "lemon-tea",
    });
  });

  it.each([
    ["an unknown licence", { licence: "stolen" }],
    ["a file name with an extension", { seoFilename: "lemon.jpg" }],
    ["an upper-case file name", { seoFilename: "Lemon" }],
    ["read-only fields only", { warnings: ["x"], usageCount: 3, originalFilename: "a.jpg" }],
    ["nothing", {}],
  ])("rejects %s", (_name, body) => {
    expect(patchMediaSchema.safeParse(body).success).toBe(false);
  });
});
