"use client";

import { linkSuggestionsResponseSchema } from "@wasfa/shared/schemas/content";
import { useEffect, useState } from "react";

import { api } from "../api-client";

import type { ContentLocale } from "@wasfa/shared/content/constants";
import type { z } from "zod";

export type LinkSuggestion = z.output<typeof linkSuggestionsResponseSchema>["items"][number];

export const LINK_SUGGESTION_DEBOUNCE_MS = 600;
export const LINK_SUGGESTION_MIN_QUERY = 3;

/**
 * Internal-link suggestions for the words the author is on (`GET /admin/content/link-suggestions`),
 * debounced so moving the caret does not hammer the API; a newer query cancels the one in flight and
 * a failure just means no suggestions (it is a hint, never a blocker).
 */
export function useLinkSuggestions(
  itemId: string | null,
  query: string,
  locale: ContentLocale,
): { items: LinkSuggestion[]; loading: boolean } {
  const [items, setItems] = useState<LinkSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const clean = query.trim();

  useEffect(() => {
    if (itemId === null || clean.length < LINK_SUGGESTION_MIN_QUERY) {
      setItems([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ itemId, q: clean, locale });
      api(`/admin/content/link-suggestions?${params.toString()}`, {
        schema: linkSuggestionsResponseSchema,
        signal: controller.signal,
      }).then(
        (response) => {
          setItems(response.items);
          setLoading(false);
        },
        () => {
          if (controller.signal.aborted) return;
          setItems([]);
          setLoading(false);
        },
      );
    }, LINK_SUGGESTION_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [itemId, clean, locale]);

  return { items, loading };
}
