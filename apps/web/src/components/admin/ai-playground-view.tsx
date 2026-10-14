"use client";

import { AI_TASKS } from "@wasfa/shared/ai";
import { t, type MessageKey } from "@wasfa/shared/i18n";
import {
  PLAYGROUND_MAX_INPUT_CHARS,
  PLAYGROUND_MAX_MODELS,
  modelListResponseSchema,
  playgroundResponseSchema,
  type PlaygroundRun,
} from "@wasfa/shared/schemas/admin-ai";
import { Badge, Button, Card, CardTitle, Checkbox, Field, Select, Skeleton, Textarea } from "@wasfa/ui";
import { useState } from "react";

import { formatNumber } from "../../lib/admin-format";
import { formatUsd } from "../../lib/ai-admin";
import { api } from "../../lib/api-client";
import { toApiError } from "../../lib/forms";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";
import { Notice } from "../notice";

import type { ApiRequestError } from "../../lib/api-error";
import type { FormEvent } from "react";

const STATUS_TONE = { ok: "success", error: "danger", refused: "warning" } as const;

function RunCard({ run }: { run: PlaygroundRun }) {
  return (
    <Card elevation="flat" padding="compact" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>
          <span dir="ltr">{run.modelKey}</span>
        </CardTitle>
        <Badge tone={STATUS_TONE[run.status]}>
          {t(`admin.ai.pg.status.${run.status}` as MessageKey)}
        </Badge>
      </div>
      <p className="text-xs text-text-muted" dir="ltr">
        {run.providerKey}
      </p>
      {run.errorCode ? (
        <p className="text-sm text-text-muted" dir="ltr">
          {t("admin.ai.pg.code", { code: run.errorCode })}
        </p>
      ) : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-text-muted">{t("admin.ai.pg.cost")}</dt>
        <dd dir="ltr" className="text-start tabular-nums">
          {formatUsd(run.costUsdMicros)}
        </dd>
        <dt className="text-text-muted">{t("admin.ai.pg.latency")}</dt>
        <dd dir="ltr" className="text-start tabular-nums">
          {t("admin.ai.ov.ms", { value: formatNumber(run.latencyMs) })}
        </dd>
        <dt className="text-text-muted">{t("admin.ai.pg.tokens")}</dt>
        <dd dir="ltr" className="text-start tabular-nums">
          {run.usage
            ? t("admin.ai.pg.tokensValue", {
                input: formatNumber(run.usage.inputTokens),
                output: formatNumber(run.usage.outputTokens),
                thinking: formatNumber(run.usage.thinkingTokens),
              })
            : t("admin.ai.ov.none")}
        </dd>
      </dl>
      {run.validation.schema ? (
        <div className="flex flex-col gap-1">
          <Badge tone={run.validation.ok ? "success" : "danger"}>
            {t(run.validation.ok ? "admin.ai.pg.validOk" : "admin.ai.pg.validBad", {
              schema: run.validation.schema,
            })}
          </Badge>
          {run.validation.errors.length > 0 ? (
            <ul className="list-disc ps-5 text-sm" dir="ltr">
              {run.validation.errors.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold">{t("admin.ai.pg.output")}</p>
        <pre
          dir="auto"
          className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-neutral-50 p-3 text-sm"
        >
          {run.output === "" ? t("admin.ai.pg.empty") : run.output}
        </pre>
      </div>
    </Card>
  );
}

/**
 * The model playground (Task 2.4): one text input, up to three models, results side by side. Text
 * only on this page: pictures would need the full upload flow; the API already accepts `fileIds`.
 */
export function AiPlaygroundView() {
  const models = useResource("/admin/ai/models", modelListResponseSchema);
  const [task, setTask] = useState<(typeof AI_TASKS)[number]>("chat");
  const [input, setInput] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<ApiRequestError | null>(null);
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState<PlaygroundRun[] | null>(null);

  if (models.status === "loading") return <Skeleton className="h-64 w-full" />;
  if (models.status === "error") {
    return <ErrorNotice error={models.error} onRetry={models.reload} />;
  }
  const usable = models.data.items.filter((model) => model.enabled);

  const toggle = (id: string, on: boolean) => {
    setPicked((current) =>
      on ? [...current, id].slice(0, PLAYGROUND_MAX_MODELS) : current.filter((item) => item !== id),
    );
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (running) return;
    if (input.trim() === "") return setError(t("admin.ai.pg.needInput"));
    if (picked.length === 0) return setError(t("admin.ai.pg.needModel"));
    setError(undefined);
    setFormError(null);
    setRunning(true);
    api("/admin/ai/playground", {
      method: "POST",
      body: { task, input, fileIds: [], modelIds: picked },
      schema: playgroundResponseSchema,
    }).then(
      (response) => {
        setRuns(response.runs);
        setRunning(false);
      },
      (failure: unknown) => {
        setRunning(false);
        setFormError(toApiError(failure));
      },
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="text-base text-text-muted">{t("admin.ai.pg.lead")}</p>
      <Card elevation="flat" padding="compact">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Field label={t("admin.ai.pg.task")}>
            {(control) => (
              <Select
                {...control}
                name="task"
                value={task}
                onChange={(event) => {
                  setTask(event.target.value as (typeof AI_TASKS)[number]);
                }}
              >
                {AI_TASKS.map((value) => (
                  <option key={value} value={value}>
                    {t(`admin.ai.task.${value}` as MessageKey)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label={t("admin.ai.pg.input")}
            hint={`${t("admin.ai.pg.inputHint", { max: formatNumber(PLAYGROUND_MAX_INPUT_CHARS) })} ${t("admin.ai.pg.textOnly")}`}
            error={error}
          >
            {(control) => (
              <Textarea
                {...control}
                name="input"
                rows={6}
                maxLength={PLAYGROUND_MAX_INPUT_CHARS}
                value={input}
                onChange={(event) => {
                  setInput(event.target.value);
                }}
              />
            )}
          </Field>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-base font-semibold">{t("admin.ai.pg.models")}</legend>
            {usable.length === 0 ? (
              <p className="text-sm text-text-muted">{t("admin.ai.pg.noModels")}</p>
            ) : null}
            {usable.map((model) => {
              const on = picked.includes(model.id);
              return (
                <Checkbox
                  key={model.id}
                  name={`model-${model.id}`}
                  label={`${model.displayName} (${model.provider.key} / ${model.modelId})`}
                  checked={on}
                  disabled={!on && picked.length >= PLAYGROUND_MAX_MODELS}
                  onChange={(event) => {
                    toggle(model.id, event.target.checked);
                  }}
                />
              );
            })}
          </fieldset>
          {formError ? (
            formError.status === 429 ? (
              <Notice tone="warning">{t("admin.ai.pg.rateLimited")}</Notice>
            ) : (
              <ErrorNotice error={formError} />
            )
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" name="run" loading={running}>
              {t("admin.ai.pg.run")}
            </Button>
          </div>
        </form>
      </Card>

      {runs ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3" aria-live="polite">
          {runs.map((run) => (
            <RunCard key={run.modelId} run={run} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
