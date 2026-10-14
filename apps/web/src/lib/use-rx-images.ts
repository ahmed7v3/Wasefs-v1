"use client";

import { fileUrlResponseSchema } from "@wasfa/shared/schemas/files";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./api-client";

import type { RxView } from "@wasfa/shared/schemas/rx";
import type { ViewerPage } from "@wasfa/ui";

interface Slot {
  url: string | null;
  failed: boolean;
}

/** A link that stops working (60 s) is re-fetched this many times before the page shows "failed". */
const MAX_REFRESHES = 2;

/**
 * The picture of each page for the viewer. `GET /files/:id/url` returns a link that lives 60
 * seconds, so a link is fetched when the result appears and again only if the browser could not
 * load the picture (`reload`). A picture removed by the retention job is never requested.
 */
export function useRxImages(files: RxView["files"], enabled: boolean) {
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const refreshes = useRef(new Map<string, number>());

  const fetchUrl = useCallback((fileId: string) => {
    api(`/files/${fileId}/url`, { schema: fileUrlResponseSchema }).then(
      (answer) => {
        setSlots((current) => ({ ...current, [fileId]: { url: answer.url, failed: false } }));
      },
      () => {
        setSlots((current) => ({ ...current, [fileId]: { url: null, failed: true } }));
      },
    );
  }, []);

  useEffect(() => {
    if (!enabled) return;
    for (const file of files) {
      if (file.imageDeleted || refreshes.current.has(file.fileId)) continue;
      refreshes.current.set(file.fileId, 0);
      fetchUrl(file.fileId);
    }
  }, [files, enabled, fetchUrl]);

  /** The browser could not load page `index` (an expired link) or the person pressed "try again". */
  const reload = useCallback(
    (index: number) => {
      const file = files[index];
      if (!file || file.imageDeleted) return;
      const used = refreshes.current.get(file.fileId) ?? 0;
      if (used >= MAX_REFRESHES) {
        setSlots((current) => ({ ...current, [file.fileId]: { url: null, failed: true } }));
        return;
      }
      refreshes.current.set(file.fileId, used + 1);
      setSlots((current) => ({ ...current, [file.fileId]: { url: null, failed: false } }));
      fetchUrl(file.fileId);
    },
    [files, fetchUrl],
  );

  /** "Try again" after a failure starts the count afresh. */
  const retry = useCallback(
    (index: number) => {
      const file = files[index];
      if (file) refreshes.current.set(file.fileId, 0);
      reload(index);
    },
    [files, reload],
  );

  const pages: ViewerPage[] = files.map((file) => {
    const slot = slots[file.fileId];
    return {
      src: slot?.url ?? null,
      deleted: file.imageDeleted,
      failed: slot?.failed ?? false,
    };
  });

  return { pages, reload, retry };
}
