"use client";

import { DRUG_STATUSES } from "@wasfa/shared/ai";
import { t } from "@wasfa/shared/i18n";
import {
  addAliasSchema,
  drugViewSchema,
  updateDrugSchema,
  type DrugView,
} from "@wasfa/shared/schemas/admin-drugs";
import { Badge, Button, Field, Input, Select, Skeleton, useToast } from "@wasfa/ui";
import { GitMerge, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";

import { formatDateTime } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { describeIssue } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import { Code } from "./badges";
import { DetailList, DetailSection } from "./detail-list";
import { DetailDrawer } from "./drawer";
import { DrugMergeDialog } from "./drug-merge-dialog";

import type { ApiRequestError } from "../../lib/api-error";

type EditField = "brandEn" | "brandAr" | "form" | "strengthText" | "manufacturer" | "country";

export interface DrugDrawerProps {
  drugId: string;
  canWrite: boolean;
  onClose: () => void;
  /** An edit or alias changed the drug: the list refreshes. */
  onChanged: () => void;
  /** The drug was merged away or deleted: the drawer closes and the list refreshes. */
  onMerged: () => void;
}

/** Edit form: only the fields that changed are sent, and an emptied optional field is cleared. */
function EditForm({ drug, onSaved }: { drug: DrugView; onSaved: () => void }) {
  const reauth = useReauth();
  const { toast } = useToast();
  const [values, setValues] = useState({
    brandEn: drug.brandEn,
    brandAr: drug.brandAr ?? "",
    form: drug.form ?? "",
    strengthText: drug.strengthText ?? "",
    manufacturer: drug.manufacturer ?? "",
    country: drug.country ?? "",
    status: drug.status,
  });
  const [errors, setErrors] = useState<Partial<Record<EditField, string>>>({});
  const [formError, setFormError] = useState<ApiRequestError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (name: keyof typeof values, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const optional = (value: string) => (value.trim() === "" ? null : value.trim());
    const next = {
      brandEn: values.brandEn.trim(),
      brandAr: optional(values.brandAr),
      form: optional(values.form),
      strengthText: optional(values.strengthText),
      manufacturer: optional(values.manufacturer),
      country: optional(values.country),
      status: values.status,
    };
    const patch: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(next)) {
      if (value !== drug[name as keyof DrugView]) patch[name] = value;
    }
    if (Object.keys(patch).length === 0) return;

    const parsed = updateDrugSchema.safeParse(patch);
    if (!parsed.success) {
      const found: Partial<Record<EditField, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === "string" && field in values && field !== "status") {
          found[field as EditField] ??= describeIssue(issue, values[field as keyof typeof values]);
        }
      }
      setErrors(found);
      return;
    }
    setErrors({});
    setFormError(null);
    setSubmitting(true);
    reauth
      .run(() =>
        api(`/admin/drugs/${drug.id}`, {
          method: "PATCH",
          body: parsed.data,
          schema: drugViewSchema,
        }),
      )
      .then(
        (saved) => {
          setSubmitting(false);
          toast({ tone: "success", title: t("admin.drugs.edit.saved", { name: saved.brandEn }) });
          onSaved();
        },
        (failure: unknown) => {
          setSubmitting(false);
          setFormError(failure as ApiRequestError);
        },
      );
  };

  const text = (name: EditField, label: string, extra: { hint?: string; ltr?: boolean } = {}) => (
    <Field label={label} hint={extra.hint} error={errors[name]} announceError>
      {(control) => (
        <Input
          {...control}
          name={name}
          value={values[name]}
          ltr={extra.ltr ?? false}
          onChange={(event) => {
            set(name, event.target.value);
          }}
        />
      )}
    </Field>
  );

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {text("brandEn", t("admin.drugs.field.brandEn"), { ltr: true })}
      {text("brandAr", t("admin.drugs.field.brandAr"))}
      {text("form", t("admin.drugs.field.form"))}
      {text("strengthText", t("admin.drugs.field.strengthText"), {
        hint: t("admin.drugs.field.strengthTextHint"),
        ltr: true,
      })}
      {text("manufacturer", t("admin.drugs.field.manufacturer"))}
      {text("country", t("admin.drugs.field.country"), {
        hint: t("admin.drugs.field.countryHint"),
        ltr: true,
      })}
      <Field label={t("admin.drugs.field.status")}>
        {(control) => (
          <Select
            {...control}
            value={values.status}
            onChange={(event) => {
              set("status", event.target.value);
            }}
          >
            {DRUG_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`admin.drugs.status.${status}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {formError ? <ErrorNotice error={formError} /> : null}
      <div>
        <Button type="submit" loading={submitting}>
          {t("admin.drugs.edit.save")}
        </Button>
      </div>
    </form>
  );
}

function AliasForm({ drug, onAdded }: { drug: DrugView; onAdded: () => void }) {
  const reauth = useReauth();
  const { toast } = useToast();
  const [alias, setAlias] = useState("");
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const parsed = addAliasSchema.safeParse({ alias });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setFieldError(issue ? describeIssue(issue, alias) : t("form.invalid"));
      return;
    }
    setFieldError(undefined);
    setError(null);
    setSubmitting(true);
    reauth
      .run(() =>
        api(`/admin/drugs/${drug.id}/aliases`, {
          method: "POST",
          body: parsed.data,
          schema: drugViewSchema,
        }),
      )
      .then(
        () => {
          setSubmitting(false);
          setAlias("");
          toast({ tone: "success", title: t("admin.drugs.aliases.added") });
          onAdded();
        },
        (failure: unknown) => {
          setSubmitting(false);
          setError(failure as ApiRequestError);
        },
      );
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <Field
        label={t("admin.drugs.aliases.label")}
        hint={t("admin.drugs.aliases.hint")}
        error={fieldError}
        announceError
      >
        {(control) => (
          <Input
            {...control}
            name="alias"
            value={alias}
            onChange={(event) => {
              setAlias(event.target.value);
            }}
          />
        )}
      </Field>
      {error ? <ErrorNotice error={error} /> : null}
      <div>
        <Button type="submit" variant="secondary" loading={submitting}>
          <Plus aria-hidden className="size-5" />
          {t("admin.drugs.aliases.add")}
        </Button>
      </div>
    </form>
  );
}

function DrugDetail({
  drug,
  canWrite,
  onChanged,
  onMerged,
  reload,
}: {
  drug: DrugView;
  canWrite: boolean;
  onChanged: () => void;
  onMerged: () => void;
  reload: () => void;
}) {
  const [merging, setMerging] = useState(false);
  const refresh = () => {
    reload();
    onChanged();
  };

  return (
    <div className="flex flex-col gap-6 p-5">
      <DetailSection title={t("admin.drugs.drawer.details")}>
        {canWrite ? (
          // Remounted after each save so the inputs start from what the server now holds.
          <EditForm key={drug.updatedAt} drug={drug} onSaved={refresh} />
        ) : (
          <DetailList
            items={[
              { label: t("admin.drugs.field.brandEn"), value: <bdi dir="ltr">{drug.brandEn}</bdi> },
              { label: t("admin.drugs.field.brandAr"), value: drug.brandAr },
              { label: t("admin.drugs.field.form"), value: drug.form },
              {
                label: t("admin.drugs.field.strengthText"),
                value: drug.strengthText ? <bdi dir="ltr">{drug.strengthText}</bdi> : null,
              },
              { label: t("admin.drugs.field.manufacturer"), value: drug.manufacturer },
              { label: t("admin.drugs.field.country"), value: drug.country },
              {
                label: t("admin.drugs.field.status"),
                value: t(`admin.drugs.status.${drug.status}`),
              },
            ]}
          />
        )}
        <DetailList
          items={[
            {
              label: t("admin.drugs.drawer.batch"),
              value: drug.importBatchId ? <Code>{drug.importBatchId}</Code> : null,
            },
            { label: t("admin.users.col.created"), value: formatDateTime(drug.createdAt) },
          ]}
        />
      </DetailSection>

      <DetailSection title={t("admin.drugs.drawer.ingredients")}>
        {drug.ingredients.length === 0 ? (
          <p className="text-sm text-text-muted">{t("admin.drugs.drawer.noIngredients")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {drug.ingredients.map((ingredient) => (
              <li key={ingredient.id} className="flex flex-wrap items-baseline gap-2">
                <bdi dir="ltr" className="font-semibold">
                  {ingredient.nameEn}
                </bdi>
                {ingredient.strengthText ? (
                  <bdi dir="ltr" className="text-sm text-text-muted">
                    {ingredient.strengthText}
                  </bdi>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </DetailSection>

      <DetailSection title={t("admin.drugs.aliases.title")}>
        {drug.aliases.length === 0 ? (
          <p className="text-sm text-text-muted">{t("admin.drugs.aliases.none")}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {drug.aliases.map((alias) => (
              <li key={alias.id}>
                <Badge
                  tone="info"
                  title={
                    alias.source
                      ? t("admin.drugs.aliases.source", { source: alias.source })
                      : undefined
                  }
                >
                  {alias.alias}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        {canWrite ? <AliasForm drug={drug} onAdded={refresh} /> : null}
      </DetailSection>

      {canWrite ? (
        <div className="border-t border-border pt-5">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setMerging(true);
            }}
          >
            <GitMerge aria-hidden className="size-5" />
            {t("admin.drugs.merge.button")}
          </Button>
          <DrugMergeDialog
            open={merging}
            onOpenChange={setMerging}
            keep={drug}
            onMerged={onMerged}
          />
        </div>
      ) : null}
    </div>
  );
}

export function DrugDrawer({ drugId, canWrite, onClose, onChanged, onMerged }: DrugDrawerProps) {
  const detail = useResource(`/admin/drugs/${drugId}`, drugViewSchema);
  const title = detail.status === "ready" ? detail.data.brandEn : t("admin.drugs.title");

  return (
    <DetailDrawer open onClose={onClose} title={<bdi dir="ltr">{title}</bdi>}>
      {detail.status === "loading" ? (
        <div className="flex flex-col gap-3 p-5">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-2/3" />
        </div>
      ) : null}
      {detail.status === "error" ? (
        <div className="p-5">
          <ErrorNotice error={detail.error} onRetry={detail.reload} />
        </div>
      ) : null}
      {detail.status === "ready" ? (
        <DrugDetail
          drug={detail.data}
          canWrite={canWrite}
          onChanged={onChanged}
          onMerged={onMerged}
          reload={detail.reload}
        />
      ) : null}
    </DetailDrawer>
  );
}
