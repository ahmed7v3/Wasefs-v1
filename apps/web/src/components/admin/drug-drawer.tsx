"use client";

import { t } from "@wasfa/shared/i18n";
import { addAliasSchema, drugViewSchema, type DrugView } from "@wasfa/shared/schemas/admin-drugs";
import { Badge, Button, Field, Input, Skeleton, useToast } from "@wasfa/ui";
import { GitMerge, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";

import { formatDateTime } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { formatMinor } from "../../lib/drug-admin";
import { describeIssue } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import { Code } from "./badges";
import { DetailList, DetailSection } from "./detail-list";
import { DetailDrawer } from "./drawer";
import { DrugForm } from "./drug-form";
import { DrugMergeDialog } from "./drug-merge-dialog";

import type { ApiRequestError } from "../../lib/api-error";

export interface DrugDrawerProps {
  drugId: string;
  canWrite: boolean;
  onClose: () => void;
  /** An edit or alias changed the drug: the list refreshes. */
  onChanged: () => void;
  /** The drug was merged away or deleted: the drawer closes and the list refreshes. */
  onMerged: () => void;
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
          <DrugForm key={drug.updatedAt} drug={drug} onSaved={refresh} />
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
              { label: t("admin.drugs.field.packText"), value: drug.packText },
              { label: t("admin.drugs.field.category"), value: drug.category },
              {
                label: t("admin.drugs.field.price"),
                value:
                  drug.priceMinor === null ? null : (
                    <bdi dir="ltr">{formatMinor(drug.priceMinor, drug.currency)}</bdi>
                  ),
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

export interface DrugCreateDrawerProps {
  /** The brand name the new entry starts with. */
  seedBrand?: string | undefined;
  onClose: () => void;
  onCreated: (drug: DrugView) => void;
}

/** A new entry in the same drawer as the editor; the form starts empty (or with the brand name). */
export function DrugCreateDrawer({ seedBrand, onClose, onCreated }: DrugCreateDrawerProps) {
  return (
    <DetailDrawer open onClose={onClose} title={t("admin.drugs.create.title")}>
      <div className="p-5">
        <DrugForm drug={null} seedBrand={seedBrand} onSaved={onCreated} />
      </div>
    </DetailDrawer>
  );
}
