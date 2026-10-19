import {
  MEDIA_FORMAT_MIME,
  type ContentImageAsset,
  type MediaFormat,
} from "@wasfa/shared/schemas/media";

import { publicEnv } from "../lib/env";

import type { CSSProperties } from "react";

export interface ContentImageProps {
  asset: ContentImageAsset;
  /** The layout's real `sizes` attribute: the browser picks the variant from it. */
  sizes: string;
  /** Empty string marks the image as decorative. */
  alt: string;
  /** Lazy by default; pass `eager` for the LCP image (it also gets `fetchPriority="high"`). */
  loading?: "lazy" | "eager";
  className?: string;
  /** Where published media is served; defaults to `NEXT_PUBLIC_MEDIA_ORIGIN`. */
  origin?: string | undefined;
}

const SOURCE_FORMATS: readonly MediaFormat[] = ["avif", "webp"];

/**
 * A pre-built variant set as `<picture>` (CONTENT-PLATFORM §5.4): AVIF and WebP `<source>`s with
 * `srcset`, a JPEG `<img>` fallback, explicit `width`/`height` so nothing shifts, and the 16 px
 * blur placeholder as background until the picture decodes. No image optimisation server is
 * involved: the CDN serves the immutable files. The focal point only matters when CSS crops the
 * box (`object-fit: cover`), which is why it becomes `object-position`.
 * Renders nothing for an asset without variants or when no media origin is configured.
 */
export function ContentImage({
  asset,
  sizes,
  alt,
  loading = "lazy",
  className,
  origin = publicEnv.NEXT_PUBLIC_MEDIA_ORIGIN,
}: ContentImageProps) {
  if (origin === undefined || asset.width === null || asset.height === null) return null;
  const base = origin.replace(/\/+$/, "");
  const url = (key: string) => `${base}/${key}`;
  const srcSet = (format: MediaFormat) =>
    asset.variants
      .filter((variant) => variant.format === format)
      .toSorted((a, b) => a.width - b.width)
      .map((variant) => `${url(variant.key)} ${String(variant.width)}w`)
      .join(", ");

  const jpegs = asset.variants
    .filter((variant) => variant.format === "jpeg")
    .toSorted((a, b) => a.width - b.width);
  const fallback = jpegs.at(-1);
  if (fallback === undefined) return null;

  const style: CSSProperties = {
    objectPosition: `${String(asset.focalX)}% ${String(asset.focalY)}%`,
    ...(asset.blurDataUrl === null
      ? {}
      : { backgroundImage: `url(${asset.blurDataUrl})`, backgroundSize: "cover" }),
  };

  return (
    <picture>
      {SOURCE_FORMATS.map((format) => {
        const set = srcSet(format);
        return set === "" ? null : (
          <source key={format} type={MEDIA_FORMAT_MIME[format]} srcSet={set} sizes={sizes} />
        );
      })}
      <img
        src={url(fallback.key)}
        srcSet={srcSet("jpeg")}
        sizes={sizes}
        width={asset.width}
        height={asset.height}
        alt={alt}
        loading={loading}
        decoding="async"
        {...(loading === "eager" ? { fetchPriority: "high" as const } : {})}
        {...(className === undefined ? {} : { className })}
        style={style}
      />
    </picture>
  );
}
