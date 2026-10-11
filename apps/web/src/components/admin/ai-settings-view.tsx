"use client";

import { t } from "@wasfa/shared/i18n";
import {
  aiSettingsResponseSchema,
  putAiSettingsSchema,
  type AiSettingsResponse,
  type PutAiSettingsInput,
} from "@wasfa/shared/schemas/admin-ai";
import { Button, Card, CardTitle, Checkbox, Field, Input, Skeleton, useToast } from "@wasfa/ui";
import { useState } from "react";

import { formatDateTime } from "../../lib/admin-format";
import { formatUsd, parseUsd, usdInputText } from "../../lib/ai-admin";
import { api } from "../../lib/api-client";
import { fieldPaths, type ApiRequestError } from "../../lib/api-error";
import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import { KillSwitchCard, type KillSwitchValue } from "./ai-kill-switch";

import type { FormEvent } from "react";

type SpendErrors = Partial<
  Record<"dailyCapUsdMicros" | "alertPercent" | "creditValueUsdMicros", string>
>;

function usdError(text: string, field: "dailyCapUsdMicros" | "creditValueUsdMicros") {
  const parsed = parseUsd(text, false);
  if (!parsed.ok) {
    return {
      error: t(parsed.reason === "required" ? "form.required" : "admin.ai.error.usd"),
      value: null,
    };
  }
  if (field === "creditValueUsdMicros" && parsed.value === 0) {
    return { error: t("admin.ai.settings.error.creditValue"), value: null };
  }
  return { error: undefined, value: parsed.value };
}

interface SpendFormProps {
  value: AiSettingsResponse["value"];
  canWrite: boolean;
  onSave: (body: PutAiSettingsInput) => Promise<void>;
}

