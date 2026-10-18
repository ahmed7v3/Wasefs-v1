"use client";

import { t } from "@wasfa/shared/i18n";
import { CreditCard, Gift, Receipt, Search, Ticket, User, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  SEARCH_MIN_LENGTH,
  useAdminSearch,
  type SearchItem,
  type SearchType,
} from "../../lib/use-admin-search";
import { errorMessage } from "../error-notice";

import type { KeyboardEvent as ReactKeyboardEvent } from "react";

const GROUPS: readonly { type: SearchType; icon: LucideIcon }[] = [
  { type: "user", icon: User },
  { type: "order", icon: Receipt },
  { type: "payment", icon: CreditCard },
  { type: "coupon", icon: Ticket },
  { type: "referral_code", icon: Gift },
];

/** Results grouped by type in a fixed order; the flat order is the arrow-key order. */
export function groupResults(items: readonly SearchItem[]) {
  return GROUPS.map((group) => ({
    ...group,
    items: items.filter((item) => item.type === group.type),
  })).filter((group) => group.items.length > 0);
}

/** Ctrl/Cmd+K on any admin page, or the button in the top bar. */
export function isPaletteShortcut(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
}

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const search = useAdminSearch(query);
  const listId = useId();
  const statusId = useId();

  const groups = useMemo(
    () => (search.status === "ready" ? groupResults(search.items) : []),
    [search],
  );
  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const activeItem = flat[active];

  useEffect(() => {
    setActive(0);
  }, [search]);

  const open = (item: SearchItem) => {
    onClose();
    router.push(item.href);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((value) => (flat.length === 0 ? 0 : (value + 1) % flat.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((value) => (flat.length === 0 ? 0 : (value - 1 + flat.length) % flat.length));
    } else if (event.key === "Enter" && activeItem) {
      event.preventDefault();
      open(activeItem);
    }
  };

  const statusText =
    search.status === "idle"
      ? t("admin.palette.hint", { min: SEARCH_MIN_LENGTH })
      : search.status === "loading"
        ? t("admin.palette.loading")
        : search.status === "error"
          ? errorMessage(search.error)
          : flat.length === 0
            ? t("admin.palette.empty")
            : t("admin.palette.count", { count: flat.length });

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute inset-y-0 start-3 my-auto size-5 text-neutral-600"
        />
        <input
          type="text"
          role="combobox"
          name="palette-query"
          autoFocus
          autoComplete="off"
          aria-label={t("admin.palette.label")}
          aria-expanded={flat.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-describedby={statusId}
          aria-activedescendant={
            activeItem ? `${listId}-${activeItem.type}-${activeItem.id}` : undefined
          }
          placeholder={t("admin.palette.placeholder")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          onKeyDown={onKeyDown}
          className="min-h-12 w-full rounded-lg border border-border bg-surface ps-11 pe-3 text-base text-text focus-visible:outline-none focus-visible:shadow-focus"
        />
      </div>
      <p id={statusId} role="status" aria-live="polite" className="text-sm text-text-muted">
        {statusText}
      </p>
      <div
        id={listId}
        role="listbox"
        aria-label={t("admin.palette.results")}
        className="flex max-h-96 flex-col gap-3 overflow-y-auto"
      >
        {groups.map((group) => {
          const Icon = group.icon;
          const headingId = `${listId}-${group.type}`;
          return (
            <div
              key={group.type}
              role="group"
              aria-labelledby={headingId}
              className="flex flex-col gap-1"
            >
              <p id={headingId} className="px-2 text-sm font-semibold text-text-muted">
                {t(`admin.palette.group.${group.type}`)}
              </p>
              {group.items.map((item) => {
                const selected = item === activeItem;
                return (
                  <div
                    key={`${item.type}-${item.id}`}
                    id={`${listId}-${item.type}-${item.id}`}
                    role="option"
                    aria-selected={selected}
                    tabIndex={-1}
                    onMouseEnter={() => {
                      setActive(flat.indexOf(item));
                    }}
                    onClick={() => {
                      open(item);
                    }}
                    className={
                      selected
                        ? "flex min-h-12 cursor-pointer items-center gap-3 rounded-lg bg-primary-soft px-3 text-text"
                        : "flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-3 text-text hover:bg-primary-soft/60"
                    }
                  >
                    <Icon aria-hidden className="size-5 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                      <bdi dir="auto" className="block truncate text-base font-semibold">
                        {item.title}
                      </bdi>
                      {item.subtitle ? (
                        <bdi dir="auto" className="block truncate text-sm text-text-muted">
                          {item.subtitle}
                        </bdi>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The global finder (ADMIN-CONSOLE-SPEC §2): Ctrl/Cmd+K anywhere in the admin shell, or the search
 * button. A native modal `<dialog>` gives the focus trap, the inert page and Esc. The input is a
 * combobox over a listbox grouped by type; arrows move, Enter opens the record's own URL.
 */
export function CommandPalette() {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      opener?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        aria-label={t("admin.palette.open")}
        aria-keyshortcuts="Control+K Meta+K"
        className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-base font-semibold text-primary transition-colors duration-150 hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus"
      >
        <Search aria-hidden className="size-5" />
        <span className="hidden sm:inline">{t("admin.palette.openShort")}</span>
      </button>
      <dialog
        ref={ref}
        aria-label={t("admin.palette.label")}
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
        className="fixed inset-x-0 top-16 z-40 m-auto w-[calc(100%-2rem)] max-w-xl rounded-xl bg-surface p-4 text-text shadow-raised backdrop:bg-neutral-900/50"
      >
        {open ? (
          <Palette
            onClose={() => {
              setOpen(false);
            }}
          />
        ) : null}
      </dialog>
    </>
  );
}
