"use client";

import { slugify } from "@wasfa/shared/content";
import { t } from "@wasfa/shared/i18n";
import { Button, Field, Input } from "@wasfa/ui";
import { Wand2 } from "lucide-react";

export interface SlugFieldProps {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** The name the «اقتراح» button transliterates into a slug. */
  suggestFrom: string;
  error?: string | undefined;
  announceError?: boolean | undefined;
  required?: boolean | undefined;
  hint?: string | undefined;
}

/** An ASCII slug input with a button that suggests one from the (Arabic or English) name. */
export function SlugField({
  name,
  label,
  value,
  onChange,
  suggestFrom,
  error,
  announceError,
  required,
  hint,
}: SlugFieldProps) {
  const suggestion = slugify(suggestFrom);
  return (
    <Field
      label={label}
      hint={hint ?? t("admin.content.slug.hint")}
      error={error}
      announceError={announceError}
      required={required}
    >
      {(control) => (
        <div className="flex items-start gap-2">
          <Input
            {...control}
            name={name}
            ltr
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
            }}
          />
          <Button
            variant="secondary"
            name={`${name}-suggest`}
            disabled={suggestion === ""}
            onClick={() => {
              onChange(suggestion);
            }}
            className="shrink-0"
          >
            <Wand2 aria-hidden className="size-5" />
            {t("admin.content.slug.suggest")}
          </Button>
        </div>
      )}
    </Field>
  );
}
