import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { decodeHeic } from "../src/images/heic.js";
import { ImageRejected } from "../src/images/rejected.js";

/*
 * HEIC decoding runs in a worker thread (src/images/heic.ts). No offline HEVC encoder exists in this
 * repo, so there is no real photo fixture: these tests cover the module wiring and the failure
 * paths; a real iPhone photo is the manual check.
 */

const headerOnly = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from("ftypheic", "ascii"),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from("mif1heic", "ascii"),
]);

async function reason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ImageRejected) return error.reason;
    throw error;
  }
  return "accepted";
}

describe("decodeHeic", () => {
  it("resolves the decoder package the worker thread loads", () => {
    const decode = createRequire(import.meta.url)("heic-decode") as { all: unknown };
    expect(typeof decode.all).toBe("function");
  });

  it("rejects a file that only looks like HEIC as corrupt", async () => {
    expect(await reason(decodeHeic(headerOnly, 40_000_000))).toBe("corrupt_image");
  });

  it("rejects when the time cap passes before the decoder answers", async () => {
    expect(await reason(decodeHeic(headerOnly, 40_000_000, 1))).toBe("corrupt_image");
  });
});
