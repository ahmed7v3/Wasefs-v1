"use client";

import { AI_DATA_POLICIES, AI_PROVIDER_KINDS, type AiProviderKind } from "@wasfa/shared/ai";
import { t } from "@wasfa/shared/i18n";
import {
  createProviderSchema,
  providerViewSchema,
  updateProviderSchema,
  type ProviderView,
} from "@wasfa/shared/schemas/admin-ai";
import { Button, Checkbox, Field, Input, PasswordInput, Select, useToast } from "@wasfa/ui";
import { KeyRound } from "lucide-react";
import { useState } from "react";

import { api } from "../../lib/api-client";
import { errorReason, fieldPaths, type ApiRequestError } from "../../lib/api-error";
import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { ErrorNotice, errorMessage } from "../error-notice";
import { Notice } from "../notice";

import type { FormEvent } from "react";

type FieldName = "key" | "baseUrl" | "priority" | "apiKey";
type Errors = Partial<Record<FieldName, string>>;

const FIELD_ERROR_KEYS = {
  key: "admin.ai.providers.error.key",
  baseUrl: "admin.ai.providers.error.baseUrl",
  priority: "admin.ai.providers.error.priority",
  apiKey: "admin.ai.providers.error.apiKey",
} as const;

const isField = (name: unknown): name is FieldName =>
  typeof name === "string" && Object.hasOwn(FIELD_ERROR_KEYS, name);

/** Required text fields say "required" when blank, else the rule the field breaks. */
function messageFor(field: FieldName, blank: boolean): string {
  return blank && field !== "apiKey" ? t("form.required") : t(FIELD_ERROR_KEYS[field]);
}

export interface ProviderFormProps {
  /** `null` creates a provider; a provider opens it for editing (its id and kind are fixed). */
  provider: ProviderView | null;
  onClose: () => void;
  onSaved: () => void;
  /** Edit only: asks the page to confirm removing the stored key. */
  onRemoveKey?: (() => void) | undefined;
}

/**
 * One form for adding and editing a provider. The API key only ever travels inward: the field starts
 * empty (even when a key is stored), and `apiKey` is sent only if the admin typed a new one.
 */
