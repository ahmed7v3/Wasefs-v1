import { describe, expect, it } from "vitest";

import { rxPdfDocSchema, rxResultRequest } from "../src/documents/data.js";
import { SAMPLE_NOW, SAMPLE_RX_LINK, SAMPLE_RX_RESULT } from "../src/documents/fixtures.js";

import type { RxPdfDoc } from "../src/documents/data.js";

/*
 * The prescription PDF's data: one card per medicine and the suggested dosing timetable. Compiled
 * with the real Typst binary in documents.typst.test.ts where one is installed.
 */

const docOf = (language: "ar" | "en"): RxPdfDoc =>
  rxPdfDocSchema.parse(
    rxResultRequest(SAMPLE_RX_RESULT, SAMPLE_RX_LINK, language, SAMPLE_NOW).data["doc"],
  );

describe("rx PDF data", () => {
  it("builds a card per medicine with the facts the prescription gives and nothing else", () => {
    const doc = docOf("ar");
    expect(doc.items.map((item) => item.title)).toEqual([
      "Augmentin",
      "Lipitor",
      "Panadol",
      "Vitamin D",
    ]);
    const first = doc.items[0];
    expect(first?.sub).toBe("1 g أقراص");
    expect(first?.facts.map((fact) => fact.label)).toEqual([
      "الجرعة",
      "عدد المرات",
      "المدة",
      "طريقة الاستخدام",
      "تعليمات الطبيب",
      "يُستخدم لـ",
    ]);
    // The frequency already says "after meals": it is not added twice.
    expect(first?.facts[1]?.value).toBe("مرتين يوميًا بعد الأكل");
    expect(first?.precautions).toHaveLength(2);
    // No details, no duration: those facts are simply absent.
    expect(doc.items[3]?.facts.map((fact) => fact.label)).toEqual(["الجرعة"]);
    expect(doc.items[2]?.flag).toContain("قراءة غير مؤكدة");
    expect(doc.items[0]?.flag).toBeNull();
  });

  it("caps precautions at three", () => {
    const many = structuredClone(SAMPLE_RX_RESULT);
    const details = many.items[0]?.details;
    if (!details) throw new Error("fixture");
    details.precautions = ["a", "b", "c", "d", "e"];
    const doc = rxPdfDocSchema.parse(rxResultRequest(many, null, "ar", SAMPLE_NOW).data["doc"]);
    expect(doc.items[0]?.precautions).toEqual(["a", "b", "c"]);
  });

  it("lays the timetable out with a row per medicine and a column per suggested time", () => {
    const schedule = docOf("ar").schedule;
    // Augmentin twice a day: 8 AM, 8 PM; Lipitor at bedtime: 10 PM.
    expect(schedule?.columns).toEqual([
      { time: "8 ص", slot: "صباحًا" },
      { time: "8 م", slot: "مساءً" },
      { time: "10 م", slot: "قبل النوم" },
    ]);
    expect(schedule?.rows.map((row) => row.cells)).toEqual([
      [true, true, false],
      [false, false, true],
      [false, false, false],
      [false, false, false],
    ]);
    // As needed and unknown frequency: a note, never a guessed time.
    expect(schedule?.rows.map((row) => row.note)).toEqual([
      null,
      null,
      "عند اللزوم",
      "حسب إرشادات الطبيب",
    ]);
    expect(schedule?.note).toContain("اتبع تعليمات طبيبك");
  });

  it("speaks English in the English document", () => {
    const doc = docOf("en");
    expect(doc.schedule?.title).toBe("Suggested dosing timetable");
    expect(doc.schedule?.columns[0]?.time).toBe("8 AM");
    expect(doc.schedule?.rows[3]?.note).toBe("As your doctor directs");
    expect(doc.items[0]?.facts[0]?.label).toBe("Dose");
  });

  it("carries the overview, the unreadable note and the link", () => {
    const doc = docOf("ar");
    expect(doc.overview?.text).toContain("عدوى");
    expect(doc.unreadable).not.toBeNull();
    expect(doc.link).toBe(SAMPLE_RX_LINK);
    expect(doc.date).toBe("2026-10-20");
  });

  it("has no timetable, overview or cards for an empty result", () => {
    const empty = { ...SAMPLE_RX_RESULT, items: [], overview: null, unreadableRegions: [] };
    const doc = rxPdfDocSchema.parse(rxResultRequest(empty, null, "ar", SAMPLE_NOW).data["doc"]);
    expect(doc).toMatchObject({ items: [], schedule: null, overview: null, unreadable: null });
  });

  it("rejects a document of the wrong shape", () => {
    expect(() => rxPdfDocSchema.parse({ items: "x" })).toThrow();
  });
});
