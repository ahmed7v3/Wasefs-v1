import { describe, expect, it } from "vitest";

import {
  displayName,
  extractDose,
  formKey,
  formLabel,
  sanitizeExtraction,
  sanitizeItem,
  type SanitizableItem,
} from "../src/rx-sanitize.js";

const blank: SanitizableItem = {
  name: null,
  strength: null,
  form: null,
  dose: null,
  frequency: null,
  notes: null,
};

const run = (patch: Partial<SanitizableItem>) => sanitizeItem({ ...blank, ...patch });
type Fields = Pick<SanitizableItem, "name" | "strength" | "form" | "dose" | "frequency" | "notes">;
const pick = (item: Fields): Fields => ({
  name: item.name,
  strength: item.strength,
  form: item.form,
  dose: item.dose,
  frequency: item.frequency,
  notes: item.notes,
});

describe("the four lines of the production failure", () => {
  it("Relaxon 30 caps", () => {
    expect(pick(run({ name: "Relaxon 30 caps" }))).toEqual({
      ...blank,
      name: "Relaxon",
      strength: "30",
      form: "caps",
    });
  });

  it("directions and a bullet in front of Glibimet 5", () => {
    expect(pick(run({ name: "نصف ساعة قبل الاكل x - Glibimet 5" }))).toEqual({
      ...blank,
      name: "Glibimet",
      strength: "5",
      frequency: "نصف ساعة قبل الاكل",
    });
  });

  it("Bepra 20 with the dose unit in the directions", () => {
    expect(pick(run({ name: "قرص قبل العشاء - Bepra 20" }))).toEqual({
      ...blank,
      name: "Bepra",
      strength: "20",
      dose: "قرص",
      frequency: "قبل العشاء",
    });
  });

  it("Riopan susp with a spoon", () => {
    expect(pick(run({ name: "ملعقة بعد الاكل - Riopan susp" }))).toEqual({
      ...blank,
      name: "Riopan",
      form: "susp",
      dose: "ملعقة",
      frequency: "بعد الاكل",
    });
  });

  it("Motidyl alone is left as it is", () => {
    expect(pick(run({ name: "Motidyl" }))).toEqual({ ...blank, name: "Motidyl" });
  });
});

describe("list markers", () => {
  const names: [string, string][] = [
    ["- Augmentin", "Augmentin"],
    ["-Augmentin", "Augmentin"],
    ["• Augmentin", "Augmentin"],
    ["* Augmentin", "Augmentin"],
    ["x - Augmentin", "Augmentin"],
    ["x- Augmentin", "Augmentin"],
    ["X Augmentin", "X Augmentin"],
    ["Rx Augmentin", "Augmentin"],
    ["Rx: Augmentin", "Augmentin"],
    ["℞ Augmentin", "Augmentin"],
    ["R/ Augmentin", "Augmentin"],
    ["1. Augmentin", "Augmentin"],
    ["2) Augmentin", "Augmentin"],
    ["3 - Augmentin", "Augmentin"],
    ["١. Augmentin", "Augmentin"],
    ["- 1. Augmentin", "Augmentin"],
    ["  Augmentin  ", "Augmentin"],
    ["Augmentin‏", "Augmentin"],
  ];
  it.each(names)("%s -> %s", (input, expected) => {
    expect(run({ name: input }).name).toBe(expected);
  });

  it("never strips a digit that belongs to the name", () => {
    expect(run({ name: "5-FU" }).name).toBe("5-FU");
    expect(run({ name: "Vitamin B12" }).name).toBe("Vitamin B12");
  });
});

