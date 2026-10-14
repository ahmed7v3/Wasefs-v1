import { ImageDecodeError, normalizeBlob } from "./normalize-core";

import type { PreparedImage } from "@wasfa/ui";

/** Messages between `normalize-image.ts` and this worker. */
export type NormalizeReply =
  { ok: true; image: PreparedImage } | { ok: false; reason: "decode" | "unavailable" };

// The project compiles with the DOM lib only, so the worker scope is typed by hand.
interface WorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<Blob>) => void): void;
  postMessage(message: NormalizeReply): void;
}
const scope = self as unknown as WorkerScope;

scope.addEventListener("message", (event) => {
  normalizeBlob(event.data).then(
    (image) => {
      scope.postMessage({ ok: true, image });
    },
    (error: unknown) => {
      scope.postMessage({
        ok: false,
        reason: error instanceof ImageDecodeError ? "decode" : "unavailable",
      });
    },
  );
});
