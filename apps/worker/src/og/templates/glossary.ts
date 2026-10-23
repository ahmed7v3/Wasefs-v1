import { ogGlossaryInputSchema } from "@wasfa/shared/schemas/og";

import {
  chipBlock,
  COLOR,
  frame,
  gap,
  hasArabic,
  LABELS,
  sideOf,
  stack,
  textBlock,
} from "../frame.js";

import type { OgTemplate } from "./types.js";

/** The term very large (it stays one line, shrinking to 96 px), then its meaning. */
export const glossaryTemplate: OgTemplate<"glossary"> = {
  id: "glossary",
  version: 1,
  schema: ogGlossaryInputSchema,
  async render(input) {
    const side = sideOf(input.locale);
    return frame(
      side,
      stack([
        await chipBlock(LABELS[input.locale].glossary, side),
        gap(20),
        // A Latin abbreviation such as BID is laid out left-to-right even on an Arabic card.
        await textBlock(input.term, side, {
          sizes: [128, 112, 96],
          maxLines: 1,
          weight: 700,
          fill: COLOR.primary,
          rtl: hasArabic(input.term),
        }),
        gap(16),
        await textBlock(input.meaning, side, {
          sizes: [56, 52, 48, 44, 40],
          maxLines: 2,
          weight: 400,
          fill: COLOR.text,
        }),
      ]),
    );
  },
};
