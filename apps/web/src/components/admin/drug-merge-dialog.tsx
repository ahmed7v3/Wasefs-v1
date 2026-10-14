"use client";

import { t } from "@wasfa/shared/i18n";
import {
  drugSearchResponseSchema,
  mergeDrugsResponseSchema,
  type DrugView,
} from "@wasfa/shared/schemas/admin-drugs";
import { Button, Dialog, Field, Input, Skeleton, useToast } from "@wasfa/ui";
import { useEffect, useState } from "react";

import { api } from "../../lib/api-client";
import { useReauth } from "../../lib/reauth";
import { buildQuery, useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import type { ApiRequestError } from "../../lib/api-error";

export interface DrugMergeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The drug that survives. */
  keep: DrugView;
  onMerged: () => void;
}

const SEARCH_DELAY_MS = 300;

/** Pick the duplicate with the same search the browser uses, then merge it into `keep`. */
export function DrugMergeDialog({ open, onOpenChange, keep, onMerged }: DrugMergeDialogProps) {
  const reauth = useReauth();
  const { toast } = useToast();
  const [text, setText] = useState(keep.brandEn);
  const [query, setQuery] = useState(keep.brandEn);
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
  const candidates =
    results.status === "ready" ? results.data.items.filter((item) => item.id !== keep.id) : [];

  const merge = () => {
    if (pickedId === null || submitting) return;
    setSubmitting(true);
    setError(null);
    reauth
      .run(() =>
        api("/admin/drugs/merge", {
          method: "POST",
          body: { keepId: keep.id, mergeId: pickedId },
          schema: mergeDrugsResponseSchema,
        }),
      )
      .then(
        (result) => {
          setSubmitting(false);
          toast({
            tone: "success",
            title: t("admin.drugs.merge.done", {
              aliases: result.movedAliases,
              ingredients: result.movedIngredients,
            }),
          });
          onOpenChange(false);
          onMerged();
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
      title={t("admin.drugs.merge.title", { name: keep.brandEn })}
      description={t("admin.drugs.merge.body")}
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
          <Button
            type="button"
            variant="danger"
            disabled={pickedId === null}
            loading={submitting}
            onClick={merge}
          >
            {t("admin.drugs.merge.confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("admin.drugs.merge.search")}>
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
            {t("admin.drugs.merge.pick")}
          </legend>
          {results.status === "loading" ? <Skeleton className="h-12 w-full" /> : null}
          {results.status === "ready" && candidates.length === 0 ? (
            <p className="text-sm text-text-muted">{t("admin.drugs.merge.none")}</p>
          ) : null}
          {candidates.map((item) => (
            <label
              key={item.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 has-checked:border-primary has-checked:bg-primary-soft"
            >
              <input
                type="radio"
                name="merge-candidate"
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
