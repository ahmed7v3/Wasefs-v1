import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { canServeOnClass } from "@wasfa/shared/ads";
import { describe, expect, it } from "vitest";

import { adClassOfPath } from "../src/lib/ad-route-class";

/*
 * The bottom banner lives in layouts, which cannot read a page's `ad-class.ts`, so it resolves the
 * class from the URL (`adClassOfPath`). This walk keeps that table and every route's declared class
 * in step: a servable declared class must resolve to itself, everything else must resolve to a class
 * that never serves.
 */

const APP_DIR = fileURLToPath(new URL("../src/app", import.meta.url));
const DECLARATION = /export const adClass = "([a-z_]+)"/;

function pageDirs(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) pageDirs(path, found);
    else if (entry.name === "page.tsx") found.push(dir);
  }
  return found;
}

/** `(marketing)/blog/[slug]` -> `/blog/x`; route groups vanish, dynamic segments become `x`. */
function urlOf(dir: string): string {
  const segments = relative(APP_DIR, dir)
    .split(/[\\/]/)
    .filter((segment) => segment !== "" && !/^\(.*\)$/.test(segment))
    .map((segment) => (segment.startsWith("[") ? "x" : segment));
  return `/${segments.join("/")}`;
}

describe("adClassOfPath", () => {
  it("resolves the known public and app routes", () => {
    expect(adClassOfPath("/")).toBe("marketing");
    expect(adClassOfPath("/en")).toBe("marketing");
    expect(adClassOfPath("/en/features/ai-assistant")).toBe("marketing");
    expect(adClassOfPath("/blog/some-post?x=1")).toBe("content");
    expect(adClassOfPath("/en/glossary/term")).toBe("content");
    expect(adClassOfPath("/dashboard")).toBe("app_neutral");
    expect(adClassOfPath("/analyze")).toBe("app_neutral");
  });

  it("never serves results, chat, checkout, pricing, account or anything unknown", () => {
    for (const path of [
      "/analyze/0190a000",
      "/analyze/history",
      "/ai/abc",
      "/checkout",
      "/checkout/pay",
      "/pricing",
      "/en/pricing",
      "/account",
      "/billing/orders/1",
      "/admin/ads",
      "/login",
      "/privacy",
      "/something-new",
    ]) {
      expect(canServeOnClass(adClassOfPath(path)), path).toBe(false);
    }
  });

  it("agrees with the ad-class.ts of every page", () => {
    const mismatches: string[] = [];
    for (const dir of pageDirs(APP_DIR)) {
      const file = join(dir, "ad-class.ts");
      const declared = existsSync(file)
        ? (DECLARATION.exec(readFileSync(file, "utf8"))?.[1] ?? "app_sensitive")
        : "app_sensitive";
      const resolved = adClassOfPath(urlOf(dir));
      const ok = canServeOnClass(declared as typeof resolved)
        ? resolved === declared
        : !canServeOnClass(resolved);
      if (!ok) mismatches.push(`${urlOf(dir)}: declared ${declared}, resolved ${resolved}`);
    }
    expect(mismatches).toEqual([]);
  });
});
