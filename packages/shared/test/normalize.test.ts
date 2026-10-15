import { describe, expect, it } from "vitest";

import {
  DRUG_IMPORT_PRESETS,
  DRUG_MATCH_ACCEPT,
  DRUG_MATCH_VERIFY,
  classifyMatch,
  drugColumns,
  drugImportKeys,
  DRUG_IMPORT_LIST_SEPARATOR,
  presetMapping,
} from "../src/drugs.js";
import {
  normalizeArabic,
  normalizeDrugName,
  parseStrength,
  strengthMicro,
} from "../src/normalize.js";

describe("normalizeArabic", () => {
  it.each([
    ["أموكسيسيللين", "اموكسيسيللين"],
    ["إبوبروفين", "ابوبروفين"],
    ["آمبولة", "امبوله"],
    ["ٱلله", "الله"],
    ["مصطفى", "مصطفي"],
    ["قطرة", "قطره"],
    ["مؤتمر", "موتمر"],
    ["رئيس", "رييس"],
    ["بَنَادُول", "بنادول"],
    ["بنـــادول", "بنادول"],
    ["خُلَاصَةٌ", "خلاصه"],
    ["٥٠٠ ملجم", "500 ملجم"],
    ["۱۲٫۵", "12٫5"],
    ["  بنادول   اكسترا  ", "بنادول اكسترا"],
    ["Panadol  500", "Panadol 500"],
    ["", ""],
  ])("%j -> %j", (input, expected) => {
    expect(normalizeArabic(input)).toBe(expected);
  });

  it("is idempotent", () => {
    const once = normalizeArabic("أُقْرَاص ٥٠٠ مِلْجم");
    expect(normalizeArabic(once)).toBe(once);
  });
});

describe("parseStrength", () => {
  it.each([
    ["Panadol 500mg", { value: 500, unit: "mg" }],
    ["500 MG", { value: 500, unit: "mg" }],
    ["٥٠٠ ملجم", { value: 500, unit: "mg" }],
    ["500 مجم", { value: 500, unit: "mg" }],
    ["500 ملغ", { value: 500, unit: "mg" }],
    ["1 g", { value: 1, unit: "g" }],
    ["1 gm", { value: 1, unit: "g" }],
    ["2 جم", { value: 2, unit: "g" }],
    ["100 mcg", { value: 100, unit: "mcg" }],
    ["100µg", { value: 100, unit: "mcg" }],
    ["100 μg", { value: 100, unit: "mcg" }],
    ["100 ug", { value: 100, unit: "mcg" }],
    ["100 ميكروجرام", { value: 100, unit: "mcg" }],
    ["5 ml", { value: 5, unit: "ml" }],
    ["120 مل", { value: 120, unit: "ml" }],
    ["0.5%", { value: 0.5, unit: "%" }],
    ["0,5 %", { value: 0.5, unit: "%" }],
    ["1,000 mg", { value: 1000, unit: "mg" }],
    ["1000 IU", { value: 1000, unit: "iu" }],
    ["1000 I.U.", { value: 1000, unit: "iu" }],
    ["١٠٠٠ وحدة", { value: 1000, unit: "iu" }],
    ["250mg/5ml", { value: 250, unit: "mg", per: { value: 5, unit: "ml" } }],
    ["125 mg / 5 ml", { value: 125, unit: "mg", per: { value: 5, unit: "ml" } }],
    ["100 mg/ml", { value: 100, unit: "mg", per: { value: 1, unit: "ml" } }],
    ["paracetamol 500mg caffeine 65mg", { value: 500, unit: "mg" }],
  ])("%j", (input, expected) => {
    expect(parseStrength(input)).toEqual(expected);
  });

  it.each(["Panadol", "500", "500 mgx", "B12", "v2.5 mgs", "", "10 tablets"])(
    "finds nothing in %j",
    (input) => {
      expect(parseStrength(input)).toBeNull();
    },
  );

  it("turns a value into the integer micros the database stores", () => {
    expect(strengthMicro(500)).toBe(500_000_000);
    expect(strengthMicro(0.1)).toBe(100_000);
    expect(strengthMicro(0.35)).toBe(350_000);
  });
});

