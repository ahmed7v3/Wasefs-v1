"use client";

import { t } from "@wasfa/shared/i18n";
import { modelListResponseSchema } from "@wasfa/shared/schemas/admin-ai";
import {
  evalSetListResponseSchema,
  startEvalRunResponseSchema,
} from "@wasfa/shared/schemas/admin-evals";
import { Button, Checkbox, Dialog, Field, Select, Skeleton, useToast } from "@wasfa/ui";
import { useState } from "react";

import { api } from "../../lib/api-client";
import { errorReason } from "../../lib/api-error";
import { evalReasonText } from "../../lib/eval-format";
import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

export interface EvalsStartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted: () => void;
}

function StartForm({ onOpenChange, onStarted }: Omit<EvalsStartDialogProps, "open">) {
  const sets = useResource("/admin/ai/evals/sets", evalSetListResponseSchema);
  const models = useResource("/admin/ai/models", modelListResponseSchema);
  const reauth = useReauth();
  const { toast } = useToast();
  const [setId, setSetId] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);

  if (sets.status === "loading" || models.status === "loading") {
    return <Skeleton className="h-40 w-full" />;
  }
  if (sets.status === "error") return <ErrorNotice error={sets.error} onRetry={sets.reload} />;
  if (models.status === "error")
    return <ErrorNotice error={models.error} onRetry={models.reload} />;

  const available = sets.data.items.filter((set) => set.items > set.withoutImage);
  if (available.length === 0) return <p className="text-base">{t("admin.evals.start.noSets")}</p>;
  // Only models that can read a prescription: pictures and JSON, switched on.
  const readers = models.data.items.filter(
    (model) =>
      model.enabled && model.capabilities.includes("vision") && model.capabilities.includes("json"),
  );
  const selectedSet = setId === "" ? (available[0]?.id ?? "") : setId;

  const submit = () => {
    setSubmitting(true);
    setError(null);
    setFailure(null);
    reauth
      .run(() =>
        api("/admin/ai/evals/runs", {
          method: "POST",
          body: { setId: selectedSet, modelIds: chosen },
          schema: startEvalRunResponseSchema,
        }),
      )
      .then(
        (started) => {
          setSubmitting(false);
          toast({
            tone: "success",
            title: t("admin.evals.start.started", { count: started.items.length }),
          });
          onStarted();
        },
        (problem: unknown) => {
          setSubmitting(false);
          const reason = errorReason(problem);
          if (reason === undefined) setFailure(toApiError(problem));
          else setError(evalReasonText("start", reason));
        },
      );
  };

  return (
    <div className="flex flex-col gap-4">
      <Field label={t("admin.evals.start.set")}>
        {(control) => (
          <Select
            {...control}
            name="set"
            value={selectedSet}
            onChange={(event) => {
              setSetId(event.target.value);
            }}
          >
            {available.map((set) => (
              <option key={set.id} value={set.id}>
                {set.name} ({set.key})
              </option>
            ))}
          </Select>
        )}
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-base font-semibold">{t("admin.evals.start.models")}</legend>
        <p className="text-sm text-text-muted">{t("admin.evals.start.modelsHint")}</p>
        {readers.map((model) => (
          <Checkbox
            key={model.id}
            label={`${model.displayName} (${model.provider.key})`}
            checked={chosen.includes(model.id)}
            onChange={(event) => {
              setChosen((current) =>
                event.target.checked
                  ? [...current, model.id]
                  : current.filter((id) => id !== model.id),
              );
            }}
          />
        ))}
      </fieldset>
      {error ? (
        <p role="alert" className="text-base text-danger">
          {error}
        </p>
      ) : null}
      {failure ? <ErrorNotice error={toApiError(failure)} /> : null}
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            onOpenChange(false);
          }}
        >
          {t("common.cancel")}
        </Button>
        <Button name="submit-run" loading={submitting} onClick={submit}>
          {t("admin.evals.start.submit")}
        </Button>
      </div>
    </div>
  );
}

/** Picks a set and the models to compare, then queues one run per model. */
export function EvalsStartDialog({ open, onOpenChange, onStarted }: EvalsStartDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("admin.evals.start.title")}>
      {open ? <StartForm onOpenChange={onOpenChange} onStarted={onStarted} /> : null}
    </Dialog>
  );
}
