"use client";

import {
  renderPreviewResponseSchema,
  type ContentFlags,
  type RenderPreviewResponse,
} from "@wasfa/shared/schemas/content";
import { useEffect, useRef, useState } from "react";

import { api } from "../api-client";

import type { ContentLocale, ContentType } from "@wasfa/shared/content/constants";

export const PREVIEW_DEBOUNCE_MS = 600;

export type PreviewState =
  | { status: "idle" }
  | { status: "loading"; previous: RenderPreviewResponse | null }
  | { status: "ready"; result: RenderPreviewResponse }
  | { status: "error"; previous: RenderPreviewResponse | null };

export interface PreviewInput {
  enabled: boolean;
  type: ContentType;
  locale: ContentLocale;
  bodyMd: string;
  flags: Pick<ContentFlags, "showToc" | "autoLink">;
}

/**
 * Debounced server render of the body (`POST /admin/content/render-preview`): what the preview shows is
 * what publishing will store, because it is the same renderer. A newer keystroke cancels the request in
 * flight; `stale` is true from the first keystroke until the matching answer arrives, so the pane can
 * say "updating" instead of showing old text as if it were current.
 */
export function useRenderPreview(input: PreviewInput): { state: PreviewState; stale: boolean } {
  const { enabled, type, locale, bodyMd } = input;
  const { showToc, autoLink } = input.flags;
  const [state, setState] = useState<PreviewState>({ status: "idle" });
  const [stale, setStale] = useState(false);
  const last = useRef<RenderPreviewResponse | null>(null);

  useEffect(() => {
    if (!enabled) return;
    setStale(true);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setState({ status: "loading", previous: last.current });
      api("/admin/content/render-preview", {
        method: "POST",
        body: { type, locale, bodyMd, flags: { showToc, autoLink } },
        schema: renderPreviewResponseSchema,
        signal: controller.signal,
      }).then(
        (result) => {
          last.current = result;
          setState({ status: "ready", result });
          setStale(false);
        },
        () => {
          if (controller.signal.aborted) return;
          setState({ status: "error", previous: last.current });
          setStale(false);
        },
      );
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, type, locale, bodyMd, showToc, autoLink]);

  return { state, stale };
}
