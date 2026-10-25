"use client";

import { t } from "@wasfa/shared/i18n";
import { cn } from "@wasfa/ui";

import { TOOLBAR_ICONS, TOOLBAR_LABELS } from "./format-toolbar";

import type { ToolbarAction } from "../../../lib/content-editor/toolbar";

export interface SlashMenuProps {
  id: string;
  actions: readonly ToolbarAction[];
  activeIndex: number;
  /** Distance from the top of the textarea wrapper, so the list opens under the caret line. */
  top: number;
  onHover: (index: number) => void;
  onSelect: (action: ToolbarAction) => void;
}

/** DOM id of the option at `index`, for `aria-activedescendant` on the textarea. */
export const slashOptionId = (menuId: string, index: number): string =>
  `${menuId}-option-${String(index)}`;

/**
 * The `/` command list: a `role="listbox"` the textarea points at with `aria-activedescendant` (focus
 * stays in the text), operable by arrows + Enter/Tab and by touch (each option is a 44 px target).
 * `onPointerDown` prevents the default so tapping an option never blurs the textarea.
 */
export function SlashMenu({ id, actions, activeIndex, top, onHover, onSelect }: SlashMenuProps) {
  return (
    <div
      className="absolute z-20 w-72 max-w-full overflow-hidden rounded-lg border border-border bg-surface shadow-raised"
      style={{ insetBlockStart: `${String(top)}px`, insetInlineStart: 0 }}
    >
      {actions.length === 0 ? (
        <p role="status" className="px-3 py-3 text-base text-text-muted">
          {t("admin.editor.slash.empty")}
        </p>
      ) : (
        <ul
          id={id}
          role="listbox"
          aria-label={t("admin.editor.slash.label")}
          className="max-h-64 overflow-y-auto"
        >
          {actions.map((action, index) => {
            const Icon = TOOLBAR_ICONS[action];
            return (
              <li
                key={action}
                id={slashOptionId(id, index)}
                role="option"
                aria-selected={index === activeIndex}
                onPointerDown={(event) => {
                  event.preventDefault();
                }}
                onMouseMove={() => {
                  onHover(index);
                }}
                onClick={() => {
                  onSelect(action);
                }}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-3 px-3 text-base text-text",
                  index === activeIndex && "bg-primary-soft",
                )}
              >
                <Icon aria-hidden className="size-5 shrink-0 text-primary" />
                <span>{t(TOOLBAR_LABELS[action])}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