describe("strength and form leave the name", () => {
  const cases: [input: string, name: string, strength: string | null, form: string | null][] = [
    ["Augmentin 1g", "Augmentin", "1g", null],
    ["Augmentin 1 g", "Augmentin", "1 g", null],
    ["Panadol 500mg", "Panadol", "500mg", null],
    ["Paracetamol 500 mg tab", "Paracetamol", "500 mg", "tab"],
    ["Paracetamol 500 mg tabs", "Paracetamol", "500 mg", "tabs"],
    ["Cataflam 50 tablets", "Cataflam", "50", "tablets"],
    ["Zyrtec drops", "Zyrtec", null, "drops"],
    ["Flagyl 125 mg/5 ml susp", "Flagyl", "125 mg/5 ml", "susp"],
    ["Ventolin inhaler", "Ventolin", null, "inhaler"],
    ["Voltaren emulgel", "Voltaren emulgel", null, null],
    ["Fucidin cream", "Fucidin", null, "cream"],
    ["Fucidin oint.", "Fucidin", null, "oint"],
    ["Tab. Augmentin 1g", "Augmentin", "1g", "Tab"],
    ["Cap Relaxon", "Relaxon", null, "Cap"],
    ["Syp Zyrtec", "Zyrtec", null, "Syp"],
    ["Amp. Voltaren", "Voltaren", null, "Amp"],
    ["Cetal eff", "Cetal", null, "eff"],
    ["Dolphin 0.5 mg", "Dolphin", "0.5 mg", null],
    ["Concor 2.5", "Concor", "2.5", null],
    ["Vit D3 1000 IU", "Vit D3", "1000 IU", null],
    ["Betadine 10%", "Betadine", "10%", null],
    ["Cipro ١٠٠٠", "Cipro", "١٠٠٠", null],
  ];
  it.each(cases)("%s", (input, name, strength, form) => {
    const out = run({ name: input });
    expect(out.name).toBe(name);
    expect(out.strength).toBe(strength);
    expect(out.form).toBe(form);
  });

  it("does not move a form word that would leave no name", () => {
    expect(run({ name: "Syrup" }).name).toBe("Syrup");
    expect(run({ name: "Tablet" }).form).toBeNull();
  });

  it("keeps what the model already put in the fields", () => {
    const out = run({ name: "Bepra 20", strength: "20 mg" });
    expect(out.name).toBe("Bepra");
    expect(out.strength).toBe("20 mg");
  });

  it("drops a form word that repeats the form field", () => {
    const out = run({ name: "Relaxon caps", form: "capsule" });
    expect(out.name).toBe("Relaxon");
    expect(out.form).toBe("capsule");
  });

  it("keeps a trailing number that contradicts the strength field", () => {
    const out = run({ name: "Bepra 40", strength: "20" });
    expect(out.name).toBe("Bepra 40");
    expect(out.strength).toBe("20");
  });

  it("keeps a trailing form word that contradicts the form field", () => {
    const out = run({ name: "Relaxon tab", form: "caps" });
    expect(out.name).toBe("Relaxon tab");
    expect(out.form).toBe("caps");
  });
});

