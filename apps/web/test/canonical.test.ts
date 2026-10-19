import { describe, expect, it } from "vitest";

import { canonicalUrl, stripTrackingParams } from "../src/lib/canonical";

describe("stripTrackingParams", () => {
  it("removes campaign, referral, click-id and sort params, keeps the rest sorted", () => {
    const params = new URLSearchParams(
      "utm_source=x&UTM_medium=y&ref=abc&gclid=1&fbclid=2&ttclid=3&msclkid=4&sort=asc&_gl=5&q=b&page=2",
    );
    expect(stripTrackingParams(params).toString()).toBe("page=2&q=b");
  });
});

describe("canonicalUrl", () => {
  it("returns the clean URL", () => {
    expect(canonicalUrl("https://wasfa.online/pricing?utm_source=a&ref=x#top")).toBe(
      "https://wasfa.online/pricing",
    );
  });
  it("keeps pagination", () => {
    expect(canonicalUrl("https://wasfa.online/blog?sort=new&page=2")).toBe(
      "https://wasfa.online/blog?page=2",
    );
  });
});
