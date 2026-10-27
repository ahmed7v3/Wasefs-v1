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

export const SAMPLE_RX_RESULT = {
  items: [
    {
      rawText: "Augmentin 1g",
      name: "Augmentin",
      strength: "1 g",
      form: "tablet",
      dose: "1",
      frequency: "twice daily",
      duration: "7 days",
      badge: "low",
      verified: "skipped",
    },
  ],
  date: "2026-10-20",
  unreadableRegions: [{}],
} as unknown as RxResult;

export const SAMPLE_RX_LINK = "https://wasfa.online/analyze/1";
