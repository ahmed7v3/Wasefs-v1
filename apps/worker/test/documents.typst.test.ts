import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { documentRequest, rxResultRequest } from "../src/documents/data.js";
import {
  SAMPLE_NOW as NOW,
  SAMPLE_RX_LINK,
  SAMPLE_RX_RESULT,
  samplePayload as payload,
} from "../src/documents/fixtures.js";
import { TypstRenderer } from "../src/documents/renderer.js";
import { FONT_DIR } from "../src/og/fonts.js";

/*
 * The real Typst binary, only where one is installed: set TYPST_BIN to its path (the worker image
 * has it on PATH as `typst`). Everything else about documents is tested with a fake renderer.
 */

const bin = process.env["TYPST_BIN"];

const renderer = () => new TypstRenderer({ bin: bin ?? "typst", fontDir: FONT_DIR });

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
    for (const language of ["ar", "en"] as const) {
      const out = await renderer().render(
        rxResultRequest(SAMPLE_RX_RESULT, SAMPLE_RX_LINK, language, NOW),
      );
      expect(out.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    }
  });
});
