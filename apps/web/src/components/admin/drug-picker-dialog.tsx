"use client";

import { t } from "@wasfa/shared/i18n";
import { drugSearchResponseSchema } from "@wasfa/shared/schemas/admin-drugs";
import { Button, Dialog, Field, Input, Skeleton } from "@wasfa/ui";
import { useEffect, useState } from "react";

import { buildQuery, useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import type { ApiRequestError } from "../../lib/api-error";
import type { ReactNode } from "react";

export interface DrugPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** What the search starts with (the unmatched reading). */
  initialQuery: string;
  confirmLabel: string;
  /** Performs the write for the chosen drug; throw to show the error in the dialog. */
  onPick: (drugId: string) => Promise<void>;
}

const SEARCH_DELAY_MS = 300;

/** Pick one drug with the browser's own search endpoint (the same matcher), then run `onPick` on it. */
export function DrugPickerDialog({
  open,
  onOpenChange,
  title,
  description,
  initialQuery,
  confirmLabel,
  onPick,
}: DrugPickerDialogProps) {
  const [text, setText] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(text.trim());
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [text]);

  const results = useResource(
    open && query !== "" ? `/admin/drugs?${buildQuery({ q: query, limit: "10" })}` : null,
    drugSearchResponseSchema,
  );
  const items = results.status === "ready" ? results.data.items : [];

  const confirm = () => {
    if (pickedId === null || submitting) return;
    setSubmitting(true);
    setError(null);
    onPick(pickedId).then(
      () => {
        setSubmitting(false);
        onOpenChange(false);
      },
      (failure: unknown) => {
        setSubmitting(false);
        setError(failure as ApiRequestError);
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      actions={
        <>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t("common.cancel")}
          </Button>
          <Button type="button" disabled={pickedId === null} loading={submitting} onClick={confirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("admin.drugs.picker.search")}>
          {(control) => (
            <Input
              {...control}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setPickedId(null);
              }}
            />
          )}
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-base font-semibold text-text">
            {t("admin.drugs.picker.pick")}
          </legend>
          {results.status === "loading" && query !== "" ? (
            <Skeleton className="h-12 w-full" />
          ) : null}
          {results.status === "ready" && items.length === 0 ? (
            <p className="text-sm text-text-muted">{t("admin.drugs.merge.none")}</p>
          ) : null}
          {items.map((item) => (
            <label
              key={item.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 has-checked:border-primary has-checked:bg-primary-soft"
            >
              <input
                type="radio"
                name="drug-candidate"
                checked={pickedId === item.id}
                onChange={() => {
                  setPickedId(item.id);
                }}
                className="size-5 accent-primary"
              />
              <span className="flex min-w-0 flex-col">
                <bdi dir="ltr" className="font-semibold">
                  {item.brandEn}
                </bdi>
                <span className="text-sm text-text-muted">
                  {[item.brandAr, item.strengthText, item.form].filter(Boolean).join(" · ")}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        {error ? <ErrorNotice error={error} /> : null}
      </div>
    </Dialog>
  );
}
