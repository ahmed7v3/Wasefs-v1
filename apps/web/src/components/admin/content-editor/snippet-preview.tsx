import { t } from "@wasfa/shared/i18n";

import { snippetFor, snippetUrl, type SnippetDevice } from "../../../lib/content-editor/snippet";

import type { ContentLocale } from "@wasfa/shared/content/constants";

export interface SnippetPreviewProps {
  title: string;
  description: string;
  origin: string;
  path: string;
  locale: ContentLocale;
}

function One({ device, ...props }: SnippetPreviewProps & { device: SnippetDevice }) {
  const snippet = snippetFor({ title: props.title, description: props.description }, device);
  return (
    <figure
      data-testid={`snippet-${device}`}
      className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-surface p-3"
      style={{ maxInlineSize: device === "desktop" ? "37.5rem" : "22.5rem" }}
    >
      <figcaption className="text-xs font-semibold text-text-muted">
        {t(device === "desktop" ? "admin.editor.snippet.desktop" : "admin.editor.snippet.mobile")}
      </figcaption>
      <div
        dir={props.locale === "ar" ? "rtl" : "ltr"}
        lang={props.locale}
        className="flex flex-col gap-0.5"
      >
        <span dir="ltr" className="truncate text-start text-xs text-text-muted">
          {snippetUrl(props.origin, props.path)}
        </span>
        <span className="break-words text-xl leading-snug text-primary" data-testid="snippet-title">
          {snippet.title.text || t("admin.editor.snippet.noTitle")}
        </span>
        <span
          className="break-words text-sm leading-snug text-text-muted"
          data-testid="snippet-description"
        >
          {snippet.description.text || t("admin.editor.snippet.noDescription")}
        </span>
      </div>
    </figure>
  );
}

/**
 * A Google-style result card for the desktop and the mobile layout. Truncation is by an estimated
 * PIXEL width (`snippet.ts`), not by characters, with the text direction of the content's language.
 */
export function SnippetPreview(props: SnippetPreviewProps) {
  return (
    <div className="flex flex-col gap-3">
      <One device="desktop" {...props} />
      <One device="mobile" {...props} />
    </div>
  );
}
