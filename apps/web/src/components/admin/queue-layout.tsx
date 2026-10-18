"use client";

import { t } from "@wasfa/shared/i18n";

import { useShortcuts, type ShortcutMap } from "../../lib/use-shortcuts";

import type { ReactNode } from "react";

export interface QueueShortcutHint {
  key: string;
  label: string;
}

export interface QueueLayoutProps {
  /** Accessible names of the two regions. */
  listLabel: string;
  paneLabel: string;
  list: ReactNode;
  pane: ReactNode;
  shortcuts: ShortcutMap;
  /** Turn the keys off while a dialog is open or nothing is selected. */
  shortcutsEnabled?: boolean;
  hints?: readonly QueueShortcutHint[];
}

/**
 * List + review pane with keyboard shortcuts (ADMIN-CONSOLE-SPEC §4.2). On the inline-start the
 * queue, on the other side the pane; under `lg` the pane stacks below the queue so a phone never
 * scrolls sideways. Letters are ignored while the reviewer types in a field.
 */
export function QueueLayout({
  listLabel,
  paneLabel,
  list,
  pane,
  shortcuts,
  shortcutsEnabled = true,
  hints = [],
}: QueueLayoutProps) {
  useShortcuts(shortcuts, shortcutsEnabled);
  return (
    <div className="flex flex-col gap-4">
      {hints.length > 0 ? (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text-muted">
          <span className="font-semibold">{t("admin.revenue.queue.shortcuts")}</span>
          {hints.map((hint) => (
            <span key={hint.key} className="inline-flex items-center gap-1.5">
              <kbd className="inline-flex min-w-7 items-center justify-center rounded-md border border-border bg-surface px-1.5 py-0.5 font-mono text-sm text-text">
                {hint.key.toUpperCase()}
              </kbd>
              {hint.label}
            </span>
          ))}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <section aria-label={listLabel} className="min-w-0">
          {list}
        </section>
        <section aria-label={paneLabel} className="min-w-0">
          {pane}
        </section>
      </div>
    </div>
  );
}
