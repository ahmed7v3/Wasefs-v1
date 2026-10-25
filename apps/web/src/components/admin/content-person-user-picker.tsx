"use client";

import { t } from "@wasfa/shared/i18n";
import { adminUserListResponseSchema, type AdminUser } from "@wasfa/shared/schemas/admin";
import { Button, Field, Input } from "@wasfa/ui";
import { User, X } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { api } from "../../lib/api-client";
import { SEARCH_MIN_LENGTH } from "../../lib/use-admin-search";
import { errorMessage } from "../error-notice";

export interface LinkedUser {
  id: string;
  /** `null` when the person was linked earlier and its name was not loaded. */
  name: string | null;
}

export interface PersonUserPickerProps {
  value: LinkedUser | null;
  onChange: (value: LinkedUser | null) => void;
}

const DEBOUNCE_MS = 300;

/**
 * Links a people profile to an account: search `GET /admin/users?q=`, show the chosen account by name
 * only (never an e-mail address or phone number on this screen).
 */
export function PersonUserPicker({ value, onChange }: PersonUserPickerProps) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "error"; error: unknown }
    | { status: "ready"; users: AdminUser[] }
  >({ status: "idle" });
  const listId = useId();

  useEffect(() => {
    const term = query.trim();
    if (value || term.length < SEARCH_MIN_LENGTH) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    const timer = setTimeout(() => {
      api(`/admin/users?q=${encodeURIComponent(term)}&limit=8`, {
        schema: adminUserListResponseSchema,
        signal: controller.signal,
      }).then(
        (answer) => {
          setState({ status: "ready", users: answer.items });
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          setState({ status: "error", error });
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, value]);

  if (value) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-base font-semibold text-text">
          {t("admin.content.person.linkedUser")}
        </span>
        <div className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-primary-soft px-3">
          <User aria-hidden className="size-5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate text-base">
            <bdi dir="auto">{value.name ?? t("admin.content.person.linkedUnknown")}</bdi>
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
            <span className="sr-only">{t("admin.content.person.unlink")}</span>
          </Button>
        </div>
        <p className="text-sm text-text-muted">{t("admin.content.person.linkHint")}</p>
      </div>
    );
  }

  const users = state.status === "ready" ? state.users : [];
  return (
    <div className="flex flex-col gap-2">
      <Field label={t("admin.content.person.linkedUser")} hint={t("admin.content.person.linkHint")}>
        {(control) => (
          <Input
            {...control}
            name="user-search"
            type="search"
            autoComplete="off"
            role="combobox"
            aria-expanded={users.length > 0}
            aria-controls={listId}
            placeholder={t("admin.content.person.linkSearch")}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        )}
      </Field>
      <div role="status" aria-live="polite" className="text-sm text-text-muted">
        {state.status === "loading" ? t("admin.palette.loading") : null}
        {state.status === "error" ? errorMessage(state.error) : null}
        {state.status === "ready" && users.length === 0 ? t("admin.content.person.linkNone") : null}
      </div>
      {users.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={t("admin.content.person.linkedUser")}
          className="flex flex-col gap-1"
        >
          {users.map((user) => (
            <li key={user.id} role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => {
                  onChange({ id: user.id, name: user.name });
                }}
                className="flex min-h-11 w-full items-center rounded-lg px-3 text-start text-base font-semibold hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus"
              >
                <bdi dir="auto">{user.name}</bdi>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
