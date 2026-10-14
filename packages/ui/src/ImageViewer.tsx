"use client";

import { t } from "@wasfa/shared/i18n";
import { ImageOff, Maximize, Minus, Plus } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { cn } from "./cn";
import { Spinner } from "./spinner";
import {
  MAX_SCALE,
  MIN_SCALE,
  PAN_STEP,
  TAP_SLOP,
  ZOOM_STEP,
  anchorTransform,
  boxToStyle,
  clampTransform,
  fitSize,
  initialTransform,
  panBy,
  regionAt,
  revealBox,
  stageToBox,
  zoomAt,
  type Box2d,
  type Point,
  type Size,
  type ViewTransform,
} from "./viewer-math";

import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";

export interface ViewerPage {
  /** A (short-lived) image URL; `null` while it is being fetched. */
  src: string | null;
  /** The picture was removed by the retention job; the result stays. */
  deleted?: boolean | undefined;
  /** Fetching the URL failed, or the picture did not load. */
  failed?: boolean | undefined;
}

export interface ViewerRegion {
  id: string;
  /** Zero-based page the box belongs to. */
  page: number;
  /** `[ymin, xmin, ymax, xmax]`, normalized 0-1000. */
  box: Box2d;
  /** Accessible name of the region (the drawn outline itself is decorative). */
  label: string;
  /** `unreadable` regions are drawn dashed and cannot be selected. */
  kind?: "item" | "unreadable" | undefined;
}

export interface ImageViewerProps {
  pages: readonly ViewerPage[];
  /** Zero-based index of the page on show. */
  page: number;
  onPageChange: (page: number) => void;
  regions: readonly ViewerRegion[];
  /** The region to draw highlighted (hovered, focused or selected row). */
  activeId: string | null;
  /** Pointer moved over a region (or off every region: `null`). */
  onHover: (id: string | null) => void;
  /** A tap or click on a region. */
  onSelect: (id: string) => void;
  /** The picture did not load (an expired link): the owner fetches a fresh URL. */
  onImageError?: ((page: number) => void) | undefined;
  /** "Try again" after a failure. */
  onRetry?: ((page: number) => void) | undefined;
  className?: string | undefined;
}

const ZERO: Size = { width: 0, height: 0 };

function useElementSize(ref: { current: HTMLElement | null }): Size {
  const [size, setSize] = useState<Size>(ZERO);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const read = () => {
      const rect = element.getBoundingClientRect();
      setSize((previous) =>
        previous.width === rect.width && previous.height === rect.height
          ? previous
          : { width: rect.width, height: rect.height },
      );
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return size;
}

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

interface Gesture {
  start: ViewTransform;
  from: Point;
  /** Distance between two fingers when the pinch began; 0 for one pointer. */
  distance: number;
  moved: boolean;
}

const STAGE_HEIGHT = "h-56 sm:h-72 lg:h-[min(70dvh,46rem)]";

/**
 * The prescription picture with zoom and pan (drag, wheel, pinch, `+` / `-` / `0` / arrows) and the
 * boxes the model returned drawn over it. The outlines are decorative (`aria-hidden`): the table row
 * is the accessible control, and the viewer follows it through `activeId`. A tap or click on a
 * region reports it through `onSelect`, hovering reports `onHover`.
 */
export function ImageViewer({
  pages,
  page,
  onPageChange,
  regions,
  activeId,
  onHover,
  onSelect,
  onImageError,
  onRetry,
  className,
}: ImageViewerProps) {
  const current = pages[page];
  const active = regions.find((region) => region.id === activeId);

  // Another page's row was activated: show the page its box is on. Only an activation moves the
  // page; `handled` keeps a manual page switch from being undone by the next render.
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (handled.current === activeId) return;
    handled.current = activeId;
    if (active && active.page !== page && active.page < pages.length) onPageChange(active.page);
  }, [activeId, active, page, pages.length, onPageChange]);

  return (
    <div className={cn("flex flex-col gap-3", className)} data-testid="rx-viewer">
      {pages.length > 1 ? (
        <nav aria-label={t("rx.viewer.pages")} className="flex flex-wrap gap-2">
          {pages.map((_, index) => (
            <button
              key={index}
              type="button"
              aria-current={index === page ? "page" : undefined}
              onClick={() => {
                onPageChange(index);
              }}
              className={cn(
                "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border px-3 text-base font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-focus",
                index === page
                  ? "border-primary bg-primary text-on-primary"
                  : "border-neutral-400 bg-surface text-text hover:bg-primary-soft",
              )}
            >
              {t("rx.viewer.page", { n: index + 1 })}
            </button>
          ))}
        </nav>
      ) : null}
      {current === undefined ? null : current.deleted ? (
        <Placeholder icon={<ImageOff aria-hidden className="size-8" />}>
          {t("rx.image.deleted")}
        </Placeholder>
      ) : current.failed ? (
        <Placeholder icon={<ImageOff aria-hidden className="size-8" />}>
          <span role="alert">{t("rx.image.error")}</span>
          {onRetry ? (
            <button
              type="button"
              onClick={() => {
                onRetry(page);
              }}
              className="inline-flex min-h-11 items-center rounded-lg border border-neutral-400 bg-surface px-4 text-base font-semibold text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus"
            >
              {t("common.retry")}
            </button>
          ) : null}
        </Placeholder>
      ) : current.src === null ? (
        <Placeholder icon={<Spinner decorative />}>{t("rx.image.loading")}</Placeholder>
      ) : (
        <PageStage
          key={`${String(page)}:${current.src}`}
          src={current.src}
          page={page}
          regions={regions.filter((region) => region.page === page)}
          activeId={activeId}
          onHover={onHover}
          onSelect={onSelect}
          onImageError={onImageError}
        />
      )}
    </div>
  );
}

