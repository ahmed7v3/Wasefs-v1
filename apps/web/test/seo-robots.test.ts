import { AI_CRAWLERS } from "@wasfa/shared/settings";
import { describe, expect, it } from "vitest";

import { DISALLOWED_PATHS, isNoindexPath, robotsRules } from "../src/lib/seo-robots";

const allAllowed = Object.fromEntries(AI_CRAWLERS.map((bot) => [bot, true])) as Record<
  (typeof AI_CRAWLERS)[number],
  boolean
>;
const SITE = "https://wasfa.online";

describe("robotsRules", () => {
  it("disallows everything outside production", () => {
    expect(robotsRules({ aiCrawlers: allAllowed }, SITE, false)).toEqual({
      rules: { userAgent: "*", disallow: "/" },
    });
  });

  it("allows all bots by default with the section 5.3 disallow list and the sitemap", () => {
    const robots = robotsRules({ aiCrawlers: allAllowed }, SITE, true);
    expect(robots.rules).toEqual([{ userAgent: "*", allow: "/", disallow: [...DISALLOWED_PATHS] }]);
    expect(robots.sitemap).toBe("https://wasfa.online/sitemap.xml");
  });

  it("adds one blocking group per disabled AI crawler", () => {
    const robots = robotsRules(
      { aiCrawlers: { ...allAllowed, GPTBot: false, CCBot: false } },
      SITE,
      true,
    );
    expect(robots.rules).toEqual([
      { userAgent: "*", allow: "/", disallow: [...DISALLOWED_PATHS] },
      { userAgent: "GPTBot", disallow: "/" },
      { userAgent: "CCBot", disallow: "/" },
    ]);
  });
});

describe("isNoindexPath", () => {
  it.each(["/admin", "/admin/users", "/api/me", "/capture/x", "/dashboard", "/login", "/join/abc"])(
    "noindex %s",
    (path) => expect(isNoindexPath(path)).toBe(true),
  );
  it.each(["/", "/pricing", "/en", "/privacy", "/administrator"])("indexable %s", (path) =>
    expect(isNoindexPath(path)).toBe(false),
  );
});
