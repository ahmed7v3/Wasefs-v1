import { fileStatusResponseSchema, fileUrlResponseSchema } from "@wasfa/shared/schemas/files";
import { createHandoffResponseSchema, handoffEventSchema } from "@wasfa/shared/schemas/handoff";

import { api } from "../api-client";
import { publicEnv } from "../env";

import { waitUntilProcessed } from "./upload-queue";

import type { HandoffClient } from "@wasfa/ui";

/** The link as an SVG data URL (`img-src` allows `data:`), drawn in the browser only. */
async function qrDataUrl(text: string): Promise<string | undefined> {
  try {
    const qr = await import("qrcode");
    const svg = await qr.toString(text, { type: "svg", margin: 1, width: 224 });
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  } catch {
    // No picture is fine: the panel always shows the link as text too.
    return undefined;
  }
}

/**
 * Desktop side of the phone handoff: asks for a token, listens to the SSE feed of this capture
 * session, and turns a phone page into something the tray can show.
 */
export function createHandoffClient(): HandoffClient {
  return {
    async start(captureSessionId) {
      const created = await api("/handoff", {
        method: "POST",
        body: { captureSessionId },
        schema: createHandoffResponseSchema,
      });
      return { url: created.url, expiresAt: created.expiresAt };
    },

    subscribe(captureSessionId, onFile) {
      const source = new EventSource(
        `${publicEnv.NEXT_PUBLIC_API_URL}/handoff/${captureSessionId}/events`,
        { withCredentials: true },
      );
      // EventSource reconnects by itself after a drop; a refusal (404) ends it for good.
      source.onmessage = (event: MessageEvent<string>) => {
        let raw: unknown;
        try {
          raw = JSON.parse(event.data);
        } catch {
          return;
        }
        const parsed = handoffEventSchema.safeParse(raw);
        if (parsed.success) onFile(parsed.data.fileId);
      };
      return () => {
        source.close();
      };
    },

    qr: qrDataUrl,

    async adopt(fileId, signal) {
      await waitUntilProcessed(
        (id, abort) => api(`/files/${id}`, { schema: fileStatusResponseSchema, signal: abort }),
        fileId,
        signal,
      );
      const { url } = await api(`/files/${fileId}/url`, {
        schema: fileUrlResponseSchema,
        signal,
      });
      return { previewUrl: url };
    },
  };
}
