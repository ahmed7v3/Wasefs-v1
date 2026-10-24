import type { OgInput, OgTemplateId, ogInputSchemas } from "@wasfa/shared/schemas/og";

/** Image bytes a template may draw; the input only carries their hash and focal point. */
export interface OgAssets {
  cover?: Buffer | undefined;
  photo?: Buffer | undefined;
}

/**
 * A versioned card template. Bump `version` whenever its drawing changes: the version is part of
 * the card's content hash, so the next render writes a new object instead of reusing the old one.
 */
export interface OgTemplate<T extends OgTemplateId> {
  id: T;
  version: number;
  schema: (typeof ogInputSchemas)[T];
  /** The 1200x630 card as an SVG string (async: line fitting measures text with Pango). */
  render: (input: OgInput<T>, assets: OgAssets) => Promise<string>;
}
