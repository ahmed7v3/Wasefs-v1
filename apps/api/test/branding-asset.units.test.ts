import { AppError } from "@wasfa/shared/errors";
import { describe, expect, it } from "vitest";

import { inspectAssetUpload } from "../src/branding/branding-asset.js";

import {
  MALFORMED_SVGS,
  MALICIOUS_SVGS,
  SVG,
  dataUrl,
  ico,
  png,
  pngOfSize,
  webp,
} from "./support/branding-fixtures.js";

import type { BrandingAssetKey } from "@wasfa/shared/schemas/branding";

function reasonOf(key: BrandingAssetKey, url: string): unknown {
  try {
    inspectAssetUpload(key, url);
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    const details = (error as AppError).details;
    expect(details?.["fields"]).toEqual(["dataUrl"]);
    return details?.["reason"];
  }
  return undefined;
}

describe("inspectAssetUpload", () => {
  it("reads the size of a PNG and a WebP from their headers", () => {
    expect(inspectAssetUpload("logo", dataUrl("image/png", png(240, 80)))).toMatchObject({
      contentType: "image/png",
      width: 240,
      height: 80,
    });
    expect(inspectAssetUpload("logo", dataUrl("image/webp", webp(300, 100)))).toMatchObject({
      contentType: "image/webp",
      width: 300,
      height: 100,
    });
  });

  it("reads the size of an SVG from its viewBox, then from width and height", () => {
    expect(inspectAssetUpload("logo", dataUrl("image/svg+xml", SVG))).toMatchObject({
      width: 200,
      height: 60,
    });
    const plain = `<svg xmlns="http://www.w3.org/2000/svg" width="120px" height="40"/>`;
    expect(inspectAssetUpload("logo", dataUrl("image/svg+xml", plain))).toMatchObject({
      width: 120,
      height: 40,
    });
    const unsized = `<svg xmlns="http://www.w3.org/2000/svg"/>`;
    expect(inspectAssetUpload("logo", dataUrl("image/svg+xml", unsized))).toMatchObject({
      width: null,
      height: null,
    });
  });

  it("accepts an ICO for the favicon only", () => {
    expect(inspectAssetUpload("favicon", dataUrl("image/x-icon", ico())).contentType).toBe(
      "image/x-icon",
    );
    expect(reasonOf("logo", dataUrl("image/x-icon", ico()))).toBe("unsupported_type");
  });

  it("refuses a type that is not on the list, however it is spelled", () => {
    expect(reasonOf("logo", dataUrl("image/gif", png()))).toBe("unsupported_type");
    expect(reasonOf("logo", dataUrl("text/html", "<svg/>"))).toBe("unsupported_type");
  });

  it("refuses bytes that do not match the declared type", () => {
    expect(reasonOf("logo", dataUrl("image/webp", png()))).toBe("type_mismatch");
    expect(reasonOf("logo", dataUrl("image/png", webp()))).toBe("type_mismatch");
    expect(reasonOf("logo", dataUrl("image/png", SVG))).toBe("type_mismatch");
    expect(reasonOf("logo", dataUrl("image/svg+xml", png()))).toBe("type_mismatch");
    expect(reasonOf("favicon", dataUrl("image/x-icon", png()))).toBe("type_mismatch");
  });

  it("refuses a file over 512 KB and accepts one of exactly 512 KB", () => {
    expect(reasonOf("logo", dataUrl("image/png", pngOfSize(524_289)))).toBe("too_large");
    expect(reasonOf("logo", dataUrl("image/png", pngOfSize(524_288)))).toBeUndefined();
  });

  it("refuses a payload whose base64 is cut short", () => {
    expect(reasonOf("logo", `data:image/png;base64,${png().toString("base64").slice(0, -1)}`)).toBe(
      "invalid_data",
    );
  });

  it.each(Object.entries(MALICIOUS_SVGS))("refuses an SVG with %s", (_name, svg) => {
    expect(["unsafe_svg", "invalid_svg"]).toContain(
      reasonOf("logo", dataUrl("image/svg+xml", svg)),
    );
  });

  it("names the denylist when the markup is well-formed but unsafe", () => {
    expect(reasonOf("logo", dataUrl("image/svg+xml", MALICIOUS_SVGS["script element"] ?? ""))).toBe(
      "unsafe_svg",
    );
    expect(reasonOf("logo", dataUrl("image/svg+xml", MALICIOUS_SVGS["external href"] ?? ""))).toBe(
      "unsafe_svg",
    );
  });

  it.each(Object.entries(MALFORMED_SVGS))("refuses an SVG that is %s", (_name, svg) => {
    expect(reasonOf("logo", dataUrl("image/svg+xml", svg))).toBe("invalid_svg");
  });

  it("accepts a BOM, comments and an XML declaration around the root", () => {
    const svg = `${String.fromCharCode(0xfeff)}<?xml version="1.0"?>\n<!-- c -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g><path d="M0 0h10v10z"/></g></svg>\n<!-- end -->\n`;
    expect(inspectAssetUpload("logo", dataUrl("image/svg+xml", svg))).toMatchObject({
      width: 10,
      height: 10,
    });
  });
});
