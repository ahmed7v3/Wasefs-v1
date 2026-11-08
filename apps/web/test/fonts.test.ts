import { existsSync } from "node:fs";
import { join } from "node:path";

import { brandingSettingsSchema, settingDefault } from "@wasfa/shared/settings";
import { describe, expect, it } from "vitest";

import { fontPreloadUrls } from "../src/lib/fonts";

describe("branding.font", () => {
  it("defaults to plex, also for stored settings that predate the field", () => {
    expect(settingDefault("branding").font).toBe("plex");
    expect(brandingSettingsSchema.parse({ nameAr: "وصفة" }).font).toBe("plex");
  });

  it("accepts the two families and rejects anything else", () => {
    expect(brandingSettingsSchema.parse({ font: "alan" }).font).toBe("alan");
    expect(brandingSettingsSchema.safeParse({ font: "comic" }).success).toBe(false);
  });
});

describe("fontPreloadUrls", () => {
  it("preloads only the Plex first-paint files for plex", () => {
    expect(fontPreloadUrls("plex")).toEqual([
      "/fonts/v1/plex-arabic-arabic-400.woff2",
      "/fonts/v1/plex-arabic-latin-400.woff2",
      "/fonts/v1/plex-arabic-arabic-700.woff2",
    ]);
  });

  it("preloads only the Alan Sans arabic and latin files for alan", () => {
    expect(fontPreloadUrls("alan")).toEqual([
      "/fonts/v1/alan-sans-arabic.woff2",
      "/fonts/v1/alan-sans-latin.woff2",
    ]);
  });

  it("points at files that exist", () => {
    for (const font of ["plex", "alan"] as const) {
      for (const url of fontPreloadUrls(font)) {
        expect(existsSync(join(__dirname, "../public", url))).toBe(true);
      }
    }
  });
});
