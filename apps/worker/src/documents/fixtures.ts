import { WA_DOCUMENT_LIMITS } from "@wasfa/shared/schemas/wa-document";

import type { RxResult } from "@wasfa/shared/schemas/rx";
import type { WaRenderDocumentPayload } from "@wasfa/shared/schemas/wa-document";

/*
 * Sample content for every template, shared by the real-binary test and the image-build smoke check
 * (smoke.ts), so both prove the same documents compile with the installed Typst.
 */

export const SAMPLE_NOW = new Date("2026-10-27T10:00:00Z");
export const SAMPLE_CONVERSATION = "018f0000-0000-7000-8000-0000000000c1";

// Typst markup and code a customer could try to smuggle into a document.
export const HOSTILE =
  '#panic("evaluated") *bold* $x$ #read("data.json") #import "@preview/x:1.0.0": *';

export function samplePayload(
  language: "ar" | "en",
  template: WaRenderDocumentPayload["template"],
): WaRenderDocumentPayload {
  const base = { conversationId: SAMPLE_CONVERSATION, language, fileName: "file" };
  switch (template) {
    case "report":
      return {
        ...base,
        template,
        content: {
          title: `ملخص ${HOSTILE}`,
          subtitle: "sub",
          sections: [
            {
              heading: HOSTILE,
              paragraphs: [HOSTILE, "نص عربي مع English words"],
              bullets: [HOSTILE],
            },
          ],
          footerNote: HOSTILE,
        },
      };
    case "table":
      return {
        ...base,
        template,
        content: {
          title: HOSTILE,
          columns: ["الصنف", "السعر", "c3", "c4", "c5", "c6"],
          rows: Array.from({ length: 80 }, (_, i) => [HOSTILE, String(i), "a", "b", "c", "d"]),
          notes: HOSTILE,
        },
      };
    case "schedule":
      return {
        ...base,
        template,
        content: {
          title: "جدول",
          rows: [{ medicine: HOSTILE, dose: "قرص", times: ["8:00", "20:00"], notes: HOSTILE }],
        },
      };
    case "card":
      return {
        ...base,
        template,
        content: {
          title: "ع".repeat(80),
          lines: Array.from({ length: WA_DOCUMENT_LIMITS.cardLines }, () => "ن".repeat(120)),
          footer: HOSTILE,
        },
      };
  }
}

const sampleItem = (fields: Record<string, unknown>) => ({
  matchedDrugId: null,
  matchScore: null,
  activeIngredients: [],
  route: null,
  notes: null,
  confidence: 0.9,
  badge: "high",
  verified: "not_needed",
  details: null,
  ...fields,
});

/** Four medicines: a full reading, a bedtime one, an as-needed doubtful one, and one with no readable frequency. */
export const SAMPLE_RX_RESULT = {
  items: [
    sampleItem({
      rawText: "Augmentin 1g 1x2",
      name: "Augmentin",
      strength: "1 g",
      form: "أقراص",
      dose: "قرص",
      frequency: "مرتين يوميًا بعد الأكل",
      duration: "7 أيام",
      route: "فموي",
      notes: "يكمل العلاج حتى النهاية",
      badge: "medium",
      details: {
        purpose: "مضاد حيوي لعلاج العدوى البكتيرية",
        sideEffects: ["إسهال"],
        precautions: ["يؤخذ مع الطعام لتقليل اضطراب المعدة", "أخبر الطبيب عن حساسية البنسلين"],
      },
    }),
    sampleItem({
      rawText: "Lipitor 20 hs",
      name: "Lipitor",
      strength: "20 mg",
      form: "tablet",
      dose: "قرص",
      frequency: "قبل النوم",
      duration: "شهر",
    }),
    sampleItem({
      rawText: "panadol",
      name: "Panadol",
      strength: "500 mg",
      form: "أقراص",
      dose: "قرص",
      frequency: "عند اللزوم",
      duration: null,
      badge: "low",
      verified: "unreadable",
    }),
    sampleItem({ rawText: "Vitamin D", name: "Vitamin D", dose: "حبة", frequency: null }),
  ],
  date: "2026-10-20",
  findings: [{ kind: "duplicate_ingredient", itemIndexes: [0, 2], ingredient: "x" }],
  overview: { summary: "أدوية لعلاج عدوى وارتفاع الكوليسترول.", likelyConditions: [] },
  unreadableRegions: [{}],
} as unknown as RxResult;

export const SAMPLE_RX_LINK = "https://wasfa.online/analyze/1";