describe("Arabic directions mixed into the name", () => {
  it("Latin first, directions after", () => {
    expect(pick(run({ name: "Glibimet 5 نصف ساعة قبل الاكل" }))).toEqual({
      ...blank,
      name: "Glibimet",
      strength: "5",
      frequency: "نصف ساعة قبل الاكل",
    });
  });

  it("goes to notes when the frequency is taken", () => {
    const out = run({ name: "Glibimet 5 قبل الاكل", frequency: "مرة يوميًا" });
    expect(out.name).toBe("Glibimet");
    expect(out.frequency).toBe("مرة يوميًا");
    expect(out.notes).toBe("قبل الاكل");
  });

  it("is not repeated when the frequency already says it", () => {
    const out = run({ name: "Bepra 20 قبل العشاء", frequency: "قبل العشاء" });
    expect(out.frequency).toBe("قبل العشاء");
    expect(out.notes).toBeNull();
  });

  it("is appended to existing notes", () => {
    const out = run({ name: "Bepra 20 قبل العشاء", frequency: "يوميا", notes: "رقم غير واضح" });
    expect(out.notes).toBe("رقم غير واضح؛ قبل العشاء");
  });

  it("does not fill a dose that is already written", () => {
    const out = run({ name: "Bepra 20 قرص قبل العشاء", dose: "نصف قرص" });
    expect(out.dose).toBe("نصف قرص");
    expect(out.frequency).toBe("قرص قبل العشاء");
  });

  it("Arabic words without any timing cue go to notes, not frequency", () => {
    const out = run({ name: "دوستينكس Dostinex" });
    expect(out.name).toBe("Dostinex");
    expect(out.frequency).toBeNull();
    expect(out.notes).toBe("دوستينكس");
  });

  it("a name in Arabic only stays whole", () => {
    expect(pick(run({ name: "أوجمنتين ١ جم" }))).toEqual({ ...blank, name: "أوجمنتين ١ جم" });
  });

  it("two-line text with a line break", () => {
    const out = run({ name: "Glibimet 5\nنصف ساعة قبل الاكل" });
    expect(out.name).toBe("Glibimet");
    expect(out.frequency).toBe("نصف ساعة قبل الاكل");
  });

  it("a leading number belongs to the Arabic side when it comes first", () => {
    const out = run({ name: "٣ مرات يوميا - Cataflam 50" });
    expect(out.name).toBe("Cataflam");
    expect(out.strength).toBe("50");
    expect(out.frequency).toBe("٣ مرات يوميا");
  });

  it("keeps two Latin words together", () => {
    const out = run({ name: "Augmentin Duo 1g بعد الاكل" });
    expect(out.name).toBe("Augmentin Duo");
    expect(out.strength).toBe("1g");
  });
});

describe("dose units found in Arabic directions", () => {
  const cases: [string, string | null, string][] = [
    ["قرص", "قرص", ""],
    ["قرص قبل العشاء", "قرص", "قبل العشاء"],
    ["نصف قرص مرتين يوميا", "نصف قرص", "مرتين يوميا"],
    ["ملعقة بعد الاكل", "ملعقة", "بعد الاكل"],
    ["ملعقة صغيرة ٣ مرات", "ملعقة صغيرة", "٣ مرات"],
    ["ملعقة كبيرة", "ملعقة كبيرة", ""],
    ["٥ مل مرتين", "٥ مل", "مرتين"],
    ["5 مل مرتين", "5 مل", "مرتين"],
    ["5مل", "5مل", ""],
    ["نقطتين في كل عين", "نقطتين", "في كل عين"],
    ["نقطتين", "نقطتين", ""],
    ["كبسولة قبل النوم", "كبسولة", "قبل النوم"],
    ["بخة واحدة", "بخة", "واحدة"],
    ["لبوس مساء", "لبوس", "مساء"],
    ["حقنة كل اسبوع", "حقنة", "كل اسبوع"],
    ["ربع قرص", "ربع قرص", ""],
    ["قرصين", "قرصين", ""],
    ["2 قرص", "2 قرص", ""],
    ["نصف ساعة قبل الاكل", null, "نصف ساعة قبل الاكل"],
    ["مرتين يوميا", null, "مرتين يوميا"],
    ["بعد الاكل", null, "بعد الاكل"],
    ["", null, ""],
  ];
  it.each(cases)("%s", (input, dose, rest) => {
    const out = extractDose(input);
    expect(out.dose).toBe(dose);
    expect(out.rest).toBe(rest);
  });

  it("fills the dose from a frequency that carries the unit", () => {
    const out = run({ name: "Bepra", frequency: "قرص قبل العشاء" });
    expect(out.dose).toBe("قرص");
    expect(out.frequency).toBe("قبل العشاء");
  });

  it("empties the frequency when the unit was all it said", () => {
    const out = run({ name: "Bepra", frequency: "قرص" });
    expect(out.dose).toBe("قرص");
    expect(out.frequency).toBeNull();
  });

  it("leaves an existing dose and a Latin frequency alone", () => {
    const out = run({ name: "Bepra", dose: "1 tab", frequency: "bid" });
    expect(out.dose).toBe("1 tab");
    expect(out.frequency).toBe("bid");
  });
});

