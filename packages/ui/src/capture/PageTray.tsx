"use client";

import { t } from "@wasfa/shared/i18n";
import { useLayoutEffect, useRef } from "react";

import { cn } from "../cn";

import { PageThumb } from "./PageThumb";

import type { CapturePage } from "./types";

export interface PageTrayProps {
  pages: readonly CapturePage[];
  maxPages: number;
  onMove: (localId: string, delta: number) => void;
  onRemove: (localId: string) => void;
  /** Absent: no page can be edited. `canEdit` can rule out single pages (those from a phone). */
  onEdit?: ((localId: string) => void) | undefined;
  canEdit?: ((localId: string) => boolean) | undefined;
  onRetry: (localId: string) => void;
  compact?: boolean | undefined;
}

/**
 * The pages in order, up to `maxPages`. Reordering moves DOM nodes, which can drop keyboard focus
 * in some browsers, so the tile that was moved gets it back.
 */
export function PageTray({
  pages,
  maxPages,
  onMove,
  onRemove,
  onEdit,
  canEdit,
  onRetry,
  compact = false,
}: PageTrayProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const focusAfterMove = useRef<string | null>(null);

  useLayoutEffect(() => {
    const id = focusAfterMove.current;
    if (id === null) return;
    focusAfterMove.current = null;
    const tile = Array.from(listRef.current?.children ?? []).find(
      (child) => child.getAttribute("data-local-id") === id,
    );
    // A button inside the tile keeps its own focus; only the tile itself needs it back.
    if (tile instanceof HTMLElement && !tile.contains(document.activeElement)) tile.focus();
  });

  if (pages.length === 0) return null;
  return (
    <section aria-label={t("capture.tray.label")} className="flex flex-col gap-2">
      <p className="text-sm text-text-muted tabular-nums">
        {t("capture.tray.count", { count: pages.length, max: maxPages })}
      </p>
      <ol
        ref={listRef}
        className={cn(
          "grid gap-3",
          compact ? "grid-cols-3 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
        )}
      >
        {pages.map((page, index) => (
          <PageThumb
            key={page.localId}
            page={page}
            index={index}
            total={pages.length}
            compact={compact}
            onMove={(delta) => {
              focusAfterMove.current = page.localId;
              onMove(page.localId, delta);
            }}
            onRemove={() => {
              onRemove(page.localId);
            }}
            onEdit={
              onEdit && (canEdit?.(page.localId) ?? true)
                ? () => {
                    onEdit(page.localId);
                  }
                : undefined
            }
            onRetry={() => {
              onRetry(page.localId);
            }}
          />
        ))}
      </ol>
    </section>
  );
}
