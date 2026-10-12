"use client";

import { t } from "@wasfa/shared/i18n";
import { drugSearchResponseSchema, type DrugSearchItem } from "@wasfa/shared/schemas/admin-drugs";
import { Badge, buttonStyles } from "@wasfa/ui";
import { PackageOpen } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { z } from "zod";

import { MATCH_TONES, scorePercent } from "../../lib/drug-admin";
import { buildQuery, useResource } from "../../lib/use-admin-data";
import { useUrlParams } from "../../lib/use-url-params";

import { DataTable, type DataTableColumn } from "./data-table";
import { DrugDrawer } from "./drug-drawer";
import { FilterBar, useFiltersActive, type FilterField } from "./filter-bar";

const idSchema = z.uuid();

export function DrugStatusBadge({ status }: { status: "active" | "withdrawn" }) {
  return (
    <Badge tone={status === "active" ? "success" : "warning"}>
      {t(`admin.drugs.status.${status}`)}
    </Badge>
  );
}

/** The drug browser (Task 2.7): the same matcher the prescription pipeline uses, with edit, aliases and merge. */
export function DrugsView({ canWrite }: { canWrite: boolean }) {
  const url = useUrlParams();
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
    ],
    [],
  );
  const filtersActive = useFiltersActive(fields);
  const query = buildQuery({
    q: url.get("q"),
    strength: url.get("strength"),
    form: url.get("form"),
  });
  const resource = useResource(
    query === "" ? "/admin/drugs" : `/admin/drugs?${query}`,
    drugSearchResponseSchema,
  );
  const rows = resource.status === "ready" ? resource.data.items : [];
  const searching = url.get("q") !== "";
  const selected = idSchema.safeParse(url.get("drug"));

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
      id: "ingredients",
      header: t("admin.drugs.col.ingredients"),
      cell: (drug) =>
        drug.ingredients.length === 0 ? (
          "—"
        ) : (
          <bdi dir="ltr">{drug.ingredients.map((ingredient) => ingredient.nameEn).join(" + ")}</bdi>
        ),
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
      cell: (drug) => <DrugStatusBadge status={drug.status} />,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {searching ? null : (
          <p className="text-base text-text-muted">{t("admin.drugs.recentHint")}</p>
        )}
        <Link
          href="/admin/drugs/imports"
          className={buttonStyles({ variant: "secondary", className: "ms-auto" })}
        >
          <PackageOpen aria-hidden className="size-5" />
          {t("admin.drugs.import")}
        </Link>
      </div>
      <FilterBar fields={fields} />
      <DataTable
        caption={t("admin.drugs.title")}
        columns={columns}
        rows={rows}
        rowKey={(drug) => drug.id}
        status={resource.status}
        error={resource.status === "error" ? resource.error : undefined}
        onRetry={resource.reload}
        onOpenRow={(drug) => {
          url.update({ drug: drug.id });
        }}
        openLabel={(drug) => t("admin.drugs.open", { name: drug.brandEn })}
        filtersActive={filtersActive}
        onClearFilters={() => {
          url.update({ q: null, strength: null, form: null });
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
          onChanged={resource.reload}
          onMerged={() => {
            url.update({ drug: null });
            resource.reload();
          }}
        />
      ) : null}
    </div>
  );
}
