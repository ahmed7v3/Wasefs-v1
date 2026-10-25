"use client";

import { contentItemDetailSchema, type ContentItemDetail } from "@wasfa/shared/schemas/content";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../api-client";

export type ContentItemState =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ready"; detail: ContentItemDetail };

/**
 * `GET /admin/content/items/:id`. Unlike `useResource` it hands back the fresh detail from `refetch`,
 * because the editor must decide after every write whether the draft can be replaced by the server
 * copy (nothing typed meanwhile) or has to be kept. `id: null` loads nothing (a new item).
 */
export function useContentItem(id: string | null): {
  state: ContentItemState;
  refetch: () => Promise<ContentItemDetail | null>;
} {
  const [state, setState] = useState<ContentItemState>({ status: "loading" });
  const idRef = useRef(id);
  idRef.current = id;
  const generation = useRef(0);

  const load = useCallback(async (signal?: AbortSignal): Promise<ContentItemDetail | null> => {
    const target = idRef.current;
    if (target === null) return null;
    const mine = ++generation.current;
    try {
      const detail = await api(`/admin/content/items/${target}`, {
        schema: contentItemDetailSchema,
        signal,
      });
      if (generation.current === mine) setState({ status: "ready", detail });
      return detail;
    } catch (error) {
      if (signal?.aborted) return null;
      // A failed REFRESH keeps the editor on screen; only the first load becomes an error page.
      if (generation.current === mine) {
        setState((current) => (current.status === "ready" ? current : { status: "error", error }));
      }
      throw error;
    }
  }, []);

  useEffect(() => {
    if (id === null) return;
    const controller = new AbortController();
    setState({ status: "loading" });
    load(controller.signal).catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [id, load]);

  const refetch = useCallback(() => load(), [load]);
  return { state, refetch };
}