/** Daily cap, alert percent, credit value and the preview-model switch; the kill switch has its own card. */
function SpendForm({ value, canWrite, onSave }: SpendFormProps) {
  const [dailyCap, setDailyCap] = useState(usdInputText(value.dailyCapUsdMicros));
  const [alertPercent, setAlertPercent] = useState(String(value.alertPercent));
  const [creditValue, setCreditValue] = useState(usdInputText(value.creditValueUsdMicros));
  const [allowPreview, setAllowPreview] = useState(value.allowPreviewModels);
  const [errors, setErrors] = useState<SpendErrors>({});
  const [formError, setFormError] = useState<ApiRequestError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitCount, setSubmitCount] = useState(0);

  const creditPreview = parseUsd(creditValue, false);
  const creditHint = t("admin.ai.settings.creditValueHint", {
    value: formatUsd(
      creditPreview.ok && creditPreview.value !== null && creditPreview.value > 0
        ? creditPreview.value
        : value.creditValueUsdMicros,
    ),
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !canWrite) return;

    const next: SpendErrors = {};
    const cap = usdError(dailyCap, "dailyCapUsdMicros");
    if (cap.error) next.dailyCapUsdMicros = cap.error;
    const credit = usdError(creditValue, "creditValueUsdMicros");
    if (credit.error) next.creditValueUsdMicros = credit.error;
    const percent = /^\d{1,3}$/.test(alertPercent.trim()) ? Number(alertPercent) : NaN;
    if (!(percent >= 1 && percent <= 100)) {
      next.alertPercent = t(
        alertPercent.trim() === "" ? "form.required" : "admin.ai.settings.error.percent",
      );
    }
    // The kill switch travels unchanged: this form never edits it.
    const body = putAiSettingsSchema.safeParse({
      dailyCapUsdMicros: cap.value,
      alertPercent: percent,
      killSwitch: value.killSwitch,
      creditValueUsdMicros: credit.value,
      allowPreviewModels: allowPreview,
    });
    if (Object.keys(next).length > 0 || !body.success) {
      setErrors(next);
      setFormError(null);
      setSubmitCount((count) => count + 1);
      return;
    }

    setSubmitting(true);
    setErrors({});
    setFormError(null);
    onSave(body.data).then(
      () => {
        setSubmitting(false);
      },
      (error: unknown) => {
        setSubmitting(false);
        const paths = fieldPaths(error);
        const known = paths.filter(
          (path): path is keyof SpendErrors =>
            path === "dailyCapUsdMicros" ||
            path === "alertPercent" ||
            path === "creditValueUsdMicros",
        );
        if (known.length > 0) {
          setErrors(Object.fromEntries(known.map((path) => [path, t("form.invalid")])));
          setSubmitCount((count) => count + 1);
        } else {
          setFormError(toApiError(error));
        }
      },
    );
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label={t("admin.ai.settings.spendTitle")}
      className="flex flex-col gap-4"
    >
      <Field
        label={t("admin.ai.settings.dailyCap")}
        hint={t("admin.ai.settings.dailyCapHint")}
        error={errors.dailyCapUsdMicros}
        announceError={submitCount > 0}
      >
        {(control) => (
          <Input
            {...control}
            name="dailyCapUsdMicros"
            ltr
            inputMode="decimal"
            autoComplete="off"
            value={dailyCap}
            disabled={!canWrite}
            onChange={(event) => {
              setDailyCap(event.target.value);
            }}
          />
        )}
      </Field>
      <Field
        label={t("admin.ai.settings.alertPercent")}
        hint={t("admin.ai.settings.alertPercentHint")}
        error={errors.alertPercent}
        announceError={submitCount > 0}
      >
        {(control) => (
          <Input
            {...control}
            name="alertPercent"
            ltr
            inputMode="numeric"
            autoComplete="off"
            value={alertPercent}
            disabled={!canWrite}
            onChange={(event) => {
              setAlertPercent(event.target.value);
            }}
          />
        )}
      </Field>
      <Field
        label={t("admin.ai.settings.creditValue")}
        hint={creditHint}
        error={errors.creditValueUsdMicros}
        announceError={submitCount > 0}
      >
        {(control) => (
          <Input
            {...control}
            name="creditValueUsdMicros"
            ltr
            inputMode="decimal"
            autoComplete="off"
            value={creditValue}
            disabled={!canWrite}
            onChange={(event) => {
              setCreditValue(event.target.value);
            }}
          />
        )}
      </Field>
      <div className="flex flex-col gap-1">
        <Checkbox
          name="allowPreviewModels"
          label={t("admin.ai.settings.allowPreview")}
          checked={allowPreview}
          disabled={!canWrite}
          onChange={(event) => {
            setAllowPreview(event.target.checked);
          }}
        />
        <p className="text-sm text-text-muted">{t("admin.ai.settings.allowPreviewHint")}</p>
      </div>
      {formError ? <ErrorNotice error={formError} /> : null}
      {canWrite ? (
        <div className="flex justify-end">
          <Button type="submit" name="save" loading={submitting}>
            {t("common.save")}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

export interface AiSettingsViewProps {
  /** `ai.write`. */
  canWrite: boolean;
  /** `ai.killswitch`; changing a switch also needs `canWrite`. */
  canKill: boolean;
}

export function AiSettingsView({ canWrite, canKill }: AiSettingsViewProps) {
  const resource = useResource("/admin/ai/settings", aiSettingsResponseSchema);
  const reauth = useReauth();
  const { toast } = useToast();
  // The answer of the last save replaces the loaded settings without refetching them.
  const [saved, setSaved] = useState<AiSettingsResponse | null>(null);

  if (resource.status === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <p className="sr-only" role="status">
          {t("ui.loading")}
        </p>
        {Array.from({ length: 2 }, (_, index) => (
          <Card key={index} elevation="flat" className="flex flex-col gap-3">
            <Skeleton className="h-7 w-1/3" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </Card>
        ))}
      </div>
    );
  }
  if (resource.status === "error") {
    return <ErrorNotice error={resource.error} onRetry={resource.reload} />;
  }

  const current = saved ?? resource.data;
  const put = async (body: PutAiSettingsInput): Promise<AiSettingsResponse> => {
    const response = await api("/admin/ai/settings", {
      method: "PUT",
      body,
      schema: aiSettingsResponseSchema,
    });
    setSaved(response);
    return response;
  };

  const killSwitch: KillSwitchValue = current.value.killSwitch;
  const writeBody = (overrides: Partial<PutAiSettingsInput>): PutAiSettingsInput => ({
    dailyCapUsdMicros: current.value.dailyCapUsdMicros,
    alertPercent: current.value.alertPercent,
    killSwitch,
    creditValueUsdMicros: current.value.creditValueUsdMicros,
    allowPreviewModels: current.value.allowPreviewModels,
    ...overrides,
  });

  return (
    <div className="flex flex-col gap-5">
      <p className="text-base text-text-muted">
        {canWrite ? t("admin.ai.settings.lead") : t("admin.ai.settings.readOnlyNote")}
      </p>

      <Card elevation="flat" padding="compact" className="flex flex-col gap-4">
        <CardTitle>{t("admin.ai.settings.spendTitle")}</CardTitle>
        <SpendForm
          value={current.value}
          canWrite={canWrite}
          onSave={async (body) => {
            await reauth.run(() => put(body));
            toast({ tone: "success", title: t("admin.ai.settings.saved") });
          }}
        />
        <p className="text-xs text-text-muted tabular-nums">
          {current.updatedAt
            ? t("admin.settings.updatedAt", { date: formatDateTime(current.updatedAt) })
            : t("admin.settings.usingDefault")}
        </p>
      </Card>

      <KillSwitchCard
        value={killSwitch}
        canChange={canWrite && canKill}
        onChange={async (next, change) => {
          await put(writeBody({ killSwitch: next }));
          toast({
            tone: "success",
            title: t(change.next ? "admin.ai.kill.savedOn" : "admin.ai.kill.savedOff", {
              name: t(`admin.ai.kill.name.${change.name}`),
            }),
          });
        }}
      />
    </div>
  );
}
