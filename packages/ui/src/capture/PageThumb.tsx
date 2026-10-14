import { t } from "@wasfa/shared/i18n";
import {
  ArrowLeft,
  ArrowRight,
  CircleAlert,
  CircleCheck,
  Crop,
  LoaderCircle,
  RotateCw,
  TriangleAlert,
  X,
} from "lucide-react";
import { useId } from "react";

import { cn } from "../cn";

import { arrowToDelta, isRtl } from "./transfer";

import type { CapturePage } from "./types";
import type { KeyboardEvent } from "react";

const ICON_BUTTON =
  "inline-flex size-11 items-center justify-center rounded-lg text-primary transition-colors duration-150 " +
  "hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-50";

export interface PageThumbProps {
  page: CapturePage;
  /** 0-based position. */
  index: number;
  total: number;
  /** `-1` earlier, `1` later (document order, not screen direction). */
  onMove: (delta: number) => void;
  onRemove: () => void;
  /** Absent when the page cannot be edited (it came from a phone and is not in this browser). */
  onEdit?: (() => void) | undefined;
  onRetry: () => void;
  compact?: boolean | undefined;
}

function StatusLine({ page }: { page: CapturePage }) {
  switch (page.status) {
    case "processing":
      return (
        <>
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
          {t("capture.page.status.processing")}
        </>
      );
    case "uploading":
      return (
        <>
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
          {t("capture.page.status.uploading", {
            percent: Math.round((page.progress ?? 0) * 100),
          })}
        </>
      );
    case "uploaded":
      return (
        <>
          <CircleCheck aria-hidden className="size-4 text-success" />
          {t("capture.page.status.uploaded")}
        </>
      );
    case "warning":
      return (
        <>
          <TriangleAlert aria-hidden className="size-4 text-warning" />
          {t("capture.page.status.warning")}
        </>
      );
    case "error":
      return (
        <>
          <CircleAlert aria-hidden className="size-4 text-danger" />
          {t("capture.page.status.error")}
        </>
      );
  }
}

/**
 * One page of the tray. The tile itself is focusable: the arrow keys reorder it (they follow what
 * is on screen, so in RTL the right arrow moves it toward the start), and the buttons below do the
 * same for pointer and touch users.
 */
export function PageThumb({
  page,
  index,
  total,
  onMove,
  onRemove,
  onEdit,
  onRetry,
  compact = false,
}: PageThumbProps) {
  const hintId = useId();
  const n = index + 1;

  function onKeyDown(event: KeyboardEvent<HTMLLIElement>) {
    // Keys pressed on the buttons inside belong to the buttons.
    if (event.target !== event.currentTarget) return;
    const delta = arrowToDelta(event.key, isRtl(event.currentTarget));
    if (delta === null) return;
    event.preventDefault();
    onMove(delta);
  }

  return (
    <li
      tabIndex={0}
      data-local-id={page.localId}
      data-status={page.status}
      aria-label={t("capture.page.label", { n, total })}
      aria-describedby={total > 1 ? hintId : undefined}
      onKeyDown={onKeyDown}
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-surface p-2 focus-visible:outline-none focus-visible:shadow-focus"
    >
      <div
        className={cn(
          "relative overflow-hidden rounded-lg bg-neutral-100",
          compact ? "aspect-square" : "aspect-[3/4]",
        )}
      >
        {page.previewUrl ? (
          <img
            src={page.previewUrl}
            alt={t("capture.page.alt", { n })}
            className="size-full object-cover"
          />
        ) : (
          <span className="flex size-full items-center justify-center text-neutral-600">
            <LoaderCircle aria-hidden className="size-8 animate-spin" />
          </span>
        )}
        <span
          aria-hidden="true"
          className="absolute start-2 top-2 inline-flex size-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-on-primary tabular-nums"
        >
          {n}
        </span>
        {page.status === "uploading" ? (
          <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1.5 bg-neutral-200">
            <span
              className="block h-full bg-primary transition-[width] duration-150"
              style={{ width: `${Math.round((page.progress ?? 0) * 100)}%` }}
            />
          </span>
        ) : null}
      </div>
      <p className="flex items-center gap-1.5 text-sm font-semibold text-text">
        <StatusLine page={page} />
      </p>
      {page.status === "error" ? (
        <div className="flex flex-col gap-1 text-sm text-danger" role="alert">
          {page.errorMessage ? <p>{page.errorMessage}</p> : null}
          {page.errorRef ? (
            <p>
              <bdi className="rounded-full bg-danger-soft px-2 py-0.5 font-semibold">
                {t("capture.error.ref", { ref: page.errorRef })}
              </bdi>
            </p>
          ) : null}
          <button
            type="button"
            onClick={onRetry}
            aria-label={t("capture.page.retryLabel", { n })}
            className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-lg px-2 font-semibold text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus"
          >
            <RotateCw aria-hidden className="size-4 rtl:-scale-x-100" />
            {t("capture.page.retry")}
          </button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-center gap-1">
        {total > 1 ? (
          <>
            <button
              type="button"
              disabled={index === 0}
              onClick={() => {
                onMove(-1);
              }}
              aria-label={t("capture.page.earlier", { n })}
              className={ICON_BUTTON}
            >
              <ArrowRight aria-hidden className="size-5 rtl:hidden" />
              <ArrowLeft aria-hidden className="hidden size-5 rtl:block" />
            </button>
            <button
              type="button"
              disabled={index === total - 1}
              onClick={() => {
                onMove(1);
              }}
              aria-label={t("capture.page.later", { n })}
              className={ICON_BUTTON}
            >
              <ArrowLeft aria-hidden className="size-5 rtl:hidden" />
              <ArrowRight aria-hidden className="hidden size-5 rtl:block" />
            </button>
          </>
        ) : null}
        {onEdit ? (
          <button
            type="button"
            disabled={page.previewUrl === "" || page.status === "uploading"}
            onClick={onEdit}
            aria-label={t("capture.page.edit", { n })}
            className={ICON_BUTTON}
          >
            <Crop aria-hidden className="size-5" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("capture.page.remove", { n })}
          className={cn(ICON_BUTTON, "text-danger hover:bg-danger-soft")}
        >
          <X aria-hidden className="size-5" />
        </button>
      </div>
      {total > 1 ? (
        <span id={hintId} className="sr-only">
          {t("capture.tray.reorderHint")}
        </span>
      ) : null}
    </li>
  );
}
