"use client";

import { DRUG_STATUSES } from "@wasfa/shared/ai";
import { t } from "@wasfa/shared/i18n";
import {
  deleteDrugResponseSchema,
  drugCategoriesResponseSchema,
  drugSearchResponseSchema,
  drugViewSchema,
  DRUG_MISSING_FIELDS,
  type DrugSearchItem,
} from "@wasfa/shared/schemas/admin-drugs";
import { Badge, Button, buttonStyles, useToast } from "@wasfa/ui";
import { Ban, PackageOpen, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { z } from "zod";

import { api } from "../../lib/api-client";
import { MATCH_TONES, formatMinor, scorePercent } from "../../lib/drug-admin";
import { buildQuery, useCursorList, useResource } from "../../lib/use-admin-data";
import { useUrlParams } from "../../lib/use-url-params";

import { ConfirmDialog } from "./confirm-dialog";
import { DataTable, type DataTableColumn } from "./data-table";
import { DrugCreateDrawer, DrugDrawer } from "./drug-drawer";
import { FilterBar, useFiltersActive, type FilterField } from "./filter-bar";

const idSchema = z.uuid();

const FILTER_NAMES = ["q", "strength", "form", "category", "missing", "status", "edited"] as const;

export function DrugStatusBadge({ status }: { status: "active" | "withdrawn" }) {
  return (
    <Badge tone={status === "active" ? "success" : "warning"}>
      {t(`admin.drugs.status.${status}`)}
    </Badge>
  );
}

/**
 * The drug browser (docs/MEDICATIONS.md section 7): the same matcher the prescription pipeline uses,
 * with category / audit / status filters, "load more" paging, and create, edit, withdraw, delete and merge.
 */
export function DrugsView({ canWrite }: { canWrite: boolean }) {
  const url = useUrlParams();
  const { toast } = useToast();
  const [deleting, setDeleting] = useState<DrugSearchItem | null>(null);
  const categories = useResource("/admin/drugs/categories", drugCategoriesResponseSchema);
  const categoryOptions = useMemo(
    () =>
      categories.status === "ready"
        ? categories.data.items.map((item) => ({
            value: item.category,
            label: `${item.category} (${String(item.count)})`,
          }))
        : [],
    [categories],
  );
  const fields = useMemo<FilterField[]>(
    () => [
      {
        kind: "search",
        name: "q",
        label: t("admin.drugs.filter.q"),
        placeholder: t("admin.drugs.filter.qHint"),
      },
      {
        kind: "text",
        name: "strength",
        label: t("admin.drugs.filter.strength"),
        placeholder: t("admin.drugs.filter.strengthHint"),
        ltr: true,
      },
      {
        kind: "text",
        name: "form",
        label: t("admin.drugs.filter.form"),
        placeholder: t("admin.drugs.filter.formHint"),
      },
      {
        kind: "select",
        name: "category",
        label: t("admin.drugs.filter.category"),
        allLabel: t("admin.drugs.filter.all"),
        options: categoryOptions,
      },
      {
        kind: "select",
        name: "missing",
        label: t("admin.drugs.filter.missing"),
        allLabel: t("admin.drugs.filter.all"),
        options: DRUG_MISSING_FIELDS.map((value) => ({
          value,
          label: t(`admin.drugs.filter.missing.${value}`),
        })),
      },
      {
        kind: "select",
        name: "status",
        label: t("admin.drugs.filter.status"),
        allLabel: t("admin.drugs.filter.all"),
        options: DRUG_STATUSES.map((value) => ({
          value,
          label: t(`admin.drugs.status.${value}`),
        })),
      },
      {
        kind: "select",
        name: "edited",
        label: t("admin.drugs.filter.edited"),
        allLabel: t("admin.drugs.filter.all"),
        options: [
          { value: "true", label: t("admin.drugs.filter.edited.true") },
          { value: "false", label: t("admin.drugs.filter.edited.false") },
        ],
      },
    ],
    [categoryOptions],
  );
  const filtersActive = useFiltersActive(fields);
  const query = buildQuery(Object.fromEntries(FILTER_NAMES.map((name) => [name, url.get(name)])));
  const list = useCursorList<DrugSearchItem>("/admin/drugs", query, drugSearchResponseSchema);
  const searching = url.get("q") !== "";
  const selected = idSchema.safeParse(url.get("drug"));
  const creating = url.get("drug") === "new";

  const setStatus = async (drug: DrugSearchItem) => {
    const status = drug.status === "active" ? "withdrawn" : "active";
    try {
      await api(`/admin/drugs/${drug.id}/status`, {
        method: "POST",
        body: { status },
        schema: drugViewSchema,
      });
      toast({
        tone: "success",
        title: t(status === "withdrawn" ? "admin.drugs.withdrawn" : "admin.drugs.restored", {
          name: drug.brandEn,
        }),
      });
      list.reload();
    } catch {
      toast({ tone: "error", title: t("admin.drugs.statusFailed") });
    }
  };

  const remove = async (): Promise<void> => {
    if (deleting === null) return;
    await api(`/admin/drugs/${deleting.id}`, {
      method: "DELETE",
      schema: deleteDrugResponseSchema,
    });
    toast({ tone: "success", title: t("admin.drugs.deleted", { name: deleting.brandEn }) });
    list.reload();
  };

  const columns: DataTableColumn<DrugSearchItem>[] = [
    {
      id: "name",
      header: t("admin.drugs.col.name"),
      primary: true,
      cell: (drug) => (
        <span className="flex flex-col items-start gap-0.5">
          <bdi dir="ltr">{drug.brandEn}</bdi>
          {drug.brandAr ? (
            <span className="text-sm font-normal text-text-muted">{drug.brandAr}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: "ingredients",
      header: t("admin.drugs.col.ingredients"),
      cell: (drug) =>
        drug.ingredients.length === 0 ? (
          "—"
        ) : (
          <bdi dir="ltr">{drug.ingredients.map((ingredient) => ingredient.nameEn).join(" + ")}</bdi>
        ),
    },
    {
      id: "strength",
      header: t("admin.drugs.col.strength"),
      cell: (drug) => (drug.strengthText ? <bdi dir="ltr">{drug.strengthText}</bdi> : "—"),
    },
    {
      id: "form",
      header: t("admin.drugs.col.form"),
      cell: (drug) => drug.form ?? "—",
    },
    {
      id: "pack",
      header: t("admin.drugs.col.pack"),
      cell: (drug) => drug.packText ?? "—",
    },
    {
      id: "price",
      header: t("admin.drugs.col.price"),
      cell: (drug) =>
        drug.priceMinor === null ? (
          "—"
        ) : (
          <bdi dir="ltr" className="tabular-nums">
            {formatMinor(drug.priceMinor, drug.currency)}
          </bdi>
        ),
    },
    {
      id: "category",
      header: t("admin.drugs.col.category"),
      cell: (drug) => drug.category ?? "—",
    },
    ...(searching
      ? [
          {
            id: "match",
            header: t("admin.drugs.col.match"),
            cell: (drug: DrugSearchItem) =>
              drug.match === null ? (
                "—"
              ) : (
                <span className="flex flex-col items-start gap-1">
                  <Badge tone={MATCH_TONES[drug.match.class]}>
                    {t(`admin.drugs.match.${drug.match.class}`)}{" "}
                    <bdi dir="ltr">
                      {t("admin.drugs.match.score", { score: scorePercent(drug.match.score) })}
                    </bdi>
                  </Badge>
                  <span className="text-sm font-normal text-text-muted">
                    {t(`admin.drugs.matchedOn.${drug.match.explanation.matchedOn}`)} ·{" "}
                    {t(`admin.drugs.strengthState.${drug.match.explanation.strength}`)}
                  </span>
                </span>
              ),
          },
        ]
      : []),
    {
      id: "status",
      header: t("admin.drugs.col.status"),
      cell: (drug) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <DrugStatusBadge status={drug.status} />
          {drug.adminEditedAt !== null ? (
            <Badge tone="info">{t("admin.drugs.edited")}</Badge>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {searching ? null : (
          <p className="text-base text-text-muted">{t("admin.drugs.recentHint")}</p>
        )}
        <div className="ms-auto flex flex-wrap gap-3">
          <Link href="/admin/drugs/imports" className={buttonStyles({ variant: "secondary" })}>
            <PackageOpen aria-hidden className="size-5" />
            {t("admin.drugs.import")}
          </Link>
          {canWrite ? (
            <Button
              type="button"
              name="new-drug"
              onClick={() => {
                url.update({ drug: "new" });
              }}
            >
              <Plus aria-hidden className="size-5" />
              {t("admin.drugs.create.button")}
            </Button>
          ) : null}
        </div>
      </div>
      <FilterBar fields={fields} />
      <DataTable
        caption={t("admin.drugs.title")}
        columns={columns}
        rows={list.items}
        rowKey={(drug) => drug.id}
        status={list.status}
        error={list.error}
        onRetry={list.reload}
        onOpenRow={(drug) => {
          url.update({ drug: drug.id });
        }}
        openLabel={(drug) => t("admin.drugs.open", { name: drug.brandEn })}
        rowActions={(drug) => [
          {
            id: "edit",
            label: t("admin.drugs.action.edit"),
            icon: Pencil,
            onSelect: () => {
              url.update({ drug: drug.id });
            },
          },
          ...(canWrite
            ? [
                {
                  id: "status",
                  label: t(
                    drug.status === "active"
                      ? "admin.drugs.action.withdraw"
                      : "admin.drugs.action.restore",
                  ),
                  icon: drug.status === "active" ? Ban : RotateCcw,
                  onSelect: () => {
                    void setStatus(drug);
                  },
                },
                {
                  id: "delete",
                  label: t("admin.drugs.action.delete"),
                  icon: Trash2,
                  tone: "danger" as const,
                  onSelect: () => {
                    setDeleting(drug);
                  },
                },
              ]
            : []),
        ]}
        actionsLabel={(drug) => t("admin.table.actionsFor", { name: drug.brandEn })}
        nextCursor={list.nextCursor}
        loadingMore={list.loadingMore}
        loadMoreError={list.loadMoreError}
        onLoadMore={list.loadMore}
        filtersActive={filtersActive}
        onClearFilters={() => {
          url.update(Object.fromEntries(FILTER_NAMES.map((name) => [name, null])));
        }}
        emptyTitle={t("admin.drugs.empty")}
      />
      {selected.success ? (
        <DrugDrawer
          drugId={selected.data}
          canWrite={canWrite}
          onClose={() => {
            url.update({ drug: null });
          }}
          onChanged={list.reload}
          onMerged={() => {
            url.update({ drug: null });
            list.reload();
          }}
        />
      ) : null}
      {creating && canWrite ? (
        <DrugCreateDrawer
          onClose={() => {
            url.update({ drug: null });
          }}
          onCreated={(created) => {
            list.reload();
            url.update({ drug: created.id });
          }}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={t("admin.drugs.delete.title", { name: deleting?.brandEn ?? "" })}
        description={t("admin.drugs.delete.body")}
        confirmLabel={t("admin.drugs.delete.confirm")}
        tone="danger"
        onConfirm={remove}
      />
    </div>
  );
}
