"use client";

import { t } from "@wasfa/shared/i18n";
import { Button, cn } from "@wasfa/ui";
import { ExternalLink, ImageOff, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { useState } from "react";

const ZOOMS = ["scale-100", "scale-125", "scale-150", "scale-200"] as const;
const ROTATIONS = ["rotate-0", "rotate-90", "rotate-180", "-rotate-90"] as const;

export interface ProofViewerProps {
  /** A short-lived presigned link; `null` when the payment has no proof yet. */
  src: string | null;
  /** A proof exists but no link could be signed right now. */
  unavailable: boolean;
  alt: string;
}

/**
 * The transfer proof next to the checklist: zoom in steps, rotate by quarter turns, open full size.
 * Steps are fixed classes (no inline styles); a missing or unsigned proof says so instead of an empty box.
 */
export function ProofViewer({ src, unavailable, alt }: ProofViewerProps) {
  const [zoom, setZoom] = useState(0);
  const [turn, setTurn] = useState(0);
  const [failed, setFailed] = useState(false);

  if (src === null || unavailable || failed) {
    return (
      <div
        role="status"
        className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-neutral-50 p-6 text-center text-text-muted"
      >
        <ImageOff aria-hidden className="size-8" />
        <p className="text-base font-semibold text-text">
          {src === null && !unavailable
            ? t("admin.revenue.review.noProof")
            : t("admin.revenue.review.proofUnavailable")}
        </p>
        {src !== null || unavailable ? (
          <p className="text-sm">{t("admin.revenue.review.proofUnavailableHint")}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          name="zoom-out"
          disabled={zoom === 0}
          onClick={() => {
            setZoom((value) => Math.max(0, value - 1));
          }}
        >
          <ZoomOut aria-hidden className="size-5" />
          <span className="sr-only">{t("admin.revenue.review.zoomOut")}</span>
        </Button>
        <Button
          variant="secondary"
          name="zoom-in"
          disabled={zoom === ZOOMS.length - 1}
          onClick={() => {
            setZoom((value) => Math.min(ZOOMS.length - 1, value + 1));
          }}
        >
          <ZoomIn aria-hidden className="size-5" />
          <span className="sr-only">{t("admin.revenue.review.zoomIn")}</span>
        </Button>
        <Button
          variant="secondary"
          name="rotate"
          onClick={() => {
            setTurn((value) => (value + 1) % ROTATIONS.length);
          }}
        >
          <RotateCw aria-hidden className="size-5" />
          <span className="sr-only">{t("admin.revenue.review.rotate")}</span>
        </Button>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-base font-semibold text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus"
        >
          <ExternalLink aria-hidden className="size-5" />
          {t("admin.revenue.review.openFull")}
        </a>
      </div>
      <div className="max-h-[32rem] overflow-auto rounded-lg border border-border bg-neutral-50">
        {/* A signed link to a private bucket: next/image would proxy it, so a plain img is correct. */}
        <img
          src={src}
          alt={alt}
          onError={() => {
            setFailed(true);
          }}
          className={cn(
            "mx-auto block max-w-full origin-center transition-transform duration-150",
            ZOOMS[zoom],
            ROTATIONS[turn],
          )}
        />
      </div>
    </div>
  );
}
