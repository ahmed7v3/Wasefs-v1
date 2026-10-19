"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import { SETTINGS_REGISTRY, settingDefault, type SettingKey } from "@wasfa/shared/settings";
import { Button, Checkbox, Field, Input, Select, Textarea, cn } from "@wasfa/ui";
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
  type SettingScales,
} from "../../lib/setting-fields";
import {
  SETTING_LAYOUTS,
  SETTING_UNITS,
  UNIT_SCALE,
  type SettingSection,
  type SettingUnit,
} from "../../lib/setting-meta";
import { ErrorNotice } from "../error-notice";

import type { FormEvent, ReactNode } from "react";

/** Messages for the schemas' own `custom` rules (the registry's refinements). */
const CUSTOM_MESSAGES: Record<string, MessageKey> = {
  "default must be enabled": "admin.settings.error.defaultNotEnabled",
  "endHour must be after startHour": "admin.settings.error.endAfterStart",
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
  "timezone",
  "currency",
  "taxId",
  "titleTemplate",
  "defaultOgImage",
  "google",
  "bing",
  "yandex",
  "key",
  "brandRegex",
  "aiReferrerHosts",
]);

export interface SettingFormProps {
  settingKey: SettingKey;
  /** The stored value, or the default while no row exists. */
  value: unknown;
  canWrite: boolean;
  /** Receives the value the registry schema accepted. Throw (the `api` client does) to show the error. */
  onSave: (value: unknown) => Promise<void>;
}

type Leaf = Exclude<SettingField, { kind: "group" }>;

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

function leaves(fields: readonly SettingField[]): Leaf[] {
  return fields.flatMap((field) => (field.kind === "group" ? leaves(field.fields) : [field]));
}

function unitOf(key: SettingKey, path: string): SettingUnit | undefined {
  return SETTING_UNITS[`${key}.${path}`];
}

/** One message per field path, from the registry schema (the same rules the API applies). */
function validateSetting(key: SettingKey, value: unknown, scales: SettingScales) {
  const result = SETTINGS_REGISTRY[key].schema.safeParse(value);
  if (result.success) return { data: result.data as unknown, errors: {} as Record<string, string> };
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = errorPath(issue.path);
    if (path === "" || Object.hasOwn(errors, path)) continue;
    const custom = issue.code === "custom" ? CUSTOM_MESSAGES[issue.message] : undefined;
    if (custom) {
      errors[path] = t(custom);
      continue;
    }
    const scale = scales[path] ?? 1;
    const stored = valueAt(value, issue.path);
    if (scale !== 1 && typeof stored === "number" && !Number.isInteger(stored)) {
      errors[path] = t("admin.settings.error.tooPrecise");
      continue;
    }
    // Limits are stored units: say them in the unit the field is typed in.
    const shown = {
      ...issue,
      ...("minimum" in issue ? { minimum: Number(issue.minimum) / scale } : {}),
      ...("maximum" in issue ? { maximum: Number(issue.maximum) / scale } : {}),
    };
    errors[path] = describeIssue(shown, stored);
  }
  return { data: undefined, errors };
}

function sameDraft(a: SettingDraft, b: SettingDraft): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

/**
 * The form of one settings key, generated from its registry schema (`settingFields`) and laid out
 * by `SETTING_LAYOUTS`: titled sections, Arabic labels and help, units (percent and pounds are
 * typed in friendly units and stored unchanged), and the default when the value differs from it.
 * Validation is the registry schema itself, so the browser and the API agree; server field paths
 * are mapped back onto the inputs. A key the account may only read renders the same fields, disabled.
 */
