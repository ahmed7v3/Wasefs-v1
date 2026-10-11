"use client";

import { t } from "@wasfa/shared/i18n";
import { adminFlagSchema, type AdminFlag } from "@wasfa/shared/schemas/admin";
import {
  FLAG_RULE_TYPES,
  flagKeySchema,
  flagRulesSchema,
  upsertFlagSchema,
  type FlagRuleType,
} from "@wasfa/shared/settings";
import { Button, Checkbox, Dialog, Field, Input, Select, Textarea, useToast } from "@wasfa/ui";
import { useState } from "react";

import { api } from "../../lib/api-client";
import { fieldPaths, type ApiRequestError } from "../../lib/api-error";
import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { ErrorNotice } from "../error-notice";

import type { FormEvent } from "react";

export interface FlagDialogProps {
  open: boolean;
  /** `null` creates a flag; a flag opens it for editing (its key is fixed). */
  flag: AdminFlag | null;
  onClose: () => void;
  onSaved: () => void;
}

function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** The `rules` object of the form's current rule type (the shared schema judges it). */
export function buildRules(
  type: FlagRuleType,
  fields: { ids: string; percentage: string; plans: string },
): unknown {
  switch (type) {
    case "all":
      return { type };
    case "user":
      return { type, userIds: lines(fields.ids) };
    case "org":
      return { type, orgIds: lines(fields.ids) };
    case "percentage":
      return {
        type,
        percentage: fields.percentage.trim() === "" ? undefined : Number(fields.percentage),
      };
    case "plan":
      return { type, plans: lines(fields.plans) };
  }
}

function FlagForm({ flag, onClose, onSaved }: Omit<FlagDialogProps, "open">) {
  const reauth = useReauth();
  const { toast } = useToast();
  const creating = flag === null;
  const initial = flag ? flagRulesSchema.safeParse(flag.rules) : null;
  const rules = initial?.success ? initial.data : { type: "all" as const };

  const [key, setKey] = useState(flag?.key ?? "");
  const [enabled, setEnabled] = useState(flag?.enabled ?? true);
  const [type, setType] = useState<FlagRuleType>(rules.type);
  const [ids, setIds] = useState(
    rules.type === "user"
      ? rules.userIds.join("\n")
      : rules.type === "org"
        ? rules.orgIds.join("\n")
        : "",
  );
  const [percentage, setPercentage] = useState(
    rules.type === "percentage" ? String(rules.percentage) : "",
  );
  const [plans, setPlans] = useState(rules.type === "plan" ? rules.plans.join("\n") : "");
  const [errors, setErrors] = useState<{ key?: string; rules?: string }>({});
  const [formError, setFormError] = useState<ApiRequestError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitCount, setSubmitCount] = useState(0);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const body = { enabled, rules: buildRules(type, { ids, percentage, plans }) };
    const next: { key?: string; rules?: string } = {};
    if (creating && !flagKeySchema.safeParse(key).success) next.key = t("admin.flags.keyInvalid");
    const parsed = upsertFlagSchema.safeParse(body);
    if (!parsed.success) next.rules = t(`admin.flags.rulesInvalid.${type}`);
    if (next.key || next.rules) {
      setErrors(next);
      setFormError(null);
      setSubmitCount((count) => count + 1);
      return;
    }
    setSubmitting(true);
    setErrors({});
    setFormError(null);
    reauth
      .run(() =>
        api(`/admin/flags/${encodeURIComponent(key)}`, {
          method: "PUT",
          body,
          schema: adminFlagSchema,
        }),
      )
      .then(
        () => {
          toast({ tone: "success", title: t("admin.flags.saved", { key }) });
          onSaved();
          onClose();
        },
        (error: unknown) => {
          setSubmitting(false);
          const paths = fieldPaths(error);
          if (paths.length > 0) {
            setErrors({
              ...(paths.includes("key") ? { key: t("admin.flags.keyInvalid") } : {}),
              ...(paths.some((path) => path.startsWith("rules") || path === "enabled")
                ? { rules: t(`admin.flags.rulesInvalid.${type}`) }
                : {}),
            });
            setSubmitCount((count) => count + 1);
          } else {
            setFormError(toApiError(error));
          }
        },
      );
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <Field
        label={t("admin.flags.field.key")}
        hint={creating ? t("admin.flags.field.keyHint") : undefined}
        required
        error={errors.key}
        announceError={submitCount > 0}
      >
        {(control) => (
          <Input
            {...control}
            name="key"
            ltr
            autoComplete="off"
            value={key}
            disabled={!creating}
            onChange={(event) => {
              setKey(event.target.value.trim());
            }}
          />
        )}
      </Field>
      <Checkbox
        name="enabled"
        label={t("admin.flags.field.enabled")}
        checked={enabled}
        onChange={(event) => {
          setEnabled(event.target.checked);
        }}
      />
      <Field label={t("admin.flags.field.ruleType")}>
        {(control) => (
          <Select
            {...control}
            name="ruleType"
            value={type}
            onChange={(event) => {
              setType(event.target.value as FlagRuleType);
              setErrors({});
            }}
          >
            {FLAG_RULE_TYPES.map((option) => (
              <option key={option} value={option}>
                {t(`admin.flags.ruleType.${option}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {type === "user" || type === "org" ? (
        <Field
          label={t(type === "user" ? "admin.flags.field.userIds" : "admin.flags.field.orgIds")}
          hint={t("admin.settings.listHint")}
          error={errors.rules}
          announceError={submitCount > 0}
        >
          {(control) => (
            <Textarea
              {...control}
              name="ids"
              ltr
              value={ids}
              onChange={(event) => {
                setIds(event.target.value);
              }}
            />
          )}
        </Field>
      ) : null}
      {type === "percentage" ? (
        <Field
          label={t("admin.flags.field.percentage")}
          error={errors.rules}
          announceError={submitCount > 0}
        >
          {(control) => (
            <Input
              {...control}
              name="percentage"
              type="number"
              inputMode="numeric"
              ltr
              min={0}
              max={100}
              value={percentage}
              onChange={(event) => {
                setPercentage(event.target.value);
              }}
            />
          )}
        </Field>
      ) : null}
      {type === "plan" ? (
        <Field
          label={t("admin.flags.field.plans")}
          hint={t("admin.settings.listHint")}
          error={errors.rules}
          announceError={submitCount > 0}
        >
          {(control) => (
            <Textarea
              {...control}
              name="plans"
              ltr
              value={plans}
              onChange={(event) => {
                setPlans(event.target.value);
              }}
            />
          )}
        </Field>
      ) : null}

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

/** Create or edit one feature flag: key, on/off and who it applies to. */
export function FlagDialog({ open, flag, onClose, onSaved }: FlagDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={flag ? t("admin.flags.editTitle", { key: flag.key }) : t("admin.flags.newTitle")}
    >
      {/* Mounted only while open: every opening starts from the flag as it is now. */}
      {open ? <FlagForm flag={flag} onClose={onClose} onSaved={onSaved} /> : null}
    </Dialog>
  );
}
