"use client";

import { t } from "@wasfa/shared/i18n";
import { Button, Field, Input } from "@wasfa/ui";
import { X } from "lucide-react";
import { useState } from "react";

export interface ChipsInputProps {
  label: string;
  hint?: string | undefined;
  values: readonly string[];
  max: number;
  onChange: (values: string[]) => void;
  disabled?: boolean | undefined;
}

/** Free-text chips (secondary keywords): Enter or the add button commits, each chip has a 44 px remove button. */
export function ChipsInput({ label, hint, values, max, onChange, disabled }: ChipsInputProps) {
  const [text, setText] = useState("");
  const atMax = values.length >= max;

  const add = (): void => {
    const next = text.trim();
    if (next === "" || atMax || values.includes(next)) return;
    onChange([...values, next]);
    setText("");
  };

  return (
    <Field
      label={label}
      hint={hint ?? t("admin.editor.chips.counter", { count: values.length, max })}
    >
      {(control) => (
        <div className="flex flex-col gap-2">
          {values.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {values.map((value) => (
                <li
                  key={value}
                  className="inline-flex min-h-11 items-center gap-1 rounded-full bg-primary-soft ps-3 text-base text-text"
                >
                  <bdi>{value}</bdi>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={t("admin.editor.chips.remove", { value })}
                    onClick={() => {
                      onChange(values.filter((candidate) => candidate !== value));
                    }}
                    className="inline-flex size-11 items-center justify-center rounded-full text-text-muted hover:text-danger focus-visible:outline-none focus-visible:shadow-focus"
                  >
                    <X aria-hidden className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex items-start gap-2">
            <Input
              {...control}
              dir="auto"
              value={text}
              disabled={disabled || atMax}
              maxLength={120}
              onChange={(event) => {
                setText(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
              }}
            />
            <Button
              variant="secondary"
              onClick={add}
              disabled={disabled || atMax || text.trim() === ""}
              className="shrink-0"
            >
              {t("admin.editor.chips.add")}
            </Button>
          </div>
        </div>
      )}
    </Field>
  );
}