export function SettingForm({ settingKey, value, canWrite, onSave }: SettingFormProps) {
  const fields = useMemo(() => settingFields(SETTINGS_REGISTRY[settingKey].schema), [settingKey]);
  const scales = useMemo<SettingScales>(() => {
    const result: Record<string, number> = {};
    for (const leaf of leaves(fields)) {
      const unit = unitOf(settingKey, leaf.path);
      const scale = unit ? UNIT_SCALE[unit] : undefined;
      if (leaf.kind === "number" && scale) result[leaf.path] = scale;
    }
    return result;
  }, [fields, settingKey]);
  const defaults = useMemo(
    () => toDraft(fields, settingDefault(settingKey), scales),
    [fields, scales, settingKey],
  );
  const [initial, setInitial] = useState<SettingDraft>(() => {
    const parsed = SETTINGS_REGISTRY[settingKey].schema.safeParse(value);
    return toDraft(fields, parsed.success ? parsed.data : settingDefault(settingKey), scales);
  });
  const [draft, setDraft] = useState<SettingDraft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<ApiRequestError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitCount, setSubmitCount] = useState(0);
  const dirty = !sameDraft(draft, initial);

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
    const candidate = fromDraft(fields, draft, scales);
    const checked = validateSetting(settingKey, candidate, scales);
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
        setInitial(draft);
      },
      (error: unknown) => {
        setSubmitting(false);
        const paths = fieldPaths(error);
        if (paths.length > 0) {
          const client = validateSetting(settingKey, candidate, scales).errors;
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
  const fieldHelp = (field: SettingField) =>
    tOr(`admin.settings.help.${settingKey}.${field.path}`, "");
  const unitLabel = (field: SettingField) => {
    const unit = unitOf(settingKey, field.path);
    return unit ? t(`admin.settings.unit.${unit}`) : "";
  };

  const shownValue = (field: Leaf, raw: string | boolean | undefined): string => {
    if (field.kind === "boolean")
      return t(raw === true ? "admin.settings.on" : "admin.settings.off");
    const text = typeof raw === "string" ? raw : "";
    if (text === "") return t("admin.settings.empty");
    if (field.kind === "enum") return tOr(`admin.settings.option.${text}`, text);
    const unit = unitLabel(field);
    return unit ? `${text} ${unit}` : text;
  };

  /** Help, then "default: X" when the current value differs from the default. */
  const hintOf = (field: Leaf): ReactNode => {
    const help = fieldHelp(field);
    const fallback = defaults[field.path];
    const showDefault =
      field.kind !== "json" && fallback !== undefined && draft[field.path] !== fallback;
    if (!help && !showDefault) return undefined;
    return (
      <>
        {help}
        {showDefault ? (
          <span className="block text-text-muted">
            {t("admin.settings.defaultIs", { value: shownValue(field, fallback) })}
          </span>
        ) : null}
      </>
    );
  };

  const renderLeaf = (field: Leaf) => {
    const label = fieldLabel(field);
    const error = errors[field.path];
    const hint = hintOf(field);
    switch (field.kind) {
      case "boolean":
        return (
          <div key={field.path} className="flex flex-col gap-1">
            <Checkbox
              name={field.path}
              label={<span className="font-medium">{label}</span>}
              checked={draft[field.path] === true}
              disabled={!canWrite}
              onChange={(event) => {
                set(field.path, event.target.checked);
              }}
            />
            {hint ? <p className="ms-9 text-sm text-text-muted">{hint}</p> : null}
          </div>
        );
      case "enum":
        return (
          <Field
            key={field.path}
            label={label}
            hint={hint}
            error={error}
            announceError={submitCount > 0}
          >
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
            hint={
              field.kind === "list" ? (
                <>
                  {hint}
                  <span className="block">{t("admin.settings.listHint")}</span>
                </>
              ) : (
                hint
              )
            }
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
      default: {
        const unit = field.kind === "number" ? unitLabel(field) : "";
        return (
          <Field
            key={field.path}
            label={label}
            hint={hint}
            error={error}
            announceError={submitCount > 0}
          >
            {(control) => (
              <Input
                {...control}
                name={field.path}
                type={field.kind === "number" ? "number" : "text"}
                inputMode={field.kind === "number" ? "decimal" : undefined}
                step={field.kind === "number" ? "any" : undefined}
                ltr={LTR_FIELDS.has(field.name)}
                autoComplete="off"
                value={String(draft[field.path] ?? "")}
                disabled={!canWrite}
                endAction={
                  unit ? (
                    <span
                      aria-hidden
                      className="flex min-w-11 items-center justify-center whitespace-nowrap px-3 text-sm text-text-muted"
                    >
                      {unit}
                    </span>
                  ) : undefined
                }
                className={cn(unit && "pe-24")}
                onChange={(event) => {
                  set(field.path, event.target.value);
                }}
              />
            )}
          </Field>
        );
      }
    }
  };

  const renderField = (field: SettingField): ReactNode => {
    if (field.kind !== "group") return renderLeaf(field);
    const help = fieldHelp(field);
    return (
      <fieldset
        key={field.path}
        className="flex flex-col gap-4 rounded-md border border-border p-4"
      >
        <legend className="px-2 text-base font-semibold text-text">{fieldLabel(field)}</legend>
        {help ? <p className="-mt-2 text-sm text-text-muted">{help}</p> : null}
        <div className="grid gap-4 md:grid-cols-2">{field.fields.map(renderField)}</div>
      </fieldset>
    );
  };

  const byName = new Map(fields.map((field) => [field.name, field]));
  const layout = SETTING_LAYOUTS[settingKey];
  const placed = new Set(layout?.flatMap((section) => section.paths) ?? []);
  const rest = fields.filter((field) => !placed.has(field.name));

  const renderSection = (section: SettingSection) => {
    const inSection = section.paths.flatMap((path) => {
      const field = byName.get(path);
      return field ? [field] : [];
    });
    if (inSection.length === 0) return null;
    // A section made of one group shows the group's fields directly, under the section title.
    const only = inSection.length === 1 ? inSection[0] : undefined;
    const body = only?.kind === "group" ? only.fields : inSection;
    const groupHelp = only?.kind === "group" ? fieldHelp(only) : "";
    return (
      <section
        key={section.id}
        id={`${settingKey}-${section.id}`}
        aria-labelledby={`${settingKey}-${section.id}-title`}
        className="flex scroll-mt-24 flex-col gap-4 rounded-lg border border-border bg-surface p-4 md:p-5"
      >
        <div className="flex flex-col gap-1">
          <h3 id={`${settingKey}-${section.id}-title`} className="text-lg font-semibold text-text">
            {t(section.title)}
          </h3>
          <p className="text-sm text-text-muted">{t(section.description)}</p>
          {groupHelp ? <p className="text-sm text-text-muted">{groupHelp}</p> : null}
        </div>
        <div className="grid gap-4 md:grid-cols-2">{body.map(renderField)}</div>
      </section>
    );
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label={tOr(`admin.settings.${settingKey}.title`, settingKey)}
      className="flex flex-col gap-4"
    >
      {layout ? (
        <>
          {layout.map(renderSection)}
          {rest.length > 0
            ? renderSection({
                id: "more",
                title: "admin.settings.section.more",
                description: "admin.settings.section.more.description",
                paths: rest.map((field) => field.name),
              })
            : null}
        </>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">{fields.map(renderField)}</div>
      )}
      {formError ? <ErrorNotice error={formError} /> : null}
      {canWrite ? (
        <div
          className={cn(
            "flex flex-wrap items-center justify-end gap-3",
            dirty &&
              "sticky bottom-0 z-10 -mx-1 rounded-lg border border-border bg-surface p-3 shadow-raised",
          )}
        >
          {dirty ? (
            <>
              <p role="status" className="me-auto text-sm text-text-muted">
                {t("admin.settings.unsaved")}
              </p>
              <Button
                type="button"
                variant="ghost"
                name="discard"
                onClick={() => {
                  setDraft(initial);
                  setErrors({});
                  setFormError(null);
                }}
              >
                {t("admin.settings.discard")}
              </Button>
            </>
          ) : null}
          <Button type="submit" name="save" loading={submitting}>
            {t("common.save")}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