export function ProviderForm({ provider, onClose, onSaved, onRemoveKey }: ProviderFormProps) {
  const reauth = useReauth();
  const { toast } = useToast();
  const creating = provider === null;

  const [key, setKey] = useState("");
  const [kind, setKind] = useState<AiProviderKind>(provider?.kind ?? "openrouter");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "");
  const [dataPolicy, setDataPolicy] = useState(provider?.dataPolicy ?? "paid_no_training");
  const [priority, setPriority] = useState(String(provider?.priority ?? 100));
  const [enabled, setEnabled] = useState(provider?.enabled ?? false);
  const [apiKey, setApiKey] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<ApiRequestError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitCount, setSubmitCount] = useState(0);

  const needsBaseUrl = kind === "openai_compatible";

  const fail = (next: Errors) => {
    setErrors(next);
    setFormError(null);
    setSubmitCount((count) => count + 1);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const blank: Record<FieldName, boolean> = {
      key: key.trim() === "",
      baseUrl: baseUrl.trim() === "",
      priority: priority.trim() === "",
      apiKey: apiKey.trim() === "",
    };
    const priorityValue = /^\d{1,6}$/.test(priority.trim()) ? Number(priority) : Number.NaN;
    const typedKey = apiKey.trim();
    const common = {
      dataPolicy,
      priority: priorityValue,
      enabled,
      ...(needsBaseUrl ? { baseUrl: baseUrl.trim() } : {}),
      ...(typedKey === "" ? {} : { apiKey: typedKey }),
    };
    const body = creating
      ? { key: key.trim(), kind, ...common, baseUrl: needsBaseUrl ? baseUrl.trim() : null }
      : common;

    // The same shared schemas the API applies, so the browser and the server agree.
    const parsed = creating
      ? createProviderSchema.safeParse(body)
      : updateProviderSchema.safeParse(body);
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (isField(field) && !Object.hasOwn(next, field)) {
          next[field] = messageFor(field, blank[field]);
        }
      }
      fail(next);
      return;
    }

    setSubmitting(true);
    setErrors({});
    setFormError(null);
    reauth
      .run(() =>
        api(creating ? "/admin/ai/providers" : `/admin/ai/providers/${provider.id}`, {
          method: creating ? "POST" : "PATCH",
          body: parsed.data,
          schema: providerViewSchema,
        }),
      )
      .then(
        (saved) => {
          toast({
            tone: "success",
            title: t(creating ? "admin.ai.providers.created" : "admin.ai.providers.saved", {
              key: saved.key,
            }),
          });
          onSaved();
          onClose();
        },
        (error: unknown) => {
          setSubmitting(false);
          const paths = fieldPaths(error).filter(isField);
          if (paths.length > 0) {
            const reasonText = errorReason(error) ? errorMessage(error) : undefined;
            fail(Object.fromEntries(paths.map((path) => [path, reasonText ?? t("form.invalid")])));
          } else if (errorReason(error) === "key_taken") {
            fail({ key: errorMessage(error) });
          } else {
            setFormError(toApiError(error));
          }
        },
      );
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <Field
        label={t("admin.ai.providers.field.key")}
        hint={creating ? t("admin.ai.providers.field.keyHint") : undefined}
        required={creating}
        error={errors.key}
        announceError={submitCount > 0}
      >
        {(control) => (
          <Input
            {...control}
            name="key"
            ltr
            autoComplete="off"
            value={creating ? key : provider.key}
            disabled={!creating}
            onChange={(event) => {
              setKey(event.target.value.trim());
            }}
          />
        )}
      </Field>

      <Field label={t("admin.ai.providers.field.kind")}>
        {(control) => (
          <Select
            {...control}
            name="kind"
            value={kind}
            disabled={!creating}
            onChange={(event) => {
              setKind(event.target.value as AiProviderKind);
              setErrors({});
            }}
          >
            {AI_PROVIDER_KINDS.map((option) => (
              <option key={option} value={option}>
                {t(`admin.ai.kind.${option}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {needsBaseUrl ? (
        <Field
          label={t("admin.ai.providers.field.baseUrl")}
          hint={t("admin.ai.providers.field.baseUrlHint")}
          required
          error={errors.baseUrl}
          announceError={submitCount > 0}
        >
          {(control) => (
            <Input
              {...control}
              name="baseUrl"
              type="url"
              ltr
              autoComplete="off"
              value={baseUrl}
              onChange={(event) => {
                setBaseUrl(event.target.value);
              }}
            />
          )}
        </Field>
      ) : null}

      <Field label={t("admin.ai.providers.field.dataPolicy")}>
        {(control) => (
          <Select
            {...control}
            name="dataPolicy"
            value={dataPolicy}
            onChange={(event) => {
              setDataPolicy(event.target.value as typeof dataPolicy);
            }}
          >
            {AI_DATA_POLICIES.map((option) => (
              <option key={option} value={option}>
                {t(`admin.ai.policy.${option}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {dataPolicy === "free_tier" ? (
        <Notice tone="warning">{t("admin.ai.policy.free_tier.note")}</Notice>
      ) : null}

      <Field
        label={t("admin.ai.providers.field.priority")}
        error={errors.priority}
        announceError={submitCount > 0}
      >
        {(control) => (
          <Input
            {...control}
            name="priority"
            ltr
            inputMode="numeric"
            autoComplete="off"
            value={priority}
            onChange={(event) => {
              setPriority(event.target.value);
            }}
          />
        )}
      </Field>

      <Field
        label={t("admin.ai.providers.field.apiKey")}
        hint={
          provider?.hasKey && provider.keyHint
            ? t("admin.ai.providers.field.apiKeyCurrent", { hint: provider.keyHint })
            : undefined
        }
        error={errors.apiKey}
        announceError={submitCount > 0}
      >
        {(control) => (
          <PasswordInput
            {...control}
            name="apiKey"
            ltr
            autoComplete="new-password"
            spellCheck={false}
            placeholder={creating ? undefined : t("admin.ai.providers.field.apiKeyReplace")}
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value);
            }}
          />
        )}
      </Field>
      {!creating && provider.hasKey && onRemoveKey ? (
        <div>
          <Button type="button" variant="secondary" name="remove-key" onClick={onRemoveKey}>
            <KeyRound aria-hidden className="size-5" />
            {t("admin.ai.providers.removeKey")}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <Checkbox
          name="enabled"
          label={t("admin.ai.providers.field.enabled")}
          checked={enabled}
          onChange={(event) => {
            setEnabled(event.target.checked);
          }}
        />
        <p className="text-sm text-text-muted">{t("admin.ai.providers.field.enabledHint")}</p>
      </div>

      {formError ? <ErrorNotice error={formError} /> : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="ghost" name="cancel" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" name="save" loading={submitting}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}
