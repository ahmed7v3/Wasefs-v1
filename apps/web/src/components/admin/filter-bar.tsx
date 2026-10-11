"use client";

import { t } from "@wasfa/shared/i18n";
import { Button, Field, Input, Select } from "@wasfa/ui";
import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useUrlParams } from "../../lib/use-url-params";

/** How long typing pauses before the URL (and so the list) follows. */
export const SEARCH_DEBOUNCE_MS = 300;

export type FilterField =
  | {
      kind: "search" | "text";
      name: string;
      label: string;
      /** Ids, codes and domains read left to right. */
      ltr?: boolean;
      placeholder?: string;
    }
  | {
      kind: "select";
      name: string;
      label: string;
      allLabel: string;
      options: readonly { value: string; label: string }[];
    }
  | { kind: "date"; name: string; label: string };

export interface FilterBarProps {
  fields: readonly FilterField[];
  /** Called after the filters were cleared (the list resets itself from the URL). */
  onCleared?: (() => void) | undefined;
}

function TextFilter({ field }: { field: Extract<FilterField, { kind: "search" | "text" }> }) {
  const url = useUrlParams();
  const fromUrl = url.get(field.name);
  const [value, setValue] = useState(fromUrl);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What this input last pushed: a URL that differs from it came from elsewhere (Back, "clear").
  const lastSent = useRef(fromUrl);

  useEffect(() => {
    if (fromUrl === lastSent.current) return;
    lastSent.current = fromUrl;
    setValue(fromUrl);
  }, [fromUrl]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const schedule = (next: string) => {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const trimmed = next.trim();
      lastSent.current = trimmed;
      url.update({ [field.name]: trimmed });
    }, SEARCH_DEBOUNCE_MS);
  };

  return (
    <Field label={field.label} className="min-w-0 flex-1 basis-56">
      {(control) => (
        <Input
          {...control}
          name={field.name}
          type={field.kind === "search" ? "search" : "text"}
          value={value}
          ltr={field.ltr}
          placeholder={field.placeholder}
          startIcon={field.kind === "search" ? <Search className="size-5" /> : undefined}
          autoComplete="off"
          onChange={(event) => {
            schedule(event.target.value);
          }}
        />
      )}
    </Field>
  );
}

function SelectFilter({ field }: { field: Extract<FilterField, { kind: "select" }> }) {
  const url = useUrlParams();
  return (
    <Field label={field.label} className="basis-44">
      {(control) => (
        <Select
          {...control}
          name={field.name}
          value={url.get(field.name)}
          onChange={(event) => {
            url.update({ [field.name]: event.target.value });
          }}
        >
          <option value="">{field.allLabel}</option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

function DateFilter({ field }: { field: Extract<FilterField, { kind: "date" }> }) {
  const url = useUrlParams();
  return (
    <Field label={field.label} className="basis-44">
      {(control) => (
        <Input
          {...control}
          name={field.name}
          type="date"
          ltr
          value={url.get(field.name)}
          onChange={(event) => {
            url.update({ [field.name]: event.target.value });
          }}
        />
      )}
    </Field>
  );
}

/** True when any of the filter params is set in the URL. */
export function useFiltersActive(fields: readonly FilterField[]): boolean {
  const url = useUrlParams();
  return fields.some((field) => url.get(field.name) !== "");
}

/**
 * Filter controls above an admin table. Every value lives in the URL (`useUrlParams`), so the view is
 * shareable and survives reload; text is debounced by 300 ms and a change resets the cursor.
 */
export function FilterBar({ fields, onCleared }: FilterBarProps) {
  const url = useUrlParams();
  const active = useFiltersActive(fields);

  return (
    <form
      role="search"
      aria-label={t("admin.filters.label")}
      onSubmit={(event) => {
        event.preventDefault();
      }}
      className="flex flex-wrap items-end gap-3"
    >
      {fields.map((field) => {
        switch (field.kind) {
          case "search":
          case "text":
            return <TextFilter key={field.name} field={field} />;
          case "select":
            return <SelectFilter key={field.name} field={field} />;
          case "date":
            return <DateFilter key={field.name} field={field} />;
        }
      })}
      {active ? (
        <Button
          variant="ghost"
          onClick={() => {
            url.update(Object.fromEntries(fields.map((field) => [field.name, null])));
            onCleared?.();
          }}
        >
          <X aria-hidden className="size-4" />
          {t("admin.filters.clear")}
        </Button>
      ) : null}
    </form>
  );
}
