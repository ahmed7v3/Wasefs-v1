"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import { SETTINGS_REGISTRY, settingDefault, type SettingKey } from "@wasfa/shared/settings";
import { Button, Checkbox, Field, Input, Select, Textarea } from "@wasfa/ui";
import { useMemo, useState } from "react";

import { tOr } from "../../lib/admin-format";
import { fieldPaths, type ApiRequestError } from "../../lib/api-error";
import { describeIssue, toApiError } from "../../lib/forms";
import {
  fromDraft,
  settingFields,
  toDraft,
  type SettingDraft,
  type SettingField,
} from "../../lib/setting-fields";
import { ErrorNotice } from "../error-notice";

import type { FormEvent } from "react";

/** Messages for the schemas' own `custom` rules (the registry's refinements). */
const CUSTOM_MESSAGES: Record<string, MessageKey> = {
  "default must be enabled": "admin.settings.error.defaultNotEnabled",
};

/** Fields shown as left-to-right runs: URLs, handles, codes, phone numbers and English names. */
const LTR_FIELDS = new Set([
  "logoUrl",
  "nameEn",
  "whatsapp",
  "telegram",
  "phone",
  "email",
  "facebook",
  "instagram",
  "tiktok",
  "x",
  "youtube",
  "default",
  "enabled",
  "blockedEmailDomains",
  "monthlyAnalyses",
]);

export interface SettingFormProps {
  settingKey: SettingKey;
  /** The stored value, or the default while no row exists. */
  value: unknown;
  canWrite: boolean;
  /** Receives the value the registry schema accepted. Throw (the `api` client does) to show the error. */
  onSave: (value: unknown) => Promise<void>;
}

function errorPath(path: readonly PropertyKey[]): string {
  // `enabled.2` (the third currency) is an error of the `enabled` list field.
  return path
    .filter((segment) => typeof segment !== "number")
    .map(String)
    .join(".");
}

function valueAt(value: unknown, path: readonly PropertyKey[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

/** One message per field path, from the registry schema (the same rules the API applies). */
function validateSetting(key: SettingKey, value: unknown) {
  const result = SETTINGS_REGISTRY[key].schema.safeParse(value);
  if (result.success) return { data: result.data as unknown, errors: {} as Record<string, string> };
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = errorPath(issue.path);
    if (path === "" || Object.hasOwn(errors, path)) continue;
    const custom = issue.code === "custom" ? CUSTOM_MESSAGES[issue.message] : undefined;
    errors[path] = custom ? t(custom) : describeIssue(issue, valueAt(value, issue.path));
  }
  return { data: undefined, errors };
}

/**
 * The form of one settings key, generated from its registry schema (`settingFields`). Validation is
 * the registry schema itself, so the browser and the API agree; server field paths are mapped back
 * onto the inputs. A key the account may only read renders the same fields, disabled.
 */
export function SettingForm({ settingKey, value, canWrite, onSave }: SettingFormProps) {
  const fields = useMemo(() => settingFields(SETTINGS_REGISTRY[settingKey].schema), [settingKey]);
  const [draft, setDraft] = useState<SettingDraft>(() => {
    const parsed = SETTINGS_REGISTRY[settingKey].schema.safeParse(value);
    return toDraft(fields, parsed.success ? parsed.data : settingDefault(settingKey));
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<ApiRequestError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitCount, setSubmitCount] = useState(0);

  const set = (path: string, next: string | boolean) => {
    setDraft((current) => ({ ...current, [path]: next }));
    setErrors((current) => {
      if (!Object.hasOwn(current, path)) return current;
      return Object.fromEntries(Object.entries(current).filter(([name]) => name !== path));
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !canWrite) return;
    const candidate = fromDraft(fields, draft);
    const checked = validateSetting(settingKey, candidate);
    if (checked.data === undefined) {
      setErrors(checked.errors);
      setFormError(null);
      setSubmitCount((count) => count + 1);
      return;
    }
    setSubmitting(true);
    setErrors({});
    setFormError(null);
    onSave(checked.data).then(
      () => {
        setSubmitting(false);
      },
      (error: unknown) => {
        setSubmitting(false);
        const paths = fieldPaths(error);
        if (paths.length > 0) {
          const client = validateSetting(settingKey, candidate).errors;
          setErrors(
            Object.fromEntries(paths.map((path) => [path, client[path] ?? t("form.invalid")])),
          );
          setSubmitCount((count) => count + 1);
        } else {
          setFormError(toApiError(error));
        }
      },
    );
  };

  const fieldLabel = (field: SettingField) =>
    tOr(`admin.settings.field.${settingKey}.${field.path}`, field.name);

  const renderField = (field: SettingField) => {
    const label = fieldLabel(field);
    const error = errors[field.path];
    switch (field.kind) {
      case "group":
        return (
          <fieldset
            key={field.path}
            className="flex flex-col gap-4 rounded-md border border-border p-4"
          >
            <legend className="px-2 text-base font-semibold text-text">{label}</legend>
            {field.fields.map(renderField)}
          </fieldset>
        );
      case "boolean":
        return (
          <Checkbox
            key={field.path}
            name={field.path}
            label={label}
            checked={draft[field.path] === true}
            disabled={!canWrite}
            onChange={(event) => {
              set(field.path, event.target.checked);
            }}
          />
        );
      case "enum":
        return (
          <Field key={field.path} label={label} error={error} announceError={submitCount > 0}>
            {(control) => (
              <Select
                {...control}
                name={field.path}
                value={String(draft[field.path] ?? "")}
                disabled={!canWrite}
                onChange={(event) => {
                  set(field.path, event.target.value);
                }}
              >
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {tOr(`admin.settings.option.${option}`, option)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        );
      case "list":
      case "json":
        return (
          <Field
            key={field.path}
            label={label}
            hint={field.kind === "list" ? t("admin.settings.listHint") : undefined}
            error={error}
            announceError={submitCount > 0}
          >
            {(control) => (
              <Textarea
                {...control}
                name={field.path}
                ltr
                value={String(draft[field.path] ?? "")}
                disabled={!canWrite}
                onChange={(event) => {
                  set(field.path, event.target.value);
                }}
              />
            )}
          </Field>
        );
      default:
        return (
          <Field key={field.path} label={label} error={error} announceError={submitCount > 0}>
            {(control) => (
              <Input
                {...control}
                name={field.path}
                type={field.kind === "number" ? "number" : "text"}
                inputMode={field.kind === "number" ? "numeric" : undefined}
                ltr={LTR_FIELDS.has(field.name)}
                autoComplete="off"
                value={String(draft[field.path] ?? "")}
                disabled={!canWrite}
                onChange={(event) => {
                  set(field.path, event.target.value);
                }}
              />
            )}
          </Field>
        );
    }
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label={tOr(`admin.settings.${settingKey}.title`, settingKey)}
      className="flex flex-col gap-4"
    >
      {fields.map(renderField)}
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
