import { createHash } from "node:crypto";

import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { differenceHash, processImage } from "../src/images/process-image.js";
import { ImageRejected } from "../src/images/rejected.js";

import { pdfWithPages, pngBomb, solidPng, twoToneJpeg } from "./support/image-fixtures.js";

/*
 * The image pipeline on hostile and ordinary input. Every fixture is built in the test.
 */

async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ImageRejected) return error.reason;
    throw error;
  }
  return "accepted";
}

const hamming = (a: string, b: string) =>
  [...(BigInt(`0x${a}`) ^ BigInt(`0x${b}`)).toString(2)].filter((bit) => bit === "1").length;

describe("magic bytes", () => {
  it("rejects a file whose bytes are not the declared type", async () => {
    const png = await solidPng(40, 40);
    expect(await rejection(processImage(png, "image/jpeg"))).toBe("type_mismatch");
  });

  it("rejects bytes that are no known file, and a web page declared as a picture", async () => {
    const html = Buffer.from("<html><script>alert(1)</script></html>");
    expect(await rejection(processImage(html, "image/jpeg"))).toBe("unsupported_type");
    const executable = Buffer.from("MZ\u0090\u0000".repeat(64), "latin1");
    expect(await rejection(processImage(executable, "image/png"))).toBe("unsupported_type");
  });

  it("sends HEIC to the decoder: a file with only the HEIC header is corrupt", async () => {
    // An ISO base media `ftyp` box with the `heic` brand: all file-type needs to recognise it.
    const heic = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from("ftypheic", "ascii"),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from("mif1heic", "ascii"),
    ]);
    expect(await rejection(processImage(heic, "image/jpeg"))).toBe("corrupt_image");
  });

  it("rejects a truncated image instead of storing half a picture", async () => {
    const jpeg = await twoToneJpeg(400, 300);
    expect(await rejection(processImage(jpeg.subarray(0, 300), "image/jpeg"))).toBe(
      "corrupt_image",
    );
  });
});

