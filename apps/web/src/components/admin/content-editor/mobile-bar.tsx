"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import { Eye, Image as ImageIcon, Search, Send, type LucideIcon } from "lucide-react";

import type { PanelTab } from "./editor-panel";

export type MobileBarTarget = Extract<PanelTab, "publish" | "seo" | "media"> | "preview";

const ENTRIES: readonly { target: MobileBarTarget; label: MessageKey; icon: LucideIcon }[] = [
  { target: "publish", label: "admin.editor.tab.publish", icon: Send },
  { target: "seo", label: "admin.editor.tab.seo", icon: Search },
  { target: "media", label: "admin.editor.tab.media", icon: ImageIcon },
  { target: "preview", label: "admin.editor.bar.preview", icon: Eye },
];

export interface MobileBarProps {
  onSelect: (target: MobileBarTarget) => void;
}

/**
 * The sticky bottom bar below `lg`: Publish · SEO · Media · Preview, four 44 px+ buttons that open the
 * panel as a bottom sheet (or the full-screen preview). The page is padded so the bar never covers text,
 * and it is not rendered while the body has focus: the on-screen keyboard and the formatting toolbar
 * take that strip of the screen.
 */
export function MobileBar({ onSelect }: MobileBarProps) {
  return (
    <nav
      aria-label={t("admin.editor.bar.label")}
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {ENTRIES.map(({ target, label, icon: Icon }) => (
        <button
          key={target}
          type="button"
          onClick={() => {
            onSelect(target);
          }}
          className="flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 px-1 text-sm font-semibold text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus"
        >
          <Icon aria-hidden className="size-5" />
          <span className="max-w-full truncate">{t(label)}</span>
        </button>
      ))}
    </nav>
  );
}
