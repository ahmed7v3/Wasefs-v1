import { describe, expect, it } from "vitest";

import {
  canonicalForm,
  formFromDirections,
  formGroup,
  formGroupFromDirections,
  normalizeDrugName,
} from "../src/normalize.js";

describe("canonical dosage forms", () => {
  it.each([
    ["Flatydiel 50mg chewable tabs", "chewable tablet", "flatydiel"],
    ["Flatydiel chew tablets", "chewable tablet", "flatydiel"],
    ["فلاتيديل قرص مضغ", "chewable tablet", "فلاتيديل"],
    ["فلاتيديل قابل للمضغ", "chewable tablet", "فلاتيديل"],
    ["Foo effervescent tabs", "effervescent", "foo"],
    ["فو اقراص فوار", "effervescent", "فو"],
    ["Foo dispersible tablets", "dispersible", "foo"],
    ["Foo sublingual tablets", "sublingual", "foo"],
    ["فو تحت اللسان", "sublingual", "فو"],
    ["Foo ODT", "orally disintegrating", "foo"],
    ["Foo orally disintegrating tablets", "orally disintegrating", "foo"],
    ["فو نقط", "drops", "فو"],
    ["فو قطرة", "drops", "فو"],
    ["فو شراب", "syrup", "فو"],
    ["فو معلق", "suspension", "فو"],
    ["فو اكياس", "sachet", "فو"],
    ["فو كيس", "sachet", "فو"],
    ["Foo tablets", "tablet", "foo"],
  ])("%s", (text, form, name) => {
    const out = normalizeDrugName(text);
    expect(out.form).toBe(form);
    expect(out.name).toBe(name);
  });

  it("canonicalForm reads free form text", () => {
    expect(canonicalForm("Chewable Tablets")).toBe("chewable tablet");
    expect(canonicalForm(null)).toBeNull();
    expect(canonicalForm("something odd")).toBeNull();
  });
});

describe("formGroup", () => {
  it("groups solid and liquid oral forms", () => {
    for (const form of ["tablet", "chewable tablet", "effervescent", "capsule", "dispersible"]) {
      expect(formGroup(form)).toBe("solid_oral");
    }
    for (const form of ["syrup", "suspension", "drops"])
      expect(formGroup(form)).toBe("liquid_oral");
    expect(formGroup("cream")).toBeNull();
    expect(formGroup("eye drops")).toBeNull();
    expect(formGroup(null)).toBeNull();
  });
});

describe("formFromDirections", () => {
  it.each([
    ["يمضغ قرص مرتين", "chewable tablet"],
    ["قرص مضغ مرتين يوميا", "chewable tablet"],
    ["Chew 1 tab twice daily", "chewable tablet"],
    ["للمضغ", "chewable tablet"],
    ["5 نقط ثلاث مرات", "drops"],
    ["قطرة في كل عين", "drops"],
    ["قرص بعد الاكل", "tablet"],
    ["1 tab bid", "tablet"],
    ["كبسولة صباحا", "capsule"],
    ["تحت اللسان", "sublingual"],
    ["معلقة صغيرة", null],
    ["5 ml tid", null],
    ["مرتين يوميا", null],
    ["", null],
  ])("%s", (text, form) => {
    expect(formFromDirections(text)).toBe(form);
  });

  it("names the liquid group for a spoon or a volume, and the solid group for a tablet", () => {
    expect(formGroupFromDirections("معلقة صغيرة")).toBe("liquid_oral");
    expect(formGroupFromDirections("5 ml tid")).toBe("liquid_oral");
    expect(formGroupFromDirections("5 سم")).toBe("liquid_oral");
    expect(formGroupFromDirections("قرص مضغ")).toBe("solid_oral");
    expect(formGroupFromDirections("5 نقط")).toBe("liquid_oral");
    expect(formGroupFromDirections("مرتين يوميا")).toBeNull();
  });
});
