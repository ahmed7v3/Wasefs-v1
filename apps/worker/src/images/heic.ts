import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";

import { ImageRejected } from "./rejected.js";

/*
 * HEIC / HEIF decoding (docs/RX-ENGINE.md S0 "Decode"). `heic-decode` is libheif compiled to WASM:
 * pure JS, no native binary, so the worker image needs nothing extra. It decodes synchronously and
 * a hostile file can spin it, so it runs in a `worker_threads` worker that is terminated after
 * HEIC_DECODE_TIMEOUT_MS. The size is read first and anything over the pixel limit is refused before
 * a single pixel is decoded. The worker source is inline (an eval worker) so it needs no build asset.
 */

export const HEIC_DECODE_TIMEOUT_MS = 20_000;

export interface RawRgba {
  data: Buffer;
  width: number;
  height: number;
}

const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  const decode = require(workerData.modulePath);
  const images = await decode.all({ buffer: workerData.buffer });
  try {
    const first = images[0];
    if (first === undefined) throw new Error("no image");
    if (first.width * first.height > workerData.maxPixels) {
      parentPort.postMessage({ ok: false, reason: "too_many_pixels" });
      return;
    }
    const { width, height, data } = await first.decode();
    const copy = new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
    parentPort.postMessage({ ok: true, width, height, data: copy.buffer }, [copy.buffer]);
  } finally {
    images.dispose();
  }
})().catch(() => parentPort.postMessage({ ok: false, reason: "corrupt_image" }));
`;

type WorkerMessage =
  | { ok: true; width: number; height: number; data: ArrayBuffer }
  | { ok: false; reason: "too_many_pixels" | "corrupt_image" };

/** Decodes the first image of a HEIC/HEIF file to raw RGBA, or throws `ImageRejected`. */
export function decodeHeic(
  input: Buffer,
  maxPixels: number,
  timeoutMs: number = HEIC_DECODE_TIMEOUT_MS,
): Promise<RawRgba> {
  const modulePath = createRequire(import.meta.url).resolve("heic-decode");
  return new Promise<RawRgba>((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { modulePath, buffer: input, maxPixels },
    });
    const finish = (settle: () => void) => {
      clearTimeout(timer);
      void worker.terminate();
      settle();
    };
    const timer = setTimeout(() => {
      finish(() => {
        reject(new ImageRejected("corrupt_image"));
      });
    }, timeoutMs);
    worker.once("message", (message: WorkerMessage) => {
      finish(() => {
        if (!message.ok) {
          reject(new ImageRejected(message.reason));
          return;
        }
        resolve({
          data: Buffer.from(message.data),
          width: message.width,
          height: message.height,
        });
      });
    });
    worker.once("error", () => {
      finish(() => {
        reject(new ImageRejected("corrupt_image"));
      });
    });
    worker.once("exit", () => {
      finish(() => {
        reject(new ImageRejected("corrupt_image"));
      });
    });
  });
}
