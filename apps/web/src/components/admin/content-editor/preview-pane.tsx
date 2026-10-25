"use client";

import { t } from "@wasfa/shared/i18n";
import { Spinner } from "@wasfa/ui";
import { X } from "lucide-react";
import { useState } from "react";

import { tOr } from "../../../lib/admin-format";

import type { PreviewState } from "../../../lib/content-editor/use-render-preview";
import type { ContentLocale } from "@wasfa/shared/content/constants";
import type { RenderPreviewResponse } from "@wasfa/shared/schemas/content";

export interface PreviewPaneProps {
  state: PreviewState;
  stale: boolean;
  locale: ContentLocale;
}

/** The server's warning codes (`renderContent`) with an editor-facing sentence each. */
export const PREVIEW_WARNING_CODES = [
  "bidi_controls_removed",
  "block_in_inline",
  "cta_duplicate",
  "external_image_refused",
  "h1_in_body",
  "heading_clamped",
  "heading_skip",
  "invalid_directive",
  "media_not_ready",
  "raw_html_dropped",
  "unknown_cta",
  "unknown_directive",
  "unknown_drug",
  "unknown_glossary",
  "unknown_media",
  "unsafe_link_removed",
] as const;

export function previewWarningMessage(warning: {
  code: string;
  detail?: string | undefined;
}): string {
  const detail = warning.detail ?? "";
  return tOr(
    `admin.editor.warning.${warning.code}`,
    t("admin.editor.warning.unknown", { code: warning.code }),
    { detail },
  );
}

function resultOf(state: PreviewState): RenderPreviewResponse | null {
  if (state.status === "ready") return state.result;
  if (state.status === "loading" || state.status === "error") return state.previous;
  return null;
}

/**
 * The live preview: the stored-HTML markup rendered with the same `.content-prose` class the public
 * pages use. `dangerouslySetInnerHTML` is acceptable ONLY here: the HTML is the server renderer's
 * output, already passed through its sanitiser allow-list (CONTENT-PLATFORM §11.3); nothing the browser
 * composes ever reaches it. Render warnings are a dismissible list; while a newer render is pending the
 * pane says so instead of presenting old text as current.
 */
export function PreviewPane({ state, stale, locale }: PreviewPaneProps) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const result = resultOf(state);
  const warnings = (result?.warnings ?? []).filter(
    (warning) => !dismissed.has(`${warning.code}:${warning.detail ?? ""}`),
  );

  return (
    <section aria-label={t("admin.editor.preview.title")} className="flex min-w-0 flex-col gap-3">
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-6 items-center gap-2 text-sm text-text-muted"
      >
        {stale || state.status === "loading" ? (
          <>
            <Spinner decorative />
            {t("admin.editor.preview.updating")}
          </>
        ) : state.status === "error" ? (
          <span className="text-danger">{t("admin.editor.preview.failed")}</span>
        ) : result ? (
          t("admin.editor.preview.current")
        ) : null}
      </div>

      {warnings.length > 0 ? (
        <ul aria-label={t("admin.editor.preview.warnings")} className="flex flex-col gap-2">
          {warnings.map((warning) => {
            const key = `${warning.code}:${warning.detail ?? ""}`;
            return (
              <li
                key={key}
                className="flex items-start justify-between gap-2 rounded-lg border border-warning bg-warning-soft ps-3 text-base text-text"
              >
                <span className="py-2">{previewWarningMessage(warning)}</span>
                <button
                  type="button"
                  aria-label={t("admin.editor.preview.dismiss")}
                  onClick={() => {
                    setDismissed((current) => new Set(current).add(key));
                  }}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-text-muted hover:text-text focus-visible:outline-none focus-visible:shadow-focus"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {result ? (
        <article
          className="content-prose min-w-0 break-words"
          dir={locale === "ar" ? "rtl" : "ltr"}
          lang={locale}
          // Server-sanitised HTML (see the note above); the only dangerouslySetInnerHTML in the editor.
          dangerouslySetInnerHTML={{ __html: result.html }}
        />
      ) : state.status === "idle" || state.status === "loading" ? null : (
        <p className="text-base text-text-muted">{t("admin.editor.preview.empty")}</p>
      )}
    </section>
  );
}
