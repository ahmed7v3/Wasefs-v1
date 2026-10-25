import { describe, expect, it, vi } from "vitest";

import {
  PATH_STATE_TTL_MS,
  createPathStateCache,
  goneHtml,
  isContentPath,
  matchPathState,
} from "../src/lib/path-state";

const STATE = {
  redirects: {
    "/blog/old": "/blog/new",
    "/en/guides/old": "/en/guides/new",
    "/blog/self": "/blog/self",
  },
  gone: ["/blog/removed", "/en/glossary/gone"],
};

describe("matchPathState", () => {
  it.each([
    ["/blog/old", { kind: "redirect", to: "/blog/new" }],
    ["/blog/old/", { kind: "redirect", to: "/blog/new" }],
    ["/en/guides/old", { kind: "redirect", to: "/en/guides/new" }],
    ["/blog/Old", null],
    ["/blog/self", null],
    ["/blog/removed", { kind: "gone" }],
    ["/blog/removed/", { kind: "gone" }],
    ["/en/glossary/gone", { kind: "gone" }],
    ["/blog/fine", null],
    ["/blog/constructor", null],
    ["/", null],
  ])("%s", (path, expected) => {
    expect(matchPathState(STATE, path)).toEqual(expected);
  });
});

describe("isContentPath", () => {
  it.each([
    ["/blog", true],
    ["/blog/x", true],
    ["/en/blog/x", true],
    ["/guides/x", true],
    ["/glossary/bid", true],
    ["/authors/sara", true],
    ["/en/authors/sara", true],
    ["/blog/feed.xml", false],
    ["/en/blog/feed.xml", false],
    ["/blogger", false],
    ["/pricing", false],
    ["/en", false],
    ["/dashboard", false],
  ])("%s -> %s", (path, expected) => {
    expect(isContentPath(path)).toBe(expected);
  });
});

describe("createPathStateCache", () => {
  it("caches for the TTL and shares one in-flight refresh", async () => {
    const load = vi.fn(() => Promise.resolve(STATE));
    const cache = createPathStateCache(load);
    await Promise.all([cache.get(1000), cache.get(1000), cache.get(1001)]);
    await cache.get(1000 + PATH_STATE_TTL_MS - 1);
    expect(load).toHaveBeenCalledTimes(1);
    await cache.get(1000 + PATH_STATE_TTL_MS);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps the stale state when a refresh fails and never throws", async () => {
    const load = vi
      .fn<() => Promise<typeof STATE>>()
      .mockResolvedValueOnce(STATE)
      .mockRejectedValue(new Error("down"));
    const cache = createPathStateCache(load);
    expect(await cache.get(0)).toEqual(STATE);
    expect(await cache.get(PATH_STATE_TTL_MS)).toEqual(STATE);
    expect(await cache.get(PATH_STATE_TTL_MS + 1)).toEqual(STATE);
  });

  it("passes through (null) when no state was ever loaded", async () => {
    const cache = createPathStateCache(() => Promise.reject(new Error("down")));
    expect(await cache.get(0)).toBeNull();
  });
});

describe("goneHtml", () => {
  it("is localized and noindex", () => {
    expect(goneHtml("/en/blog/x")).toContain('lang="en"');
    expect(goneHtml("/blog/x")).toContain('lang="ar"');
    expect(goneHtml("/blog/x")).toContain("noindex");
  });
});
