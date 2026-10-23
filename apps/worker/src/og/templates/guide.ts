import { ogGuideInputSchema } from "@wasfa/shared/schemas/og";

import {
  chipBlock,
  COLOR,
  frame,
  gap,
  LABELS,
  sideOf,
  stack,
  textBlock,
  TITLE_SIZES,
} from "../frame.js";

import type { OgTemplate } from "./types.js";

/** «دليل» chip, the title and the number of sections. */
export const guideTemplate: OgTemplate<"guide"> = {
  id: "guide",
  version: 1,
  schema: ogGuideInputSchema,
  async render(input) {
    const side = sideOf(input.locale);
    const labels = LABELS[input.locale];
    return frame(
      side,
      stack([
        await chipBlock(labels.guide, side),
        gap(28),
        await textBlock(input.title, side, {
          sizes: TITLE_SIZES,
          maxLines: 3,
          weight: 700,
          fill: COLOR.primary,
        }),
        gap(24),
        await textBlock(labels.sections(input.sectionCount), side, {
          sizes: [32],
          maxLines: 1,
          weight: 400,
          fill: COLOR.textMuted,
        }),
      ]),
    );
  },
};