describe("normalizeDrugName", () => {
  it.each([
    ["Panadol 500mg Tablets", { name: "panadol", form: "tablet", lang: "en" }],
    ["PANADOL EXTRA tab.", { name: "panadol extra", form: "tablet", lang: "en" }],
    ["Augmentin 1g Tabs", { name: "augmentin", form: "tablet", lang: "en" }],
    ["Amoxil 250mg/5ml Susp.", { name: "amoxil", form: "suspension", lang: "en" }],
    ["Brufen Syrup 100mg/5ml", { name: "brufen", form: "syrup", lang: "en" }],
    ["Voltaren Emulgel", { name: "voltaren emulgel", form: null, lang: "en" }],
    ["Cataflam Amp.", { name: "cataflam", form: "ampoule", lang: "en" }],
    ["Rocephin 1g Vial", { name: "rocephin", form: "vial", lang: "en" }],
    ["Dexa Inj", { name: "dexa", form: "injection", lang: "en" }],
    ["Fucidin Cream 2%", { name: "fucidin", form: "cream", lang: "en" }],
    ["Betadine Oint.", { name: "betadine", form: "ointment", lang: "en" }],
    ["Otrivin Nasal Spray", { name: "otrivin nasal", form: "spray", lang: "en" }],
    ["Tobrex Eye Drops", { name: "tobrex", form: "eye drops", lang: "en" }],
    ["Otocin Ear Drops 5ml", { name: "otocin", form: "ear drops", lang: "en" }],
    ["Vibrocil Drops", { name: "vibrocil", form: "drops", lang: "en" }],
    ["Calcium Effervescent", { name: "calcium", form: "effervescent", lang: "en" }],
    ["Cetal Sachets", { name: "cetal sachets", form: null, lang: "en" }],
    ["Dulcolax Supp", { name: "dulcolax", form: "suppository", lang: "en" }],
    ["Co-Amoxiclav (500/125)", { name: "co amoxiclav 500 125", form: null, lang: "en" }],
    ["Vitamin C 0.5%", { name: "vitamin c", form: null, lang: "en" }],
    ["بنادول اكسترا ٥٠٠ ملجم أقراص", { name: "بنادول اكسترا", form: "tablet", lang: "ar" }],
    ["أوجمنتين ١ جم", { name: "اوجمنتين", form: null, lang: "ar" }],
    ["كتافلام أمبول", { name: "كتافلام", form: "ampoule", lang: "ar" }],
    ["فولتارين جل", { name: "فولتارين", form: "gel", lang: "ar" }],
    ["قطرة ترايدين", { name: "ترايدين", form: "drops", lang: "ar" }],
    ["اوجمنتين شراب", { name: "اوجمنتين", form: "syrup", lang: "ar" }],
    ["لبوس فوار", { name: "لبوس فوار", form: "suppository", lang: "ar" }],
    // Only a form word: the name is kept so it is never empty.
    ["Tablets", { name: "tablets", form: "tablet", lang: "en" }],
    ["  ", { name: "", form: null, lang: "en" }],
  ])("%j", (input, expected) => {
    const result = normalizeDrugName(input);
    expect({ name: result.name, form: result.form, lang: result.lang }).toEqual(expected);
  });

  it("returns the strength it took out of the name", () => {
    expect(normalizeDrugName("Panadol 500mg tab").strength).toEqual({ value: 500, unit: "mg" });
    expect(normalizeDrugName("Panadol").strength).toBeNull();
  });

  it("keeps % and decimal points but drops other punctuation", () => {
    expect(normalizeDrugName("Dr. Smith's Cough-Mix #2").name).toBe("dr smith s cough mix 2");
    expect(normalizeDrugName("Saline 0.9 NaCl").name).toBe("saline 0.9 nacl");
  });
});