describe("alternatives", () => {
  it("are cleaned the same way and de-duplicated", () => {
    const out = sanitizeItem({
      ...blank,
      name: "Dostinex",
      alternatives: ["- Dostenix", "Dostenix", "x - Dostinex قرص"],
    });
    expect(out.alternatives).toEqual(["Dostenix", "Dostinex"]);
  });

  it("stay undefined when the item has none", () => {
    expect(sanitizeItem({ ...blank, name: "A" }).alternatives).toBeUndefined();
  });
});

describe("never invents", () => {
  it("a null name stays null", () => {
    expect(run({ frequency: "قبل الاكل" }).name).toBeNull();
  });

  it("an empty name after cleaning becomes null", () => {
    expect(run({ name: "- x -" }).name).toBeNull();
  });

  it("does not change the spelling of what it moves", () => {
    expect(run({ name: "Bepra 20 بعد الأكل" }).frequency).toBe("بعد الأكل");
  });

  it("is stable when run twice", () => {
    const once = run({ name: "نصف ساعة قبل الاكل x - Glibimet 5" });
    expect(sanitizeItem(once)).toEqual(once);
  });

  it("keeps the other fields untouched", () => {
    const out = sanitizeItem({ ...blank, name: "A", rawText: "A 1", confidence: 0.7 });
    expect(out.rawText).toBe("A 1");
    expect(out.confidence).toBe(0.7);
  });

  it("sanitizeExtraction maps every item", () => {
    const out = sanitizeExtraction({ date: null, items: [{ ...blank, name: "- Bepra 20" }] });
    expect(out.items[0]?.name).toBe("Bepra");
  });
});

describe("displayName (no name from the model)", () => {
  const cases: [string, string][] = [
    ["نصف ساعة قبل الاكل x - Glibimet 5", "Glibimet 5"],
    ["قرص قبل العشاء - Bepra 20", "Bepra 20"],
    ["ملعقة بعد الاكل - Riopan susp", "Riopan susp"],
    ["Relaxon 30 caps", "Relaxon 30 caps"],
    ["1. Motidyl", "Motidyl"],
    ["- Motidyl\nقبل الاكل", "Motidyl"],
    ["أوجمنتين", "أوجمنتين"],
    ["قبل الاكل", "قبل الاكل"],
  ];
  it.each(cases)("%s", (input, expected) => {
    expect(displayName(input)).toBe(expected);
  });
});

describe("form labels", () => {
  const ar: [string, string][] = [
    ["capsule", "كبسولات"],
    ["caps", "كبسولات"],
    ["Caps.", "كبسولات"],
    ["tab", "أقراص"],
    ["Tablets", "أقراص"],
    ["film coated tablet", "أقراص"],
    ["susp", "معلق"],
    ["syrup", "شراب"],
    ["amp", "أمبول"],
    ["vial", "فيال"],
    ["cream", "كريم"],
    ["oint", "مرهم"],
    ["drops", "نقط"],
    ["sachet", "أكياس"],
    ["eff", "فوار"],
    ["supp", "لبوس"],
    ["inhaler", "بخاخ"],
    ["gel", "جل"],
    ["أقراص", "أقراص"],
    ["something else", "something else"],
  ];
  it.each(ar)("ar: %s -> %s", (form, label) => {
    expect(formLabel(form, "ar")).toBe(label);
  });

  it("english shows the text as written", () => {
    expect(formLabel("caps", "en")).toBe("caps");
  });

  it("null and blank give null", () => {
    expect(formLabel(null, "ar")).toBeNull();
    expect(formLabel("  ", "ar")).toBeNull();
  });

  it("formKey unifies spellings", () => {
    expect(formKey("Caps.")).toBe(formKey("capsule"));
    expect(formKey("xyz")).toBeNull();
  });
});
