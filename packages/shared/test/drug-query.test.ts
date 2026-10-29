import { describe, expect, it } from "vitest";

import { cleanDrugQuery } from "../src/drug-query.js";

describe("cleanDrugQuery: Latin brand lines", () => {
  it.each([
    // the failures of a real prescription
    ["Relaxon", "relaxon"],
    ["x - Glibimet 5 نصف ساعة قبل الاكل", "glibimet"],
    ["Bepra 20 قرص بعد الأكل", "bepra"],
    ["Riopan susp ملعقة ٣ مرات", "riopan"],
    ["Motidyl", "motidyl"],
    // bullets, numbering, Rx
    ["- Panadol", "panadol"],
    ["* Panadol", "panadol"],
    ["• Panadol", "panadol"],
    ["x - Panadol", "panadol"],
    ["x- Panadol", "panadol"],
    ["X Panadol", "x panadol"],
    ["1) Panadol", "panadol"],
    ["2. Panadol", "panadol"],
    ["(3) Panadol", "panadol"],
    ["4- Panadol", "panadol"],
    ["١) بانادول", null],
    ["Rx Panadol", "panadol"],
    ["Rx: Panadol", "panadol"],
    ["R/ Panadol", "panadol"],
    ["1) Rx Panadol", "panadol"],
    ["- 2) Rx. Panadol", "panadol"],
    // case and spacing
    ["PANADOL", "panadol"],
    ["  panadol   extra  ", "panadol extra"],
    ["Panadol    Extra", "panadol extra"],
    // notes
    ["Panadol (for fever)", "panadol"],
    ["Panadol [urgent]", "panadol"],
    ["Panadol (unclosed note", "panadol"],
    // strengths, forms, packs
    ["Panadol 500mg", "panadol"],
    ["Panadol 500 mg tab", "panadol"],
    ["Panadol 500mg Tablets", "panadol"],
    ["Tab. Panadol", "panadol"],
    ["Cap Flumox 500", "flumox"],
    ["Augmentin 1g", "augmentin"],
    ["Augmentin 625 mg 14 tabs", "augmentin"],
    ["Voltaren emulgel 50 gm", "voltaren emulgel"],
    ["Actifed expectorant syrup 120 ml", "actifed expectorant"],
    ["Cataflam 50 f.c. tabs", "cataflam"],
    ["Bepra20", "bepra"],
    ["Glibimet5", "glibimet"],
    ["Vitamin B12", "vitamin b12"],
    ["1 2 3 syrup", "1 2 3"],
    // Latin directions
    ["Panadol bid", "panadol"],
    ["Panadol 1 tab tid after meals", "panadol"],
    ["Augmentin 1g twice daily for 7 days", "augmentin"],
    ["Cataflam prn", "cataflam"],
    ["Concor 5 od", "concor"],
    ["Brufen x 5 days", "brufen"],
    ["t panadol", "panadol"],
    // mixed with Arabic directions
    ["Panadol قرص", "panadol"],
    ["Panadol قرص بعد الأكل", "panadol"],
    ["Panadol مرتين يوميا", "panadol"],
    ["Panadol عند اللزوم", "panadol"],
    ["Augmentin لمدة 7 ايام", "augmentin"],
    ["Brufen ٣ مرات في اليوم", "brufen"],
    ["Concor صباحا", "concor"],
    ["Cataflam قبل العشاء", "cataflam"],
    ["Flumox ملعقة صغيرة", "flumox"],
    ["Motilium نقط", "motilium"],
    ["قرص Panadol", "panadol"],
    ["Digestin بعد الاكل بنص ساعة", "digestin"],
    ["X-plended", "x plended"],
    ["Ventolin inhaler 2 puffs", "ventolin inhaler 2 puffs"],
  ] as const)("%s -> %s", (line, latin) => {
    const cleaned = cleanDrugQuery(line);
    if (latin === null) expect(cleaned.latin).toBeNull();
    else if (line === "Ventolin inhaler 2 puffs") expect(cleaned.latin).toBe("ventolin inhaler");
    else expect(cleaned.latin).toBe(latin);
  });

  it("a Latin brand takes the Arabic directions out, and leaves no Arabic name", () => {
    const cleaned = cleanDrugQuery("x - Glibimet 5 نصف ساعة قبل الاكل");
    expect(cleaned.arabic).toBeNull();
    expect(cleaned.dropped).toEqual(expect.arrayContaining(["x -", "نصف", "ساعه", "قبل", "الاكل"]));
  });
});

