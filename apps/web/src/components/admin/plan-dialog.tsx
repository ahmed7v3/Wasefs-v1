"use client";

import { t } from "@wasfa/shared/i18n";
import { PLAN_AUDIENCES, PLAN_VISIBILITIES } from "@wasfa/shared/plans";
import {
  createPlanSchema,
  planViewSchema,
  PLAN_MONTHLY_CREDITS_MAX,
  updatePlanSchema,
  type PlanView,
} from "@wasfa/shared/schemas/plans";
import { Button, Dialog, Field, Input, Select, useToast } from "@wasfa/ui";
import { useState } from "react";

import { api } from "../../lib/api-client";
import { errorReason, type ApiRequestError } from "../../lib/api-error";
import { serverFieldErrors, toApiError, validateValues } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { ErrorNotice } from "../error-notice";

import type { FormEvent } from "react";

const audienceKey = {
  individual: "admin.plans.audience.individual",
  organization: "admin.plans.audience.organization",
  any: "admin.plans.audience.any",
} as const;

const visibilityKey = {
  public: "admin.plans.visibility.public",
  hidden: "admin.plans.visibility.hidden",
} as const;

export const planAudienceLabel = (audience: keyof typeof audienceKey) => t(audienceKey[audience]);
export const planVisibilityLabel = (visibility: keyof typeof visibilityKey) =>
  t(visibilityKey[visibility]);

export interface PlanDialogProps {
  /** `null` creates a plan; a plan edits it (its key never changes). */
  plan: PlanView | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Ranges the shared schema enforces, worded for a number field (its own messages talk about length). */
const NUMBER_RANGES = {
  monthlyCredits: { min: 0, max: PLAN_MONTHLY_CREDITS_MAX },
  sort: { min: -10_000, max: 10_000 },
} as const;

function PlanForm({ plan, onClose, onSaved }: PlanDialogProps) {
  const reauth = useReauth();
  const { toast } = useToast();
  const creating = plan === null;

  const [key, setKey] = useState("");
  const [nameAr, setNameAr] = useState(plan?.nameAr ?? "");
  const [nameEn, setNameEn] = useState(plan?.nameEn ?? "");
  const [audience, setAudience] = useState<string>(plan?.audience ?? "any");
  const [visibility, setVisibility] = useState<string>(plan?.visibility ?? "public");
  const [monthlyCredits, setMonthlyCredits] = useState(String(plan?.monthlyCredits ?? 0));
  const [sort, setSort] = useState(String(plan?.sort ?? 0));
  const [badgeAr, setBadgeAr] = useState(plan?.badgeAr ?? "");
  const [badgeEn, setBadgeEn] = useState(plan?.badgeEn ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<ApiRequestError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitCount, setSubmitCount] = useState(0);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const fields = {
      nameAr,
      nameEn,
      audience,
      visibility,
      monthlyCredits: Number(monthlyCredits),
      sort: Number(sort),
      badgeAr: badgeAr.trim() === "" ? null : badgeAr,
      badgeEn: badgeEn.trim() === "" ? null : badgeEn,
    };
    const values = creating ? { key, ...fields } : fields;
    const schema = creating ? createPlanSchema : updatePlanSchema;
    const invalid = validateValues(schema, values);
    for (const field of ["monthlyCredits", "sort"] as const) {
      if (invalid[field]) invalid[field] = t("admin.plans.error.number", NUMBER_RANGES[field]);
    }
    if (Object.keys(invalid).length > 0) {
      setErrors(invalid);
      setFormError(null);
      setSubmitCount((count) => count + 1);
      return;
    }
    setSubmitting(true);
    setErrors({});
    setFormError(null);
    const send = () =>
      creating
        ? api("/admin/plans", { method: "POST", body: values, schema: planViewSchema })
        : api(`/admin/plans/${plan.id}`, { method: "PATCH", body: values, schema: planViewSchema });
    reauth.run(send).then(
      () => {
        toast({
          tone: "success",
          title: t(creating ? "admin.plans.created" : "admin.plans.updated", { name: nameAr }),
        });
        onSaved();
        onClose();
      },
      (error: unknown) => {
        setSubmitting(false);
        if (errorReason(error) === "plan_key_exists") {
          setErrors({ key: t("admin.plans.reason.plan_key_exists") });
          setSubmitCount((count) => count + 1);
          return;
        }
        const mapped = serverFieldErrors(error, schema, values, Object.keys(values));
        if (mapped) {
          setErrors(mapped);
          setSubmitCount((count) => count + 1);
        } else {
          setFormError(toApiError(error));
        }
      },
    );
  };

