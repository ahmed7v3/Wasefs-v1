import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { NEVER_SERVE_CLASSES, PAGE_CLASSES, canServeOnClass, isPageClass } from "@wasfa/shared/ads";
import { describe, expect, it } from "vitest";

/*
 * Route-class walk (docs/ADS.md §2, §9). Next.js rejects unknown exports from `page.tsx`, so a
 * route declares its ad class in a colocated `ad-class.ts` (`export const adClass = "..."`). Every
 * folder with a page must have one, and the value must be a real page class. A route without a
 * declared class is treated as `app_sensitive` at runtime, but this test still requires the explicit
 * declaration so nobody lands a page without choosing.
 */

const APP_DIR = fileURLToPath(new URL("../src/app", import.meta.url));
const DECLARATION = /export const adClass = "([a-z_]+)"/;

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, found);
    else found.push(path);
  }
  return found;
}

const files = walk(APP_DIR);
const pageDirs = files.filter((file) => file.endsWith("page.tsx")).map((file) => join(file, ".."));
const label = (dir: string) => relative(APP_DIR, dir).replaceAll("\\", "/") || "(root)";

function declared(dir: string): string | null {
  const file = join(dir, "ad-class.ts");
  if (!existsSync(file)) return null;
  return DECLARATION.exec(readFileSync(file, "utf8"))?.[1] ?? null;
}

describe("route ad classes", () => {
  it("finds the pages", () => {
    expect(pageDirs.length).toBeGreaterThan(100);
  });

  it("requires an explicit, valid adClass next to every page.tsx", () => {
    const missing = pageDirs.filter((dir) => declared(dir) === null).map(label);
    expect(missing).toEqual([]);
    const invalid = pageDirs.filter((dir) => !isPageClass(declared(dir))).map(label);
    expect(invalid).toEqual([]);
  });

  it("requires a class for the root 404 page", () => {
    expect(isPageClass(declared(APP_DIR))).toBe(true);
    expect(declared(APP_DIR)).toBe("utility_public");
  });

  it("never lets a page page.tsx export adClass itself (Next rejects unknown page exports)", () => {
    const offenders = files
      .filter((file) => file.endsWith("page.tsx"))
      .filter((file) => /export const adClass\b/.test(readFileSync(file, "utf8")))
      .map((file) => label(join(file, "..")));
    expect(offenders).toEqual([]);
  });

  it("keeps the sensitive surfaces out of every servable class", () => {
    const classOf = (path: string) => declared(join(APP_DIR, path));
    // Results, history, chat, account, admin, legal, capture: never serve.
    for (const path of [
      "(app)/(shell)/analyze/[id]",
      "(app)/(shell)/analyze/history",
      "(app)/(shell)/ai",
      "(app)/(shell)/ai/[chatId]",
      "(app)/(shell)/account",
      "(app)/(shell)/billing",
      "(app)/(shell)/rewards",
      "admin",
      "admin/billing/orders",
      "(marketing)/privacy",
      "(marketing)/terms",
      "capture/[token]",
    ]) {
      expect(canServeOnClass(classOf(path) as (typeof PAGE_CLASSES)[number]), path).toBe(false);
    }
    // Conversion pages never serve either.
    for (const path of [
      "(marketing)/pricing",
      "(auth)/register",
      "(auth)/login",
      "(auth)/join/[slug]",
      "(app)/(shell)/checkout",
      "(app)/(shell)/billing/orders/[id]",
    ]) {
      expect(classOf(path), path).toBe("conversion");
    }
    expect(NEVER_SERVE_CLASSES).toEqual(["conversion", "app_sensitive"]);
  });

  it("puts the dashboard and the analyze start screen in app_neutral and nothing else under /analyze", () => {
    const appNeutral = pageDirs.filter((dir) => declared(dir) === "app_neutral").map(label);
    expect(appNeutral.sort()).toEqual(["(app)/(shell)/analyze", "(app)/(shell)/dashboard"]);
  });

  it("serves the marketing class only on the public marketing pages", () => {
    for (const dir of pageDirs.filter((candidate) => declared(candidate) === "marketing")) {
      expect(label(dir), label(dir)).toMatch(/^\(marketing\)/);
    }
  });
});