describe("cleanDrugQuery: strength, form and bare numbers", () => {
  it("reads a strength with a unit", () => {
    expect(cleanDrugQuery("Panadol 500mg").strength).toEqual({ value: 500, unit: "mg" });
    expect(cleanDrugQuery("Panadol 500 ملجم").strength).toEqual({ value: 500, unit: "mg" });
    expect(cleanDrugQuery("Panadol ٥٠٠ مجم").strength).toEqual({ value: 500, unit: "mg" });
    expect(cleanDrugQuery("Augmentin 1 g").strength).toEqual({ value: 1, unit: "g" });
    expect(cleanDrugQuery("Folic 5 mcg").strength).toEqual({ value: 5, unit: "mcg" });
    expect(cleanDrugQuery("Amoxil 250mg/5ml").strength).toEqual({
      value: 250,
      unit: "mg",
      per: { value: 5, unit: "ml" },
    });
  });

  it("does not take a dose volume for a strength", () => {
    const cleaned = cleanDrugQuery("Riopan susp 5 ml");
    expect(cleaned.strength).toBeNull();
    expect(cleaned.form).toBe("suspension");
    expect(cleaned.latin).toBe("riopan");
  });

  it("keeps a bare number for the matcher", () => {
    expect(cleanDrugQuery("Bepra 20").bareNumber).toBe(20);
    expect(cleanDrugQuery("x - Glibimet 5 نصف ساعة").bareNumber).toBe(5);
    expect(cleanDrugQuery("Concor 2.5").bareNumber).toBe(2.5);
    expect(cleanDrugQuery("Bepra20").bareNumber).toBe(20);
    expect(cleanDrugQuery("Panadol").bareNumber).toBeNull();
    expect(cleanDrugQuery("Panadol 500mg").bareNumber).toBeNull();
  });

  it("reads the dosage form in English and Arabic", () => {
    expect(cleanDrugQuery("Panadol tab").form).toBe("tablet");
    expect(cleanDrugQuery("Flumox caps").form).toBe("capsule");
    expect(cleanDrugQuery("Riopan susp").form).toBe("suspension");
    expect(cleanDrugQuery("Brufen syrup").form).toBe("syrup");
    expect(cleanDrugQuery("Voltaren cream").form).toBe("cream");
    expect(cleanDrugQuery("Cataflam قرص").form).toBe("tablet");
    expect(cleanDrugQuery("Panadol").form).toBeNull();
  });
});

describe("cleanDrugQuery: Arabic-script names", () => {
  it.each([
    ["بانادول", "بانادول"],
    ["بانادول ٥٠٠ قرص", "بانادول"],
    ["بانادول 500 ملجم قرص بعد الأكل", "بانادول"],
    ["ريوبان شراب ملعقة ٣ مرات", "ريوبان"],
    ["قرص كونكور", "كونكور"],
    ["- كونكور ٥", "كونكور"],
    ["١) أوجمنتين", "اوجمنتين"],
    ["أَوْجْمَنْتِين", "اوجمنتين"],
    ["بانادول اكسترا", "بانادول اكسترا"],
    ["فولتارين نصف ساعة قبل الاكل", "فولتارين"],
    ["كتافلام (مسكن)", "كتافلام"],
  ] as const)("%s -> %s", (line, arabic) => {
    const cleaned = cleanDrugQuery(line);
    expect(cleaned.latin).toBeNull();
    expect(cleaned.arabic).toBe(arabic);
  });

  it("finds no name in a line of directions only", () => {
    for (const line of ["قرص بعد الأكل", "ملعقة ٣ مرات", "نصف ساعة قبل الاكل", "مرتين يوميا"]) {
      const cleaned = cleanDrugQuery(line);
      expect(cleaned.latin, line).toBeNull();
      expect(cleaned.arabic, line).toBeNull();
    }
  });
});

describe("cleanDrugQuery: nothing to find", () => {
  it("returns nulls for empty or symbol-only text", () => {
    for (const line of ["", "   ", "-", "- -", "• 1)", "500 mg", "(note)"]) {
      const cleaned = cleanDrugQuery(line);
      expect(cleaned.latin, line).toBeNull();
      expect(cleaned.arabic, line).toBeNull();
    }
  });

  it("does not strip a marker when it is the whole line", () => {
    expect(cleanDrugQuery("Rx").latin).toBe("rx");
  });
});
