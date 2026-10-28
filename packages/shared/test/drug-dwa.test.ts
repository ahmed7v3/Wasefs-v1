import { describe, expect, it } from "vitest";

import {
  DRUG_IMPORT_PRESETS,
  brandKeyOf,
  drugColumns,
  drugPackText,
  isDwaPlaceholder,
  parseBarcode,
  parseDwaTradeName,
  parsePriceMinor,
  parseUnitsCount,
  presetMapping,
} from "../src/drugs.js";
import { SETTINGS_REGISTRY, medicationsSettingsSchema, settingDefault } from "../src/settings.js";

describe("brandKeyOf", () => {
  it.each([
    ["Flumox 1000mg 15 f.c. tabs", "flumox"],
    ["Flumocin 500mg 8 caps", "flumocin"],
    ["Actifed expectorant syrup 120 ml", "actifed expectorant"],
    ["Guzalin 650 mg / 5ml (orange) syrup 120 ml", "guzalin"],
    ["Limitless lactoferrin 100 mg 30 sachets", "limitless lactoferrin"],
    ["Allzyme max limitless 20 e.c. tab", "allzyme max limitless"],
    ["Panadol 500mg Tablets", "panadol"],
    ["Aaa-9001", "aaa"],
    // Numbers at the start belong to the name: the key stays non-empty and stable.
    ["1 2 3 (one two three) syrup 120 ml", "1 2 3"],
    ["1 2 3 (one two three) 20 f.c.tabs", "1 2 3"],
    ["5-fluorouracil-ebewe 250mg/5ml i.v. vial", "5 fluorouracil ebewe"],
    // An unclosed parenthesis in the list is dropped with what follows it.
    ["Natamet 5% eye drops 5 ml (illegal import", "natamet"],
  ])("%s -> %s", (name, key) => {
    expect(brandKeyOf(name)).toBe(key);
  });

  it("keeps the first word even when it looks like a pack word", () => {
    expect(brandKeyOf("Film something 10 pcs")).toBe("film something");
    expect(brandKeyOf("Tablets")).toBe("tablets");
  });

  it("is empty only for an empty name", () => {
    expect(brandKeyOf("")).toBe("");
    expect(brandKeyOf("(only parens)")).toBe("");
  });
});

describe("drugPackText / parseDwaTradeName", () => {
  it.each([
    ["Flumox 1000mg 15 f.c. tabs", "15 f.c. tabs"],
    ["Actifed syrup 120ml", "120ml"],
    ["Guzalin 650 mg / 5ml (orange) syrup 120 ml", "120 ml"],
    ["Limitless lactoferrin 100 mg 30 sachets", "30 sachets"],
    ["1 2 3 (one two three) 20 f.c.tabs", "20 f.c. tabs"],
    ["Gold standard 100% whey protein 907 gm", "907 gm"],
    // A strength at the end is not a pack.
    ["Panadol 500 mg", null],
    ["Amoxil 250mg/5ml", null],
    ["Aaa-9001", null],
    ["Panadol", null],
  ])("%s -> %s", (name, pack) => {
    expect(drugPackText(name)).toBe(pack);
  });

  it("reads the form out of glued abbreviations", () => {
    expect(parseDwaTradeName("1 2 3 (one two three) 20 f.c.tabs")).toEqual({
      brandEn: "1 2 3 (one two three) 20 f.c.tabs",
      form: "tablet",
      packText: "20 f.c. tabs",
    });
    expect(parseDwaTradeName("  Actifed   syrup 120 ml ").form).toBe("syrup");
    expect(parseDwaTradeName("Aaa-9001").form).toBeNull();
  });
});

describe("isDwaPlaceholder", () => {
  const empty = { ingredients: "", category: "", company: "", barcode: "" };

  it("flags filler names that carry no data", () => {
    expect(isDwaPlaceholder("Aaa-6515", empty)).toBe(true);
    expect(isDwaPlaceholder(" Bb-1 ", empty)).toBe(true);
  });

  it("keeps filler-looking names that have any data, and real names", () => {
    for (const key of ["ingredients", "category", "company", "barcode"] as const) {
      expect(isDwaPlaceholder("Aaa-6515", { ...empty, [key]: "x" })).toBe(false);
    }
    expect(isDwaPlaceholder("Aaa6515", empty)).toBe(false);
    expect(isDwaPlaceholder("Flumox-500", empty)).toBe(false);
    expect(isDwaPlaceholder("Panadol 500", empty)).toBe(false);
  });
});

