"use client";

import { t } from "@wasfa/shared/i18n";
import { Button, Field, Input } from "@wasfa/ui";
import { User, X } from "lucide-react";
import { useId, useState } from "react";

import { SEARCH_MIN_LENGTH, useAdminSearch } from "../../lib/use-admin-search";
import { errorMessage } from "../error-notice";

export interface PickedUser {
  id: string;
  title: string;
  subtitle: string;
}

export interface UserPickerProps {
  label: string;
  value: PickedUser | null;
  onChange: (value: PickedUser | null) => void;
  hint?: string | undefined;
}

/**
 * Search-as-you-type for one user, over `GET /admin/search` (only the user results are offered).
 * The chosen user shows as a chip with a remove button; nothing is picked by typing alone.
 */
export function UserPicker({ label, value, onChange, hint }: UserPickerProps) {
  const [query, setQuery] = useState("");
  const search = useAdminSearch(value ? "" : query);
  const listId = useId();

  if (value) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold text-text">{label}</span>
        <div className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-primary-soft px-3">
          <User aria-hidden className="size-5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate text-base">
            <bdi dir="auto">{value.title}</bdi>
            {value.subtitle ? (
              <bdi dir="auto" className="text-sm text-text-muted">
                {" · "}
                {value.subtitle}
              </bdi>
            ) : null}
          </span>
          <Button
            variant="ghost"
            name="clear-user"
            onClick={() => {
              onChange(null);
              setQuery("");
            }}
          >
            <X aria-hidden className="size-5" />
            <span className="sr-only">{t("admin.revenue.picker.clear")}</span>
          </Button>
        </div>
      </div>
    );
  }

  const users =
    search.status === "ready" ? search.items.filter((item) => item.type === "user") : [];

  return (
    <div className="flex flex-col gap-2">
      <Field
        label={label}
        hint={hint ?? t("admin.revenue.picker.hint", { min: SEARCH_MIN_LENGTH })}
      >
        {(control) => (
          <Input
            {...control}
            name="user-search"
            type="search"
            autoComplete="off"
            role="combobox"
            aria-expanded={users.length > 0}
            aria-controls={listId}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        )}
      </Field>
      <div role="status" aria-live="polite" className="text-sm text-text-muted">
        {search.status === "loading" ? t("admin.palette.loading") : null}
        {search.status === "error" ? errorMessage(search.error) : null}
        {search.status === "ready" && users.length === 0 ? t("admin.revenue.picker.none") : null}
      </div>
      {users.length > 0 ? (
        <ul id={listId} role="listbox" aria-label={label} className="flex flex-col gap-1">
          {users.map((item) => (
            <li key={item.id} role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => {
                  onChange({ id: item.id, title: item.title, subtitle: item.subtitle });
                }}
                className="flex min-h-11 w-full flex-col items-start rounded-lg px-3 py-1 text-start hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus"
              >
                <bdi dir="auto" className="text-base font-semibold">
                  {item.title}
                </bdi>
                <bdi dir="auto" className="text-sm text-text-muted">
                  {item.subtitle}
                </bdi>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
