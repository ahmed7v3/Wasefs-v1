"use client";

import { t } from "@wasfa/shared/i18n";
import { Crosshair } from "lucide-react";
import { useId, useRef } from "react";

import { focalFromKey, focalFromPointer, type FocalPoint } from "../../lib/media-focal";

import type { KeyboardEvent, PointerEvent } from "react";

export interface MediaFocalPickerProps {
  /** The image to pick on; `null` shows only the numeric readout and the keyboard control. */
  src: string | null;
  width: number | null;
  height: number | null;
  alt: string;
  value: FocalPoint;
  onChange: (value: FocalPoint) => void;
}

/**
 * Focal point picker: click, tap or drag on the image, or focus the crosshair and use the arrow keys
 * (Shift moves by 10, Home recentres). The point is what `object-position` uses when CSS crops the image.
 */
export function MediaFocalPicker({
  src,
  width,
  height,
  alt,
  value,
  onChange,
}: MediaFocalPickerProps) {
  const surface = useRef<HTMLDivElement>(null);
  const helpId = useId();

  const fromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = surface.current?.getBoundingClientRect();
    if (!box) return;
    onChange(focalFromPointer(event, box));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = focalFromKey(value, event.key, event.shiftKey);
    if (!next) return;
    event.preventDefault();
    onChange(next);
  };

  const ratio = width && height ? `${String(width)} / ${String(height)}` : "4 / 3";

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={surface}
        data-testid="focal-surface"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          fromPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons !== 0) fromPointer(event);
        }}
        className="relative w-full touch-none overflow-hidden rounded-lg border border-border bg-neutral-100 select-none"
        style={{ aspectRatio: ratio }}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- immutable CDN variant
          <img src={src} alt={alt} draggable={false} className="size-full object-contain" />
        ) : null}
        <button
          type="button"
          name="focal-point"
          aria-label={t("admin.media.focal.label", { x: value.x, y: value.y })}
          aria-describedby={helpId}
          onKeyDown={onKeyDown}
          // The crosshair is centred on the point; the button is the 44 px target for the keyboard.
          className="absolute flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-on-primary focus-visible:outline-none focus-visible:shadow-focus"
          // Physical `left`: the focal x is a percent of the picture, which is never mirrored in RTL.
          style={{ left: `${String(value.x)}%`, top: `${String(value.y)}%` }}
        >
          <Crosshair
            aria-hidden
            className="size-8 rounded-full bg-primary/70 p-1 drop-shadow"
            strokeWidth={2.5}
          />
        </button>
      </div>
      <p id={helpId} className="text-sm text-text-muted">
        {t("admin.media.focal.help")}
      </p>
      <p role="status" className="text-sm font-semibold tabular-nums text-text">
        {t("admin.media.focal.readout", { x: value.x, y: value.y })}
      </p>
    </div>
  );
}