describe("classifyMatch", () => {
  const candidate = (score: number, strength: "match" | "conflict" | "unknown") => ({
    score,
    explanation: {
      nameScore: score,
      matchedOn: "brand" as const,
      strength,
      form: "unknown" as const,
    },
  });

  it.each([
    [1, "match", "accept"],
    [DRUG_MATCH_ACCEPT, "unknown", "accept"],
    [0.95, "conflict", "verify"],
    [DRUG_MATCH_ACCEPT - 0.01, "match", "verify"],
    [DRUG_MATCH_VERIFY, "unknown", "verify"],
    [DRUG_MATCH_VERIFY - 0.01, "match", "unmatched"],
  ] as const)("score %s with strength %s -> %s", (score, strength, expected) => {
    expect(classifyMatch(candidate(score, strength))).toBe(expected);
  });

  it("never auto-accepts an ingredient-only match", () => {
    const c = candidate(1, "match");
    expect(
      classifyMatch({ ...c, explanation: { ...c.explanation, matchedOn: "ingredient" } }),
    ).toBe("verify");
  });

  it("is unmatched without a candidate", () => {
    expect(classifyMatch(undefined)).toBe("unmatched");
  });
});

describe("presetMapping", () => {
  it("maps the headers a file has, ignoring case and spacing", () => {
    const mapping = presetMapping("sfda", ["Trade Name", "Scientific Name", "STRENGTH", "Other"]);
    expect(mapping).toEqual({
      "Trade Name": "brandEn",
      "Scientific Name": "ingredients",
      STRENGTH: "strength",
    });
  });

  it("reads the public SFDA drugs-list export (snake_case headers, extra columns ignored)", () => {
    const mapping = presetMapping("sfda", [
      "name",
      "trade_name",
      "strength",
      "dosage_form",
      "price_sar",
      "sfda_record_id",
      "detail_url",
    ]);
    expect(mapping).toEqual({
      name: "ingredients",
      trade_name: "brandEn",
      strength: "strength",
      dosage_form: "form",
    });
  });

  it("splits a comma list of ingredients, but not a comma inside brackets", () => {
    const split = (text: string) => text.split(DRUG_IMPORT_LIST_SEPARATOR).map((p) => p.trim());
    expect(split("SODIUM CHLORIDE,POTASSIUM CHLORIDE,DEXTROSE")).toEqual([
      "SODIUM CHLORIDE",
      "POTASSIUM CHLORIDE",
      "DEXTROSE",
    ]);
    expect(split("INSULIN (HUMAN, RECOMBINANT)")).toEqual(["INSULIN (HUMAN, RECOMBINANT)"]);
  });

  it("gives a field to one column only", () => {
    const mapping = presetMapping("eda", ["Trade Name", "Brand Name"]);
    expect(Object.values(mapping)).toEqual(["brandEn"]);
  });

  it("has a preset for every source", () => {
    for (const source of ["eda", "sfda", "manual", "other"] as const) {
      expect(Object.keys(DRUG_IMPORT_PRESETS[source]).length).toBeGreaterThan(0);
    }
  });
});

describe("drugColumns", () => {
  it("derives the searchable columns and keeps strength and form out of the name", () => {
    expect(drugColumns({ brandEn: " Panadol 500mg Tablets ", brandAr: "بنادول  أقراص" })).toEqual({
      brandEn: "Panadol 500mg Tablets",
      brandAr: "بنادول أقراص",
      normalizedEn: "panadol",
      normalizedAr: "بنادول",
      form: "tablet",
      strengthText: "500 mg",
      strengthValueMicro: 500_000_000,
      strengthUnit: "mg",
    });
  });

  it("prefers the separate strength and form over what the name carries", () => {
    const columns = drugColumns({
      brandEn: "Amoxil 125mg",
      form: "Susp.",
      strengthText: "250 mg/5 ml",
    });
    expect(columns).toMatchObject({
      normalizedEn: "amoxil",
      form: "suspension",
      strengthText: "250 mg/5 ml",
      strengthValueMicro: 250_000_000,
      strengthUnit: "mg",
    });
  });

  it("keeps an unparseable strength as text only", () => {
    expect(drugColumns({ brandEn: "Odd", strengthText: "as directed" })).toMatchObject({
      strengthText: "as directed",
      strengthValueMicro: null,
      strengthUnit: null,
    });
  });
});

describe("drugImportKeys", () => {
  it("names every key after the batch", () => {
    const keys = drugImportKeys("abc");
    expect(Object.values(keys)).toEqual([
      "drugimport:abc",
      "drugimport:abc:progress",
      "drugimport:abc:report",
      "drugimport:abc:busy",
    ]);
  });
});
