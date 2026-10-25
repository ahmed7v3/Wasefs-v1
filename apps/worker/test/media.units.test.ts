import { MEDIA_VARIANT_WIDTHS } from "@wasfa/shared/schemas/media";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  encodeWithinBudget,
  MEDIA_AVIF_BUDGET_BYTES,
  processMedia,
} from "../src/media/process-media.js";
import { MediaRejected } from "../src/media/rejected.js";

import { noisyJpeg, pngBomb, solidPng, twoToneJpeg } from "./support/image-fixtures.js";

/*
 * The media pipeline on ordinary and hostile input. Every fixture is built in the test.
 */

async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MediaRejected) return error.reason;
    throw error;
  }
  return "accepted";
}

describe("encodeWithinBudget", () => {
  it("steps quality down by the step until the result fits, and keeps that result", async () => {
    const seen: number[] = [];
    const fake = (quality: number): Promise<Buffer> => {
      seen.push(quality);
      return Promise.resolve(Buffer.alloc(quality > 40 ? 200 : 50));
    };
    const result = await encodeWithinBudget(fake, 100, 50, 30, 5);
    expect(seen).toEqual([50, 45, 40]);
    expect(result).toMatchObject({ quality: 40, withinBudget: true });
    expect(result.body.byteLength).toBe(50);
  });

  it("stops at the floor and reports the miss when nothing fits", async () => {
    const seen: number[] = [];
    const fake = (quality: number): Promise<Buffer> => {
      seen.push(quality);
      return Promise.resolve(Buffer.alloc(500));
    };
    const result = await encodeWithinBudget(fake, 100, 50, 30, 5);
    expect(seen).toEqual([50, 45, 40, 35, 30]);
    expect(result).toMatchObject({ quality: 30, withinBudget: false });
  });

  it("encodes once when the first result already fits", async () => {
    let calls = 0;
    const result = await encodeWithinBudget(
      () => {
        calls += 1;
        return Promise.resolve(Buffer.alloc(10));
      },
      100,
      50,
      30,
      5,
    );
    expect(calls).toBe(1);
    expect(result.withinBudget).toBe(true);
  });
});

