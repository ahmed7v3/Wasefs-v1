"use client";

import { adminSearchResponseSchema } from "@wasfa/shared/schemas/admin-billing-console";
import { useEffect, useState } from "react";

import { api } from "./api-client";

import type { z } from "zod";

export type SearchItem = z.output<typeof adminSearchResponseSchema>["items"][number];
export type SearchType = SearchItem["type"];

/** The API refuses queries under two characters; the palette does not even ask. */
export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_DEBOUNCE_MS = 250;

export type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ready"; items: SearchItem[] };

/** Debounced `GET /admin/search?q=`; a late answer for an older query is dropped. */
export function useAdminSearch(query: string): SearchState {
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < SEARCH_MIN_LENGTH) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "loading" });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api(`/admin/search?q=${encodeURIComponent(trimmed)}`, {
        schema: adminSearchResponseSchema,
        signal: controller.signal,
      }).then(
        (data) => {
          setState({ status: "ready", items: data.items });
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          setState({ status: "error", error });
        },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);

  return state;
}
