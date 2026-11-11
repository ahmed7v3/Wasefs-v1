import { ErrorCode } from "@wasfa/shared/errors";
import { describe, expect, it } from "vitest";

import {
  PUBLISH_MEDIA_MAX_BYTES,
  assertAcceptableImage,
  sha256Hex,
  sniffImage,
} from "../src/publishing/publishing-api-media-sniff.js";

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 1)]);
const png = (chunks: string[]) => {
  const parts = [Buffer.from("89504e470d0a1a0a", "hex")];
  for (const type of chunks) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(4);
    parts.push(length, Buffer.from(type, "latin1"), Buffer.alloc(4), Buffer.alloc(4));
  }
  return Buffer.concat(parts);
};
const webp = (kind: "VP8 " | "VP8X", flags = 0) => {
  const header = Buffer.alloc(30);
  header.write("RIFF", 0, "latin1");
  header.write("WEBP", 8, "latin1");
  header.write(kind, 12, "latin1");
  header[20] = flags;
  return header;
};
const ftyp = (brand: string) => {
  const header = Buffer.alloc(32);
  header.write("ftyp", 4, "latin1");
  header.write(brand, 8, "latin1");
  return header;
};

describe("sniffImage: the bytes decide, not the name or the declared type", () => {
  it("accepts JPEG, PNG, WebP and AVIF stills", () => {
    expect(sniffImage(jpeg)).toEqual({ ok: true, mime: "image/jpeg" });
    expect(sniffImage(png(["IHDR", "IDAT", "IEND"]))).toEqual({ ok: true, mime: "image/png" });
    expect(sniffImage(webp("VP8 "))).toEqual({ ok: true, mime: "image/webp" });
    expect(sniffImage(ftyp("avif"))).toEqual({ ok: true, mime: "image/avif" });
  });

  it("refuses animated PNG, WebP and AVIF", () => {
    expect(sniffImage(png(["IHDR", "acTL", "IDAT", "IEND"]))).toEqual({
      ok: false,
      reason: "animated",
    });
    expect(sniffImage(webp("VP8X", 0x02))).toEqual({ ok: false, reason: "animated" });
    expect(sniffImage(webp("VP8X", 0x10))).toEqual({ ok: true, mime: "image/webp" });
    expect(sniffImage(ftyp("avis"))).toEqual({ ok: false, reason: "animated" });
  });

  it("refuses GIF (the media pipeline cannot process it yet) with its own reason", () => {
    expect(sniffImage(Buffer.from("GIF89a\u0001\u0000", "latin1"))).toEqual({
      ok: false,
      reason: "gif_not_supported",
    });
  });

  it.each([
    ["SVG", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ["HTML disguised as an image", Buffer.from("<html><script>alert(1)</script></html>")],
    ["PDF", Buffer.from("%PDF-1.7\n")],
    ["HEIC", ftyp("heic")],
    ["a script", Buffer.from("#!/bin/sh\nrm -rf /")],
  ])("refuses %s", (_name, bytes) => {
    expect(sniffImage(bytes)).toEqual({ ok: false, reason: "unrecognised" });
  });

  it("refuses an empty file", () => {
    expect(sniffImage(Buffer.alloc(0))).toEqual({ ok: false, reason: "empty" });
  });
});

describe("assertAcceptableImage", () => {
  it("returns the sniffed mime and the sha-256 of the bytes", () => {
    expect(assertAcceptableImage(jpeg)).toEqual({ mime: "image/jpeg", sha256: sha256Hex(jpeg) });
    expect(sha256Hex(Buffer.from("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("answers UNSUPPORTED_MEDIA (415) for the wrong type", () => {
    expect(() => assertAcceptableImage(Buffer.from("<svg/>"))).toThrowError(
      expect.objectContaining({ code: ErrorCode.UNSUPPORTED_MEDIA, httpStatus: 415 }),
    );
  });

  it("answers PAYLOAD_TOO_LARGE (413) over 10 MB, before looking at the type", () => {
    const big = Buffer.concat([jpeg, Buffer.alloc(PUBLISH_MEDIA_MAX_BYTES)]);
    expect(() => assertAcceptableImage(big)).toThrowError(
      expect.objectContaining({ code: ErrorCode.PAYLOAD_TOO_LARGE, httpStatus: 413 }),
    );
    expect(PUBLISH_MEDIA_MAX_BYTES).toBe(10 * 1024 * 1024);
  });
});
