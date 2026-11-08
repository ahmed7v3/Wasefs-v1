import { parseAdSize, type AdDevice, type AdSlotView, type PageClass } from "@wasfa/shared/ads";
import { t } from "@wasfa/shared/i18n";
import { cn } from "@wasfa/ui";
import Image from "next/image";

import { getAdSlot } from "../../lib/ads-server";

import { AdBeacon } from "./ad-beacon";

import type { CSSProperties } from "react";

export interface AdSlotProps {
  /** A catalog key (docs/ADS.md §3), e.g. `home.mid`. */
  placement: string;
  /** The route's declared class (`adClass` of its `ad-class.ts`); the floor classes render nothing. */
  pageClass: PageClass;
  locale?: "ar" | "en";
  device?: AdDevice;
  country?: string;
  className?: string;
}

type BoxVars = CSSProperties & Record<`--${string}`, string>;

/** CSS `aspect-ratio` and width cap of a `WxH` size; `native` cards use a 16:9 picture. */
function box(slot: AdSlotView): BoxVars {
  const desktop = parseAdSize(slot.sizeDesktop);
  const mobile = parseAdSize(slot.sizeMobile) ?? desktop;
  const fallback = { width: 640, height: 360 };
  const d = desktop ?? fallback;
  const m = mobile ?? fallback;
  return {
    "--ad-ar-m": `${String(m.width)} / ${String(m.height)}`,
    "--ad-ar-d": `${String(d.width)} / ${String(d.height)}`,
    "--ad-w": `${String(d.width)}px`,
  };
}

/**
 * One ad slot, rendered on the server (docs/ADS.md, openspec ads/placements). The API picks the
 * creative (floor, schedule, targeting, density, ad-free plans); when there is none the slot renders
 * nothing, so no box is reserved for an ad that will not come. When there is one, its box is
 * reserved here with the placement's aspect ratio (zero layout shift), it is labelled «إعلان» /
 * "Sponsored" by code, and it links through the first-party redirect with `rel="sponsored noopener"`.
 * No ad JavaScript beyond the viewability beacon island. The fixed bottom banner is not this
 * component (it needs its own island so it never covers content).
 */
export async function AdSlot({
  placement,
  pageClass,
  locale = "ar",
  device,
  country,
  className,
}: AdSlotProps) {
  const slot = await getAdSlot({ placement, pageClass, locale, device, country });
  if (!slot || slot.format === "bottom_banner") return null;

  const label = t("ads.label", undefined, locale);
  const { creative } = slot;
  const native = slot.format === "native";

  return (
    <aside
      aria-label={label}
      data-ad-placement={slot.placement}
      style={box(slot)}
      className={cn("mx-auto w-full max-w-(--ad-w)", className)}
    >
      <AdBeacon token={slot.token}>
        <p className="mb-1 text-xs text-text-muted">{label}</p>
        <a
          href={`/a/${slot.token}`}
          rel="sponsored noopener"
          className={cn(
            "block overflow-hidden rounded-lg border border-border bg-surface",
            native && "flex flex-col gap-2 p-2",
          )}
        >
          {creative.image ? (
            <span
              className={cn(
                "relative block w-full overflow-hidden rounded-md",
                native ? "aspect-video" : "aspect-(--ad-ar-m) md:aspect-(--ad-ar-d)",
              )}
            >
              <Image
                src={creative.image.url}
                alt={creative.alt}
                fill
                unoptimized
                sizes="(min-width: 768px) 970px, 100vw"
                className="object-cover"
              />
            </span>
          ) : (
            <span
              className={cn(
                "flex w-full items-center justify-center p-3 text-center text-sm text-text",
                !native && "aspect-(--ad-ar-m) md:aspect-(--ad-ar-d)",
              )}
            >
              {creative.title}
            </span>
          )}
          {native && creative.image ? (
            <span className="block text-sm font-medium text-text">{creative.title}</span>
          ) : null}
          {native && creative.advertiserName ? (
            <span className="block text-xs text-text-muted">{creative.advertiserName}</span>
          ) : null}
        </a>
      </AdBeacon>
    </aside>
  );
}
