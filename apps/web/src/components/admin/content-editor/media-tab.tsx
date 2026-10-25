"use client";

import { t } from "@wasfa/shared/i18n";
import { MEDIA_MIMES } from "@wasfa/shared/schemas/media";
import { Button } from "@wasfa/ui";
import { ImagePlus, Upload } from "lucide-react";
import { useMemo, useRef } from "react";

import { extractImages } from "../../../lib/content-editor/markdown-facts";

import { AssetThumb } from "./asset-thumb";

import type { ContentLocale } from "@wasfa/shared/content/constants";
import type { MediaAsset } from "@wasfa/shared/schemas/media";

export interface MediaTabProps {
  bodyMd: string;
  locale: ContentLocale;
  featured: MediaAsset | null;
  readOnly: boolean;
  onPickFeatured: () => void;
  onInsertFromLibrary: () => void;
  onUploadFiles: (files: File[]) => void;
}

/** Everything about the article's pictures: the featured image, a new image into the text, and the alt-text audit of the images already there. */
export function MediaTab({
  bodyMd,
  locale,
  featured,
  readOnly,
  onPickFeatured,
  onInsertFromLibrary,
  onUploadFiles,
}: MediaTabProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const images = useMemo(() => extractImages(bodyMd), [bodyMd]);
  const featuredAlt = featured ? (locale === "en" ? featured.altEn : featured.altAr) : null;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" aria-label={t("admin.editor.field.featured")}>
        <h3 className="text-base font-semibold text-text">{t("admin.editor.field.featured")}</h3>
        {featured ? (
          <>
            <AssetThumb asset={featured} className="max-w-sm rounded-lg" />
            {(featuredAlt ?? "").trim() === "" ? (
              <p role="status" className="text-sm text-warning">
                {t("admin.editor.featured.noAlt")}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-base text-text-muted">{t("admin.editor.featured.none")}</p>
        )}
        <Button
          variant="secondary"
          disabled={readOnly}
          onClick={onPickFeatured}
          className="self-start"
        >
          {t(featured ? "admin.editor.featured.change" : "admin.editor.featured.choose")}
        </Button>
      </section>

      <section className="flex flex-col gap-3" aria-label={t("admin.editor.media.insert")}>
        <h3 className="text-base font-semibold text-text">{t("admin.editor.media.insert")}</h3>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={readOnly} onClick={onInsertFromLibrary}>
            <ImagePlus aria-hidden className="size-5" />
            {t("admin.editor.media.fromLibrary")}
          </Button>
          <Button
            variant="secondary"
            disabled={readOnly}
            onClick={() => {
              fileRef.current?.click();
            }}
          >
            <Upload aria-hidden className="size-5" />
            {t("admin.editor.media.upload")}
          </Button>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            accept={MEDIA_MIMES.join(",")}
            aria-label={t("admin.editor.media.upload")}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (files.length > 0) onUploadFiles(files);
            }}
          />
        </div>
        <p className="text-sm text-text-muted">{t("admin.editor.media.pasteHint")}</p>
      </section>

      <section className="flex flex-col gap-2" aria-label={t("admin.editor.media.bodySection")}>
        <h3 className="text-base font-semibold text-text">
          {t("admin.editor.media.inBody", { count: images.length })}
        </h3>
        {images.length === 0 ? (
          <p className="text-base text-text-muted">{t("admin.editor.media.noneInBody")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {images.map((image, index) => (
              <li
                key={`${image.src}-${String(index)}`}
                className="rounded-lg border border-border p-3"
              >
                {image.alt === "" ? (
                  <p role="status" className="text-base text-warning">
                    {t("admin.editor.media.altMissing")}
                  </p>
                ) : (
                  <p className="text-base text-text">
                    <bdi>{image.alt}</bdi>
                  </p>
                )}
                {image.caption ? (
                  <p className="text-sm text-text-muted">
                    <bdi>{image.caption}</bdi>
                  </p>
                ) : null}
                {image.mediaId === null ? (
                  <p className="text-sm text-danger">{t("admin.editor.media.externalImage")}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
