import { t } from "@wasfa/shared/i18n";

import { cn } from "../cn";

import type { ReactNode } from "react";

export interface SkillChipItem {
  id: string;
  label: string;
  icon?: ReactNode;
  /** A chip that leaves the chat (the prescription analysis page) is a link. */
  href?: string | undefined;
}

export interface SkillChipsProps {
  items: readonly SkillChipItem[];
  /** The chosen skill; choosing it again clears it. */
  selectedId?: string | null | undefined;
  onSelect?: ((id: string | null) => void) | undefined;
  /** Highlighted without being chosen: the composer suggests it (an attached prescription image). */
  suggestedId?: string | null | undefined;
  className?: string | undefined;
}

const chip =
  "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold " +
  "transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-focus";

/** The assistant's skills as a row of toggle chips under the composer. */
export function SkillChips({
  items,
  selectedId = null,
  onSelect,
  suggestedId = null,
  className,
}: SkillChipsProps) {
  return (
    <ul aria-label={t("chat.skills.label")} className={cn("flex flex-wrap gap-2", className)}>
      {items.map((item) => {
        const selected = item.id === selectedId;
        const style = cn(
          chip,
          selected
            ? "border-primary bg-primary text-on-primary"
            : item.id === suggestedId
              ? "border-primary bg-primary-soft text-primary"
              : "border-border bg-surface text-text hover:bg-primary-soft hover:text-primary",
        );
        return (
          <li key={item.id}>
            {item.href ? (
              <a href={item.href} className={style}>
                {item.icon}
                {item.label}
              </a>
            ) : (
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect?.(selected ? null : item.id)}
                className={style}
              >
                {item.icon}
                {item.label}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
