"use client";

import { useCallback, useMemo, useState } from "react";

import { userTransportFor } from "./capture/transports";
import { createCaptureUploader } from "./capture/uploader";

import type { CapturePage } from "@wasfa/ui";

/**
 * Pictures attached to the message being written. The shared `CaptureSurface` (inside the
 * composer) owns the pages and their uploads; this hook only keeps what the message needs: the
 * file ids of the pages that are uploaded, in tray order, and a way to forget them after a send.
 */
export function useChatAttachments() {
  // Chat pictures are `chat_image` files (the API refuses a prescription page in a message).
  const uploader = useMemo(() => createCaptureUploader(userTransportFor("chat_image")), []);
  const [pages, setPages] = useState<CapturePage[]>([]);
  const [resetKey, setResetKey] = useState(0);

  /** Forgets the attachments after a send (their files now belong to the message). */
  const clear = useCallback(() => {
    setResetKey((current) => current + 1);
    setPages([]);
  }, []);

  return {
    uploader,
    /** Pass to `Composer.onPagesChange`. */
    onPagesChange: setPages,
    /** Pass to `Composer.captureResetKey`: the surface is mounted afresh when it changes. */
    resetKey,
    /** Pages on screen, uploaded or not (the rx suggestion shows as soon as there is one). */
    count: pages.length,
    fileIds: pages.flatMap((page) =>
      page.status === "uploaded" && page.fileId ? [page.fileId] : [],
    ),
    clear,
  };
}
