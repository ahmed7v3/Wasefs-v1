import { describe, expect, it } from "vitest";

import {
  alternates,
  localeDir,
  localeFromPath,
  localizedPath,
  ogLocale,
  stripLocale,
} from "../src/lib/locale";

describe("localeFromPath", () => {
  it("treats /en and everything below it as English", () => {
    expect(localeFromPath("/en")).toBe("en");
    expect(localeFromPath("/en/")).toBe("en");
    expect(localeFromPath("/en/pricing")).toBe("en");
    expect(localeFromPath("/en?x=1")).toBe("en");
    expect(localeFromPath("/en/contact?topic=support#form")).toBe("en");
  });

  it("treats every other path as Arabic, including look-alikes", () => {
    expect(localeFromPath("/")).toBe("ar");
    expect(localeFromPath("")).toBe("ar");
    expect(localeFromPath("/pricing")).toBe("ar");
    expect(localeFromPath("/enx")).toBe("ar");
    expect(localeFromPath("/english/pricing")).toBe("ar");
    expect(localeFromPath("/?next=/en")).toBe("ar");
    expect(localeFromPath("/pricing/en")).toBe("ar");
  });
});

describe("stripLocale", () => {
  it("removes the /en prefix and any query", () => {
    expect(stripLocale("/en")).toBe("/");
    expect(stripLocale("/en/")).toBe("/");
    expect(stripLocale("/en/pricing")).toBe("/pricing");
    expect(stripLocale("/en/pricing?period=12")).toBe("/pricing");
    expect(stripLocale("/en?x=1")).toBe("/");
  });

  it("leaves Arabic paths alone (minus the query)", () => {
    expect(stripLocale("/")).toBe("/");
    expect(stripLocale("/pricing?x=1")).toBe("/pricing");
    expect(stripLocale("/enx")).toBe("/enx");
  });
});

describe("localizedPath", () => {
  it("prefixes English and leaves Arabic bare", () => {
    expect(localizedPath("/", "en")).toBe("/en");
    expect(localizedPath("/pricing", "en")).toBe("/en/pricing");
    expect(localizedPath("/", "ar")).toBe("/");
    expect(localizedPath("/pricing", "ar")).toBe("/pricing");
  });

  it("converts from either language and never doubles the prefix", () => {
    expect(localizedPath("/en/pricing", "en")).toBe("/en/pricing");
    expect(localizedPath("/en/pricing", "ar")).toBe("/pricing");
    expect(localizedPath("/en", "ar")).toBe("/");
    expect(localizedPath("/en/contact?x=1", "ar")).toBe("/contact");
  });
});

describe("localeDir and ogLocale", () => {
  it("maps each locale to its direction and Open Graph locale", () => {
    expect(localeDir("ar")).toBe("rtl");
    expect(localeDir("en")).toBe("ltr");
    expect(ogLocale("ar")).toBe("ar_AR");
    expect(ogLocale("en")).toBe("en_US");
  });
});

describe("alternates", () => {
  it("lists both versions and an Arabic x-default", () => {
    expect(alternates("/pricing", "/en/pricing")).toEqual({
      ar: "/pricing",
      en: "/en/pricing",
      "x-default": "/pricing",
    });
  });

  it("is null for a page without an English version", () => {
    expect(alternates("/privacy", null)).toBeNull();
  });
});