describe("polyglot", () => {
  it("re-encodes a JPEG with a zip and HTML appended into a clean JPEG", async () => {
    const jpeg = await twoToneJpeg(400, 300);
    const payload = Buffer.concat([
      Buffer.from("PK\u0003\u0004", "latin1"),
      Buffer.from("hidden-payload.exe ", "ascii"),
      Buffer.from("<script>alert('polyglot')</script>", "ascii"),
    ]);
    const polyglot = Buffer.concat([jpeg, payload]);
    // The trick works on a naive check: it is still a JPEG to anything reading from the front.
    expect((await fileTypeFromBuffer(polyglot))?.mime).toBe("image/jpeg");
    expect(polyglot.includes("polyglot")).toBe(true);

    const result = await processImage(polyglot, "image/jpeg");
    expect((await fileTypeFromBuffer(result.jpeg))?.mime).toBe("image/jpeg");
    expect(result.jpeg.includes("polyglot")).toBe(false);
    expect(result.jpeg.includes("hidden-payload")).toBe(false);
    expect(result.jpeg.includes(Buffer.from("PK\u0003\u0004", "latin1"))).toBe(false);
    // Ends where a JPEG ends: nothing rides behind the EOI marker.
    expect(result.jpeg.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
  });
});

describe("decompression bomb", () => {
  it("refuses a 20,000 x 20,000 PNG before decoding it", async () => {
    const bomb = pngBomb(20_000);
    expect(bomb.byteLength).toBeLessThan(100_000);
    const started = Date.now();
    expect(await rejection(processImage(bomb, "image/png"))).toBe("too_many_pixels");
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("accepts a large but legitimate photo (24 megapixels)", async () => {
    const photo = await solidPng(6000, 4000, 1);
    const result = await processImage(photo, "image/png");
    expect(Math.max(result.width, result.height)).toBe(2048);
  });
});

describe("metadata", () => {
  it("removes EXIF, including the GPS position", async () => {
    const withGps = await twoToneJpeg(400, 300, {
      exif: {
        IFD0: { Make: "SecretPhone", Software: "tracker" },
        IFD3: {
          GPSLatitudeRef: "N",
          GPSLatitude: "30/1 2/1 40/1",
          GPSLongitudeRef: "E",
          GPSLongitude: "31/1 14/1 8/1",
        },
      },
    });
    // The fixture really carries what we claim to remove.
    expect((await sharp(withGps).metadata()).exif).toBeDefined();
    expect(withGps.includes("SecretPhone")).toBe(true);

    const { jpeg } = await processImage(withGps, "image/jpeg");
    const after = await sharp(jpeg).metadata();
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.iptc).toBeUndefined();
    expect(jpeg.includes("SecretPhone")).toBe(false);
    expect(jpeg.includes("Exif")).toBe(false);
  });

  it("turns a phone photo with EXIF orientation 6 upright, and the tag is gone", async () => {
    // Stored landscape (left red, right blue); orientation 6 says "rotate 90 degrees clockwise to view".
    const phone = await twoToneJpeg(200, 100, { orientation: 6 });
    expect((await sharp(phone).metadata()).orientation).toBe(6);

    const { jpeg, width, height } = await processImage(phone, "image/jpeg");
    expect({ width, height }).toEqual({ width: 100, height: 200 });
    expect((await sharp(jpeg).metadata()).orientation).toBeUndefined();

    // Rotated clockwise, the stored left (red) half is now the top, the right (blue) half the bottom.
    const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => {
      const offset = (y * info.width + x) * info.channels;
      return { r: data[offset] ?? 0, b: data[offset + 2] ?? 0 };
    };
    expect(pixel(50, 20).r).toBeGreaterThan(200);
    expect(pixel(50, 20).b).toBeLessThan(60);
    expect(pixel(50, 180).b).toBeGreaterThan(200);
    expect(pixel(50, 180).r).toBeLessThan(60);
  });
});

describe("output", () => {
  it("scales the long edge to 2048 px, never up", async () => {
    const big = await processImage(await twoToneJpeg(4000, 3000), "image/jpeg");
    expect({ width: big.width, height: big.height }).toEqual({ width: 2048, height: 1536 });
    const small = await processImage(await twoToneJpeg(400, 300), "image/jpeg");
    expect({ width: small.width, height: small.height }).toEqual({ width: 400, height: 300 });
  });

  it("flattens transparency onto white", async () => {
    const { jpeg } = await processImage(await solidPng(50, 50, 0), "image/png");
    const { data } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(250);
    expect(data[1]).toBeGreaterThan(250);
    expect(data[2]).toBeGreaterThan(250);
  });

  it("computes a 64-bit dHash that survives rescaling and recompression, not another picture", async () => {
    const original = await twoToneJpeg(800, 600);
    const resized = await sharp(original).resize(400, 300).jpeg({ quality: 60 }).toBuffer();
    const white = await sharp({
      create: { width: 800, height: 300, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .png()
      .toBuffer();
    const other = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .composite([{ input: white, top: 0, left: 0 }])
      .jpeg()
      .toBuffer();

    const hash = await differenceHash(original);
    expect(hash).toMatch(/^[a-f0-9]{16}$/);
    expect(hamming(hash, await differenceHash(resized))).toBeLessThanOrEqual(4);
    expect(hamming(hash, await differenceHash(other))).toBeGreaterThan(4);
  });

  it("returns the SHA-256 of exactly the bytes it returns", async () => {
    const result = await processImage(await twoToneJpeg(300, 200), "image/jpeg");
    expect(result.sha256).toBe(createHash("sha256").update(result.jpeg).digest("hex"));
  });
});

describe("pdf", () => {
  it("rasterizes a one-page PDF into the same JPEG as an image", async () => {
    const result = await processImage(pdfWithPages(1), "application/pdf");
    expect((await fileTypeFromBuffer(result.jpeg))?.mime).toBe("image/jpeg");
    // A4 at 200 dpi is 1654 x 2339; the long edge is then capped at 2048.
    expect(result.height).toBe(2048);
    expect(result.width).toBeGreaterThan(1400);
    const { data, info } = await sharp(result.jpeg).raw().toBuffer({ resolveWithObject: true });
    // The page is white; the painted rectangle (red) fills the lower half of the PDF, which is the
    // lower half of the raster (PDF y grows upwards, so the rectangle at y 40..461 is near the bottom).
    const centre =
      (Math.floor(info.height * 0.8) * info.width + Math.floor(info.width / 2)) * info.channels;
    expect(data[centre]).toBeGreaterThan(180);
    expect(data[centre + 1]).toBeLessThan(80);
  });

  it("refuses a PDF with more than one page for now", async () => {
    expect(await rejection(processImage(pdfWithPages(2), "application/pdf"))).toBe(
      "pdf_multi_page_unsupported",
    );
  });

  it("refuses a PDF that is only a header", async () => {
    const header = Buffer.from("%PDF-1.4\nnot really\n");
    expect(await rejection(processImage(header, "application/pdf"))).toBe("pdf_unreadable");
  });
});
