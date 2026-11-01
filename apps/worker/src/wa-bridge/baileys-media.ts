import { downloadMediaMessage, type WAMessage, type WASocket } from "@whiskeysockets/baileys";

import type { DownloadIo } from "./agent-media-download.js";
import type { RawMessage } from "./inbound.js";
import type { Logger } from "pino";

/** The download / re-upload half of `MediaIo`, over a live Baileys socket. */
export function baileysMediaIo(
  socket: Pick<WASocket, "updateMediaMessage">,
  logger: Logger,
): Required<DownloadIo> {
  return {
    download: (raw, signal) =>
      downloadMediaMessage(
        raw as unknown as WAMessage,
        "buffer",
        signal === undefined ? {} : { options: { signal } },
        {
          logger,
          // The caller (agent-media-download) owns the one re-upload request on a 404 / 410;
          // Baileys' own would hide it, so its hook just reports "gone" back.
          reuploadRequest: () =>
            Promise.reject(Object.assign(new Error("media gone"), { status: 410 })),
        },
      ),
    reupload: async (raw) =>
      (await socket.updateMediaMessage(raw as unknown as WAMessage)) as unknown as RawMessage,
  };
}
