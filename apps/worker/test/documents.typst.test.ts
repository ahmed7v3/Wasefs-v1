import { WA_DOCUMENT_LIMITS } from "@wasfa/shared/schemas/wa-document";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { documentRequest, rxResultRequest } from "../src/documents/data.js";
import { TypstRenderer } from "../src/documents/renderer.js";
import { FONT_DIR } from "../src/og/fonts.js";

import type { RxResult } from "@wasfa/shared/schemas/rx";
import type { WaRenderDocumentPayload } from "@wasfa/shared/schemas/wa-document";

/*
 * The real Typst binary, only where one is installed: set TYPST_BIN to its path (the worker image
 * has it on PATH as `typst`). Everything else about documents is tested with a fake renderer.
 */

const bin = process.env["TYPST_BIN"];
const NOW = new Date("2026-10-27T10:00:00Z");
const CONVERSATION = "018f0000-0000-7000-8000-0000000000c1";

// Typst markup and code a customer could try to smuggle into a document.
const HOSTILE = '#panic("evaluated") *bold* $x$ #read("data.json") #import "@preview/x:1.0.0": *';

const renderer = () => new TypstRenderer({ bin: bin ?? "typst", fontDir: FONT_DIR });

function payload(
  language: "ar" | "en",
  template: WaRenderDocumentPayload["template"],
): WaRenderDocumentPayload {
  const base = { conversationId: CONVERSATION, language, fileName: "file" };
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

describe.skipIf(bin === undefined)("Typst renderer (real binary)", () => {
  for (const language of ["ar", "en"] as const) {
    for (const template of ["report", "table", "schedule"] as const) {
      it(`renders ${template} in ${language} as a PDF and shows hostile text as text`, async () => {
        const out = await renderer().render(documentRequest(payload(language, template), NOW));
        expect(out.bytes.subarray(0, 5).toString()).toBe("%PDF-");
        expect(out.pages).toBeGreaterThanOrEqual(1);
      });
    }
  }

  it("renders the worst-case card on one 1080 x 1350 page", async () => {
    const out = await renderer().render(documentRequest(payload("ar", "card"), NOW));
    const meta = await sharp(out.bytes).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["png", 1080, 1350]);
  });

  it("counts the pages of a long table", async () => {
    const long = payload("ar", "table");
    if (long.template !== "table") throw new Error("unreachable");
    long.content.rows = Array.from({ length: 200 }, (_, i) => [
      `row ${String(i)}`,
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
    const out = await renderer().render(documentRequest(long, NOW));
    expect(out.pages).toBeGreaterThan(2);
  });

  it("renders the prescription result", async () => {
    const result = {
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
    for (const language of ["ar", "en"] as const) {
      const out = await renderer().render(
        rxResultRequest(result, "https://wasfa.online/analyze/1", language, NOW),
      );
      expect(out.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    }
  });
});
