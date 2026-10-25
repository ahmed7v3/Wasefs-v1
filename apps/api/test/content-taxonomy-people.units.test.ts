import { describe, expect, it } from "vitest";

import {
  personAuditView,
  personDeleteBlock,
  roleChangeBlock,
  userLinkIssue,
} from "../src/content/taxonomy/taxonomy-rules.js";

const none = { categoryCount: 0, reviewerItemCount: 0, authorItemCount: 0, inReviewCount: 0 };

describe("roleChangeBlock", () => {
  it("lets a person keep or widen the role", () => {
    expect(roleChangeBlock("both", { categoryCount: 2, inReviewCount: 3 })).toBeNull();
    expect(roleChangeBlock("reviewer", { categoryCount: 2, inReviewCount: 3 })).toBeNull();
  });

  it("refuses author-only while the person is a default reviewer or reviews an item in review", () => {
    expect(roleChangeBlock("author", { categoryCount: 1, inReviewCount: 0 })).toEqual({
      categoryCount: 1,
      inReviewCount: 0,
    });
    expect(roleChangeBlock("author", { categoryCount: 0, inReviewCount: 2 })).not.toBeNull();
    expect(roleChangeBlock("author", { categoryCount: 0, inReviewCount: 0 })).toBeNull();
  });
});

describe("personDeleteBlock", () => {
  it("allows deleting an unreferenced person", () => {
    expect(personDeleteBlock(none)).toBeNull();
  });

  it("refuses while any item or category references the person", () => {
    expect(personDeleteBlock({ ...none, authorItemCount: 2 })).toEqual({ itemCount: 2 });
    expect(personDeleteBlock({ ...none, reviewerItemCount: 1, authorItemCount: 1 })).toEqual({
      itemCount: 2,
    });
    expect(personDeleteBlock({ ...none, categoryCount: 1 })).toEqual({ itemCount: 0 });
  });
});

describe("userLinkIssue", () => {
  it.each([
    ["no link", { userId: null, userExists: false, linkedPersonId: null, selfId: null }, null],
    ["a free account", { userId: "u", userExists: true, linkedPersonId: null, selfId: null }, null],
    [
      "an account that does not exist",
      { userId: "u", userExists: false, linkedPersonId: null, selfId: null },
      "user_missing",
    ],
    [
      "an account of another profile",
      { userId: "u", userExists: true, linkedPersonId: "p2", selfId: "p1" },
      "user_taken",
    ],
    [
      "the profile's own account",
      { userId: "u", userExists: true, linkedPersonId: "p1", selfId: "p1" },
      null,
    ],
  ])("%s", (_name, input, expected) => {
    expect(userLinkIssue(input)).toBe(expected);
  });
});

describe("personAuditView", () => {
  it("never carries the licence number or the names", () => {
    const view = personAuditView({
      slug: "dr-x",
      role: "reviewer",
      active: true,
      showLicence: true,
      licenceNumber: "EG-123456",
      userId: null,
      photoMediaId: null,
    });
    expect(view).toEqual({
      slug: "dr-x",
      role: "reviewer",
      active: true,
      showLicence: true,
      hasLicence: true,
      userId: null,
      photoMediaId: null,
    });
    expect(JSON.stringify(view)).not.toContain("EG-123456");
    expect(personAuditView({ ...view, licenceNumber: " " }).hasLicence).toBe(false);
  });
});