  const announce = submitCount > 0;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {creating ? (
        <Field
          label={t("admin.plans.field.key")}
          hint={t("admin.plans.field.keyHint")}
          required
          error={errors["key"]}
          announceError={announce}
        >
          {(control) => (
            <Input
              {...control}
              name="key"
              ltr
              autoComplete="off"
              value={key}
              onChange={(event) => {
                setKey(event.target.value.trim());
              }}
            />
          )}
        </Field>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t("admin.plans.field.nameAr")}
          required
          error={errors["nameAr"]}
          announceError={announce}
        >
          {(control) => (
            <Input
              {...control}
              name="nameAr"
              value={nameAr}
              onChange={(event) => {
                setNameAr(event.target.value);
              }}
            />
          )}
        </Field>
        <Field
          label={t("admin.plans.field.nameEn")}
          required
          error={errors["nameEn"]}
          announceError={announce}
        >
          {(control) => (
            <Input
              {...control}
              name="nameEn"
              ltr
              value={nameEn}
              onChange={(event) => {
                setNameEn(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={t("admin.plans.field.audience")} error={errors["audience"]}>
          {(control) => (
            <Select
              {...control}
              name="audience"
              value={audience}
              onChange={(event) => {
                setAudience(event.target.value);
              }}
            >
              {PLAN_AUDIENCES.map((value) => (
                <option key={value} value={value}>
                  {planAudienceLabel(value)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("admin.plans.field.visibility")} error={errors["visibility"]}>
          {(control) => (
            <Select
              {...control}
              name="visibility"
              value={visibility}
              onChange={(event) => {
                setVisibility(event.target.value);
              }}
            >
              {PLAN_VISIBILITIES.map((value) => (
                <option key={value} value={value}>
                  {planVisibilityLabel(value)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={t("admin.plans.field.monthlyCredits")}
          error={errors["monthlyCredits"]}
          announceError={announce}
        >
          {(control) => (
            <Input
              {...control}
              name="monthlyCredits"
              type="number"
              inputMode="numeric"
              ltr
              value={monthlyCredits}
              onChange={(event) => {
                setMonthlyCredits(event.target.value);
              }}
            />
          )}
        </Field>
        <Field
          label={t("admin.plans.field.sort")}
          hint={t("admin.plans.field.sortHint")}
          error={errors["sort"]}
          announceError={announce}
        >
          {(control) => (
            <Input
              {...control}
              name="sort"
              type="number"
              inputMode="numeric"
              ltr
              value={sort}
              onChange={(event) => {
                setSort(event.target.value);
              }}
            />
          )}
        </Field>
        <Field
          label={t("admin.plans.field.badgeAr")}
          error={errors["badgeAr"]}
          announceError={announce}
        >
          {(control) => (
            <Input
              {...control}
              name="badgeAr"
              value={badgeAr}
              onChange={(event) => {
                setBadgeAr(event.target.value);
              }}
            />
          )}
        </Field>
        <Field
          label={t("admin.plans.field.badgeEn")}
          error={errors["badgeEn"]}
          announceError={announce}
        >
          {(control) => (
            <Input
              {...control}
              name="badgeEn"
              ltr
              value={badgeEn}
              onChange={(event) => {
                setBadgeEn(event.target.value);
              }}
            />
          )}
        </Field>
      </div>
      {formError ? <ErrorNotice error={formError} /> : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="ghost" name="cancel" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" name="save" loading={submitting}>
          {creating ? t("admin.plans.create") : t("common.save")}
        </Button>
      </div>
    </form>
  );
}

/** Create or edit a plan. Mounted only while open, so every opening starts from the plan as it is. */
export function PlanDialog(props: PlanDialogProps & { open: boolean }) {
  const { open, ...form } = props;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) form.onClose();
      }}
      title={
        form.plan === null
          ? t("admin.plans.newTitle")
          : t("admin.plans.editTitle", { name: form.plan.nameAr })
      }
      className="sm:max-w-2xl"
    >
      {open ? <PlanForm {...form} /> : null}
    </Dialog>
  );
}
