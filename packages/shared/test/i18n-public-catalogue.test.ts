import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ar } from "../src/i18n/ar.js";
import { en } from "../src/i18n/en.js";
import { PUBLIC_MESSAGE_KEYS, t as publicT } from "../src/i18n/public.js";

const WEB_SRC = fileURLToPath(new URL("../../../apps/web/src", import.meta.url));
const UI_SRC = fileURLToPath(new URL("../../ui/src", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

// Every web or UI file that opted into the public catalogue (the client code of the public routes).
const consumers = [...sourceFiles(WEB_SRC), ...sourceFiles(UI_SRC)].filter((file) =>
  readFileSync(file, "utf8").includes('"@wasfa/shared/i18n/public"'),
);

describe("public i18n catalogue", () => {
  it("finds the files that use it", () => {
    expect(consumers.length).toBeGreaterThan(10);
  });

  it("holds every key the files that import it use", () => {
    const publicKeys = new Set(PUBLIC_MESSAGE_KEYS);
    const missing: string[] = [];
    for (const file of consumers) {
      const source = readFileSync(file, "utf8");
      // `t("a.b")` calls, plus any string literal that is a catalogue key (keys kept in tables).
      const used = new Set<string>();
      for (const match of source.matchAll(/\bt\(\s*"([\w.]+)"/g)) used.add(match[1] ?? "");
      for (const match of source.matchAll(/"([\w]+(?:\.[\w]+)+)"/g)) {
        const literal = match[1] ?? "";
        if (literal in ar) used.add(literal);
      }
      for (const key of used) {
        if (!publicKeys.has(key))
          missing.push(`${file.replace(/^.*\/(apps|packages)\//, "$1/")}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("answers like the full catalogue for the keys it holds", () => {
    expect(publicT("common.retry")).toBe(ar["common.retry"]);
    expect(publicT("contactHub.open", undefined, "en")).toBe(en["contactHub.open"]);
    expect(publicT("common.errorRef", { ref: "WSF-1" })).toContain("WSF-1");
  });

  it("stays a fraction of the full catalogue (the admin console and app screens are out)", () => {
    expect(PUBLIC_MESSAGE_KEYS.length).toBeLessThan(Object.keys(ar).length / 2);
    expect(PUBLIC_MESSAGE_KEYS).not.toContain("admin.nav.dashboard");
  });
});