describe("parsePriceMinor", () => {
  it("converts decimal currency to integer minor units", () => {
    expect(parsePriceMinor("40")).toBe(4000);
    expect(parsePriceMinor("6.25")).toBe(625);
    expect(parsePriceMinor("12.5")).toBe(1250);
    expect(parsePriceMinor("0.1")).toBe(10);
    // Floating point: 1.005 * 100 = 100.49999999999999.
    expect(parsePriceMinor("19.99")).toBe(1999);
  });

  it("treats zero, junk and out-of-range values as no price", () => {
    for (const text of ["0", "0.00", "", "abc", "-5", "1e3", "3000000000"]) {
      expect(parsePriceMinor(text)).toBeNull();
    }
  });
});

describe("parseBarcode", () => {
  it("keeps one half of a code written twice", () => {
    expect(parseBarcode("62210000032956221000003295")).toBe("6221000003295");
  });

  it("keeps a single 8-14 digit code and strips non-digits", () => {
    expect(parseBarcode("6221000003295")).toBe("6221000003295");
    expect(parseBarcode("6221 0000 03295")).toBe("6221000003295");
    expect(parseBarcode("12345678")).toBe("12345678");
  });

  it("does not halve different halves and rejects other lengths", () => {
    expect(parseBarcode("62210000032956221000003296")).toBeNull();
    expect(parseBarcode("")).toBeNull();
    expect(parseBarcode("1234567")).toBeNull();
    expect(parseBarcode("123456789012345")).toBeNull();
  });
});

describe("parseUnitsCount", () => {
  it("accepts positive integers only", () => {
    expect(parseUnitsCount("20")).toBe(20);
    expect(parseUnitsCount(" 1 ")).toBe(1);
    for (const text of ["0", "", "-1", "2.5", "x"]) expect(parseUnitsCount(text)).toBeNull();
  });
});

describe("drugColumns brand family", () => {
  it("derives brandKey from the full name", () => {
    expect(drugColumns({ brandEn: "Flumox 1000mg 15 f.c. tabs" })).toMatchObject({
      brandKey: "flumox",
      normalizedEn: "flumox 15 f.c",
      strengthText: "1000 mg",
    });
  });
});

describe("DWA preset", () => {
  it("maps the dwaprices keys and ignores the Arabic junk and the link", () => {
    const headers = [
      "id",
      "trade_name_en",
      "trade_name_ar",
      "active_ingredient",
      "category",
      "company",
      "current_price",
      "old_price",
      "concentration",
      "units_count",
      "barcode",
      "details_url",
    ];
    expect(presetMapping("dwaprices", headers)).toEqual({
      id: "sourceRef",
      trade_name_en: "brandEn",
      active_ingredient: "ingredients",
      category: "category",
      company: "manufacturer",
      current_price: "price",
      old_price: "oldPrice",
      concentration: "strength",
      units_count: "unitsCount",
      barcode: "barcode",
    });
    expect(Object.keys(DRUG_IMPORT_PRESETS.dwaprices)).not.toContain("trade_name_ar");
  });
});

describe("medications settings", () => {
  it("has the documented defaults", () => {
    expect(settingDefault("medications")).toEqual({
      enabled: true,
      mode: "hybrid",
      similarityFloor: 0.3,
      acceptScore: 0.85,
      reviewScore: 0.5,
      minMargin: 0.06,
      strengthBonus: 0.1,
      strengthConflictPenalty: 0.15,
      formBonus: 0.05,
      maxCandidates: 5,
      useAlternatives: true,
      learnAutoApproveAt: 3,
      logUnmatched: true,
      chatCards: { enabled: true, max: 3 },
      waTools: true,
      search: { enabled: true, showPrices: true },
    });
    expect(SETTINGS_REGISTRY.medications.visibility).toBe("admin");
  });

  it("keeps reviewScore under acceptScore and the numbers in range", () => {
    expect(medicationsSettingsSchema.safeParse({ reviewScore: 0.9 }).success).toBe(false);
    expect(medicationsSettingsSchema.safeParse({ acceptScore: 0.4 }).success).toBe(false);
    expect(
      medicationsSettingsSchema.safeParse({ acceptScore: 0.6, reviewScore: 0.4 }).success,
    ).toBe(true);
    for (const bad of [
      { similarityFloor: 1.1 },
      { maxCandidates: 0 },
      { maxCandidates: 11 },
      { learnAutoApproveAt: 21 },
      { learnAutoApproveAt: 1.5 },
      { chatCards: { max: 6 } },
      { mode: "db_only" },
    ]) {
      expect(medicationsSettingsSchema.safeParse(bad).success).toBe(false);
    }
  });
});
