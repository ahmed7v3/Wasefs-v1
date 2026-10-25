import { t } from "@wasfa/shared/i18n";
import { cn } from "@wasfa/ui";
import { ImageOff, Loader } from "lucide-react";

import { publicEnv } from "../../lib/env";
import { mediaObjectUrl, thumbnailKey } from "../../lib/media-upload";

import type { MediaAsset } from "@wasfa/shared/schemas/media";

export interface MediaThumbProps {
  asset: Pick<
    MediaAsset,
    | "status"
    | "variants"
    | "blurDataUrl"
    | "width"
    | "height"
    | "altAr"
    | "originalFilename"
    | "focalX"
    | "focalY"
  >;
  className?: string | undefined;
  origin?: string | undefined;
}

/**
 * A square thumbnail from the smallest variant, with the 16 px blur as its background until the file
 * decodes. A processing or rejected asset has no variants: it shows an icon with a word instead.
 */
export function MediaThumb({
  asset,
  className,
  origin = publicEnv.NEXT_PUBLIC_MEDIA_ORIGIN,
}: MediaThumbProps) {
  const key = asset.status === "ready" ? thumbnailKey(asset) : null;
  const src = key ? mediaObjectUrl(key, origin) : null;
  const frame = cn("relative aspect-square w-full overflow-hidden bg-neutral-100", className);

  if (src === null) {
    const waiting = asset.status === "processing" || asset.status === "staged";
    const Icon = waiting ? Loader : ImageOff;
    return (
      <div className={cn(frame, "flex flex-col items-center justify-center gap-1 text-text-muted")}>
        <Icon aria-hidden className="size-8" />
        <span className="text-sm">
          {t(
            asset.status === "ready"
              ? "admin.media.noPreview"
              : `admin.media.status.${asset.status}`,
          )}
        </span>
      </div>
    );
  }

  return (
    <div
      className={frame}
      style={
        asset.blurDataUrl
          ? { backgroundImage: `url(${asset.blurDataUrl})`, backgroundSize: "cover" }
          : undefined
      }
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- immutable CDN variants, no optimiser involved */}
      <img
        src={src}
        alt={asset.altAr ?? asset.originalFilename ?? ""}
        loading="lazy"
        decoding="async"
        className="size-full object-cover"
        style={{ objectPosition: `${String(asset.focalX)}% ${String(asset.focalY)}%` }}
      />
    </div>
  );
}
