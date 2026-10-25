"use client";

import { cn } from "@wasfa/ui";
import { ImageOff } from "lucide-react";

import { publicEnv } from "../../../lib/env";
import { mediaObjectUrl, thumbnailKey } from "../../../lib/media-upload";

import type { MediaAsset } from "@wasfa/shared/schemas/media";

export interface AssetThumbProps {
  asset: Pick<MediaAsset, "variants" | "blurDataUrl" | "altAr" | "originalFilename">;
  className?: string | undefined;
}

/** The smallest variant of a library image; a placeholder icon while it has none. Decorative: the name sits beside it. */
export function AssetThumb({ asset, className }: AssetThumbProps) {
  const key = thumbnailKey(asset);
  const src = key ? mediaObjectUrl(key, publicEnv.NEXT_PUBLIC_MEDIA_ORIGIN) : null;
  return (
    <div
      className={cn("relative aspect-video w-full overflow-hidden bg-neutral-100", className)}
      style={
        asset.blurDataUrl
          ? { backgroundImage: `url(${asset.blurDataUrl})`, backgroundSize: "cover" }
          : undefined
      }
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- immutable CDN variants, no optimiser involved
        <img src={src} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center text-text-muted">
          <ImageOff aria-hidden className="size-8" />
        </div>
      )}
    </div>
  );
}