describe("processMedia", () => {
  it("strips EXIF (GPS included) from every variant and applies the orientation", async () => {
    // 1200x600 stored sideways: orientation 6 means the picture is 600 wide and 1200 tall.
    const jpeg = await twoToneJpeg(1200, 600, {
      orientation: 6,
      exif: {
        IFD0: { Copyright: "secret owner", Artist: "someone" },
        IFD3: { GPSLatitudeRef: "N" },
      },
    });
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();

    const result = await processMedia(jpeg, "image/jpeg");
    expect(result).toMatchObject({ mime: "image/jpeg", width: 600, height: 1200 });
    expect(result.variants.length).toBeGreaterThan(0);
    for (const variant of result.variants) {
      const meta = await sharp(variant.body).metadata();
      expect(meta.exif, `${variant.format} ${String(variant.width)}`).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(meta.iptc).toBeUndefined();
      expect(meta.icc ?? undefined).toBeUndefined();
      expect(meta.orientation).toBeUndefined();
    }
  });

  it("builds avif, webp and jpeg at every width up to the original, never upscaling", async () => {
    const result = await processMedia(await twoToneJpeg(1000, 500), "image/jpeg");
    const widths = [...new Set(result.variants.map((variant) => variant.width))];
    expect(widths).toEqual([320, 480, 640, 960]);
    for (const width of widths) {
      expect(
        result.variants
          .filter((variant) => variant.width === width)
          .map((variant) => variant.format),
      ).toEqual(["avif", "webp", "jpeg"]);
    }
    const types = await Promise.all(
      result.variants.map(async (variant) => (await sharp(variant.body).metadata()).format),
    );
    expect(new Set(types)).toEqual(new Set(["heif", "webp", "jpeg"]));
    expect(result.variants.every((variant) => variant.body.byteLength > 0)).toBe(true);
  });

  it("builds the spec widths for a large noisy photo and holds the 1600 AVIF to its budget or warns", async () => {
    // 1700 px wide is the smallest source that still yields the 1600 variant; a bigger one only makes
    // every variant re-decode more pixels (the AVIF encode of incompressible noise is the slow part).
    const result = await processMedia(await noisyJpeg(1700, 1100), "image/jpeg");
    const widths = [...new Set(result.variants.map((variant) => variant.width))];
    expect(widths).toEqual(MEDIA_VARIANT_WIDTHS.filter((width) => width <= 1600));
    expect(widths).toEqual([320, 480, 640, 960, 1280, 1600]);
    const avif = result.variants.find((v) => v.format === "avif" && v.width === 1600);
    expect(avif).toBeDefined();
    expect(
      (avif?.body.byteLength ?? Infinity) <= MEDIA_AVIF_BUDGET_BYTES ||
        result.warnings.includes("avif_over_budget_1600"),
    ).toBe(true);
  }, 300_000);

  it("gives a small image only the widths it can fill, with no warnings", async () => {
    const result = await processMedia(await twoToneJpeg(500, 250), "image/jpeg");
    expect([...new Set(result.variants.map((variant) => variant.width))]).toEqual([320, 480]);
    expect(result.warnings).toEqual([]);
  });

  it("keeps a picture narrower than the smallest width as one variant of its own size", async () => {
    const result = await processMedia(await solidPng(200, 100), "image/png");
    expect([...new Set(result.variants.map((variant) => variant.width))]).toEqual([200]);
  });

  it("makes a tiny webp blur placeholder", async () => {
    const result = await processMedia(await twoToneJpeg(800, 400), "image/jpeg");
    expect(result.blurDataUrl).toMatch(/^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/);
    const data = Buffer.from(result.blurDataUrl.split(",")[1] ?? "", "base64");
    expect((await sharp(data).metadata()).width).toBe(16);
    expect(data.byteLength).toBeLessThanOrEqual(600);
  });

  it("flattens transparency onto white for the jpeg and keeps it for webp", async () => {
    const result = await processMedia(await solidPng(400, 400, 0), "image/png");
    const jpeg = result.variants.find((variant) => variant.format === "jpeg");
    const webp = result.variants.find((variant) => variant.format === "webp");
    expect((await sharp(jpeg?.body).metadata()).hasAlpha).toBe(false);
    expect((await sharp(webp?.body).metadata()).hasAlpha).toBe(true);
  });

  it("accepts avif and webp originals", async () => {
    const source = await twoToneJpeg(640, 320);
    const avif = await sharp(source).avif().toBuffer();
    const webp = await sharp(source).webp().toBuffer();
    expect((await processMedia(avif, "image/avif")).width).toBe(640);
    expect((await processMedia(webp, "image/webp")).width).toBe(640);
  });
});

describe("rejections", () => {
  it("rejects SVG, even one declared as a raster type", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
    );
    expect(await rejection(processMedia(svg, "image/svg+xml"))).toBe("unsupported_type");
    expect(await rejection(processMedia(svg, "image/png"))).toBe("unsupported_type");
  });

  it("rejects HEIC, GIF and arbitrary bytes", async () => {
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from("ftypheic", "ascii"),
      Buffer.alloc(64),
    ]);
    expect(await rejection(processMedia(heic, "image/heic"))).toBe("unsupported_type");
    const gif = await sharp(await solidPng(8, 8))
      .gif()
      .toBuffer();
    expect(await rejection(processMedia(gif, "image/gif"))).toBe("unsupported_type");
    expect(await rejection(processMedia(Buffer.from("<html></html>"), "image/jpeg"))).toBe(
      "unsupported_type",
    );
  });

  it("rejects bytes that are not the declared type", async () => {
    expect(await rejection(processMedia(await solidPng(40, 40), "image/jpeg"))).toBe(
      "type_mismatch",
    );
  });

  it("rejects an image over 40 megapixels before decoding it", async () => {
    expect(await rejection(processMedia(await pngBomb(), "image/png"))).toBe("too_many_pixels");
  });

  it("rejects a truncated file", async () => {
    const jpeg = await twoToneJpeg(800, 400);
    expect(await rejection(processMedia(jpeg.subarray(0, 300), "image/jpeg"))).toBe("unreadable");
  });
});