function Placeholder({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-neutral-400 bg-neutral-100 p-6 text-center text-base text-text-muted",
        STAGE_HEIGHT,
      )}
    >
      <span className="text-neutral-600">{icon}</span>
      {children}
    </div>
  );
}

interface PageStageProps {
  src: string;
  page: number;
  regions: readonly ViewerRegion[];
  activeId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  onImageError: ((page: number) => void) | undefined;
}

function PageStage({
  src,
  page,
  regions,
  activeId,
  onHover,
  onSelect,
  onImageError,
}: PageStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const stage = useElementSize(stageRef);
  const [natural, setNatural] = useState<Size | null>(null);
  const [transform, setTransform] = useState<ViewTransform>({ scale: MIN_SCALE, x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);

  const content = natural ? fitSize(natural, stage) : ZERO;
  const view = clampTransform(transform, content, stage);
  const selectable = regions.filter((region) => region.kind !== "unreadable");
  const active = regions.find((region) => region.id === activeId);

  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const lastHover = useRef<string | null>(null);
  const latest = useRef<{ content: Size; stage: Size; box: Box2d | undefined }>({
    content,
    stage,
    box: active?.box,
  });
  latest.current = { content, stage, box: active?.box };

  const hover = (id: string | null) => {
    if (lastHover.current === id) return;
    lastHover.current = id;
    onHover(id);
  };

  // The active row's box comes into view (at scale 1 everything is visible, so this only pans a
  // zoomed image). Keyed on primitives so a parent re-render never snaps a manual pan back.
  const revealKey = active
    ? `${active.id}|${String(content.width)}|${String(content.height)}|${String(stage.width)}|${String(stage.height)}`
    : "";
  useEffect(() => {
    const { content: c, stage: s, box } = latest.current;
    if (!box || c.width === 0) return;
    setTransform((previous) => revealBox(clampTransform(previous, c, s), box, c, s));
  }, [revealKey]);

  // A non-passive listener: React's wheel prop is passive and could not stop the page from scrolling.
  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
      const { content: c, stage: s } = latest.current;
      setTransform((previous) => zoomAt(clampTransform(previous, c, s), factor, point, c, s));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheel);
    };
  }, []);

  const local = (event: { clientX: number; clientY: number }): Point => {
    const rect = stageRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };

  const hit = (point: Point) => {
    const position = stageToBox(point, view, content);
    return position ? regionAt(selectable, position) : null;
  };

  const zoomBy = (factor: number) => {
    const center = { x: stage.width / 2, y: stage.height / 2 };
    setTransform(zoomAt(view, factor, center, content, stage));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const point = local(event);
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size === 1) {
      gesture.current = { start: view, from: point, distance: 0, moved: false };
    } else {
      const [a, b] = [...pointers.current.values()];
      if (a && b) {
        gesture.current = {
          start: view,
          from: midpoint(a, b),
          distance: distance(a, b),
          moved: true,
        };
      }
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // jsdom, or a pointer that already ended: dragging still works while the pointer stays inside.
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const point = local(event);
    if (!pointers.current.has(event.pointerId)) {
      if (event.pointerType === "mouse") hover(hit(point)?.id ?? null);
      return;
    }
    pointers.current.set(event.pointerId, point);
    const g = gesture.current;
    if (!g) return;
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b || g.distance === 0) return;
      setTransform(
        anchorTransform(
          g.start,
          g.from,
          midpoint(a, b),
          distance(a, b) / g.distance,
          content,
          stage,
        ),
      );
      return;
    }
    if (!g.moved && distance(point, g.from) < TAP_SLOP) return;
    g.moved = true;
    setTransform(anchorTransform(g.start, g.from, point, 1, content, stage));
  };

  const endPointer = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const point = local(event);
    const g = gesture.current;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) {
      gesture.current = null;
      if (!cancelled && g && !g.moved) {
        const region = hit(point);
        if (region) onSelect(region.id);
      }
    } else if (pointers.current.size === 1) {
      // One finger of a pinch lifted: carry on panning with the other.
      const [rest] = [...pointers.current.values()];
      if (rest) gesture.current = { start: view, from: rest, distance: 0, moved: true };
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const center = { x: stage.width / 2, y: stage.height / 2 };
    switch (event.key) {
      case "+":
      case "=":
        event.preventDefault();
        setTransform(zoomAt(view, ZOOM_STEP, center, content, stage));
        return;
      case "-":
      case "_":
        event.preventDefault();
        setTransform(zoomAt(view, 1 / ZOOM_STEP, center, content, stage));
        return;
      case "0":
        event.preventDefault();
        setTransform(initialTransform(content, stage));
        return;
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown": {
        // At scale 1 there is nothing to pan, and the arrows keep scrolling the page.
        if (view.scale <= MIN_SCALE) return;
        event.preventDefault();
        const dx =
          event.key === "ArrowLeft" ? -PAN_STEP : event.key === "ArrowRight" ? PAN_STEP : 0;
        const dy = event.key === "ArrowUp" ? -PAN_STEP : event.key === "ArrowDown" ? PAN_STEP : 0;
        setTransform(panBy(view, dx, dy, content, stage));
        return;
      }
      default:
    }
  };

  const percent = Math.round(view.scale * 100);

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={stageRef}
        dir="ltr"
        role="group"
        tabIndex={0}
        aria-label={t("rx.viewer.label")}
        aria-describedby={hintId}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => {
          endPointer(event, false);
        }}
        onPointerCancel={(event) => {
          endPointer(event, true);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse" && pointers.current.size === 0) hover(null);
        }}
        data-testid="rx-viewer-stage"
        data-scale={view.scale.toFixed(3)}
        className={cn(
          "relative touch-none select-none overflow-hidden rounded-lg border border-border bg-neutral-100 focus-visible:outline-none focus-visible:shadow-focus",
          view.scale > MIN_SCALE ? "cursor-grab" : "cursor-default",
          STAGE_HEIGHT,
        )}
      >
        <div
          className="absolute"
          style={{
            insetInlineStart: 0,
            insetBlockStart: 0,
            inlineSize: content.width,
            blockSize: content.height,
            transformOrigin: "0 0",
            transform: `translate(${String(view.x)}px, ${String(view.y)}px) scale(${String(view.scale)})`,
          }}
        >
          {/* A presigned, short-lived URL: next/image would proxy and cache it, so a plain img. */}
          <img
            src={src}
            alt={t("rx.viewer.imageAlt", { n: page + 1 })}
            draggable={false}
            onLoad={(event) => {
              const image = event.currentTarget;
              setNatural({ width: image.naturalWidth, height: image.naturalHeight });
              setLoaded(true);
            }}
            onError={() => {
              onImageError?.(page);
            }}
            className="block size-full max-w-none"
          />
          <div aria-hidden className="pointer-events-none absolute inset-0">
            {regions.map((region) => {
              const isActive = region.id === activeId;
              const unreadable = region.kind === "unreadable";
              return (
                <div
                  key={region.id}
                  data-region-id={region.id}
                  data-active={isActive ? "true" : undefined}
                  data-kind={unreadable ? "unreadable" : "item"}
                  className={cn(
                    "absolute rounded-xs",
                    unreadable
                      ? "border-dashed border-danger"
                      : isActive
                        ? "border-solid border-primary bg-primary/20"
                        : "border-solid border-primary/60 bg-primary/5",
                  )}
                  style={{
                    ...boxToStyle(region.box),
                    // Outlines keep their on-screen thickness while the image is zoomed.
                    borderWidth: (isActive ? 3 : 2) / view.scale,
                    boxShadow: isActive ? `0 0 0 ${String(2 / view.scale)}px #fff` : undefined,
                  }}
                />
              );
            })}
          </div>
        </div>
        {!loaded ? (
          <div className="absolute inset-0 flex items-center justify-center text-text-muted">
            <Spinner decorative />
          </div>
        ) : null}
      </div>
      <p id={hintId} className="hidden text-sm text-text-muted sm:block">
        {t("rx.viewer.hint")}
      </p>
      <div className="flex items-center gap-2" role="toolbar" aria-label={t("rx.viewer.label")}>
        <ToolButton
          label={t("rx.viewer.zoomOut")}
          disabled={view.scale <= MIN_SCALE}
          onClick={() => {
            zoomBy(1 / ZOOM_STEP);
          }}
        >
          <Minus aria-hidden className="size-5" />
        </ToolButton>
        <span
          role="status"
          className="min-w-14 text-center text-base font-semibold tabular-nums text-text"
        >
          {t("rx.viewer.zoomLevel", { percent })}
        </span>
        <ToolButton
          label={t("rx.viewer.zoomIn")}
          disabled={view.scale >= MAX_SCALE}
          onClick={() => {
            zoomBy(ZOOM_STEP);
          }}
        >
          <Plus aria-hidden className="size-5" />
        </ToolButton>
        <ToolButton
          label={t("rx.viewer.reset")}
          disabled={false}
          onClick={() => {
            setTransform(initialTransform(content, stage));
          }}
        >
          <Maximize aria-hidden className="size-5" />
        </ToolButton>
      </div>
    </div>
  );
}

function ToolButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onClick();
      }}
      className={cn(
        "inline-flex size-11 items-center justify-center rounded-lg border border-neutral-400 bg-surface text-text transition-colors duration-150 hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus",
        disabled && "opacity-50",
      )}
    >
      {children}
    </button>
  );
}
