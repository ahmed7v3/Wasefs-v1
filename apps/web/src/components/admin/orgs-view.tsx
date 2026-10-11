"use client";

import { t } from "@wasfa/shared/i18n";
import {
  adminOrgDetailSchema,
  adminOrgListResponseSchema,
  type AdminOrg,
} from "@wasfa/shared/schemas/admin";
import { Skeleton } from "@wasfa/ui";
import { Eye } from "lucide-react";
import { useMemo } from "react";
import { z } from "zod";

import { formatDateTime, formatNumber, formatShortDate } from "../../lib/admin-format";
import { label } from "../../lib/labels";
import { buildQuery, useCursorList, useResource } from "../../lib/use-admin-data";
import { useUrlParams } from "../../lib/use-url-params";
import { ErrorNotice } from "../error-notice";

import { DataTable, type DataTableColumn } from "./data-table";
import { DetailList, DetailSection } from "./detail-list";
import { DetailDrawer } from "./drawer";
import { FilterBar, useFiltersActive, type FilterField } from "./filter-bar";

const idSchema = z.uuid();

function OrgDrawer({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const detail = useResource(`/admin/orgs/${orgId}`, adminOrgDetailSchema);
  const org = detail.status === "ready" ? detail.data : null;

  return (
    <DetailDrawer open onClose={onClose} title={org?.name ?? t("admin.orgs.detail")}>
      {detail.status === "loading" ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <p className="sr-only" role="status">
            {t("ui.loading")}
          </p>
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-5/6" />
        </div>
      ) : null}
      {detail.status === "error" ? (
        <ErrorNotice error={detail.error} onRetry={detail.reload} />
      ) : null}
      {org ? (
        <>
          <DetailList
            items={[
              { label: t("admin.orgs.col.type"), value: label("orgType", org.type) },
              { label: t("admin.orgs.col.country"), value: label("country", org.country) },
              { label: t("admin.orgs.col.city"), value: org.city },
              { label: t("admin.orgs.col.members"), value: formatNumber(org.memberCount) },
              { label: t("admin.orgs.pendingInvites"), value: formatNumber(org.pendingInvites) },
              { label: t("admin.orgs.col.created"), value: formatDateTime(org.createdAt) },
            ]}
          />
          <DetailSection title={t("admin.orgs.members")}>
            {org.members.length === 0 ? (
              <p className="text-base text-text-muted">{t("admin.orgs.noMembers")}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {org.members.map((member) => (
                  <li
                    key={member.userId}
                    className="flex flex-wrap items-center justify-between gap-2 py-3"
                  >
                    <span className="font-semibold">{member.name}</span>
                    <span className="text-sm text-text-muted tabular-nums">
                      {label("orgRole", member.role)} · {formatShortDate(member.joinedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </DetailSection>
        </>
      ) : null}
    </DetailDrawer>
  );
}

export function OrgsView() {
  const url = useUrlParams();
  const fields = useMemo<FilterField[]>(
    () => [{ kind: "search", name: "q", label: t("admin.orgs.filter.q") }],
    [],
  );
  const filtersActive = useFiltersActive(fields);
  const list = useCursorList(
    "/admin/orgs",
    buildQuery({ q: url.get("q") }),
    adminOrgListResponseSchema,
  );
  const selected = idSchema.safeParse(url.get("org"));
  const open = (id: string) => {
    url.update({ org: id });
  };

  const columns: DataTableColumn<AdminOrg>[] = [
    { id: "name", header: t("admin.orgs.col.name"), primary: true, cell: (org) => org.name },
    { id: "type", header: t("admin.orgs.col.type"), cell: (org) => label("orgType", org.type) },
    {
      id: "country",
      header: t("admin.orgs.col.country"),
      cell: (org) => label("country", org.country),
    },
    { id: "city", header: t("admin.orgs.col.city"), cell: (org) => org.city ?? "—" },
    {
      id: "members",
      header: t("admin.orgs.col.members"),
      cell: (org) => formatNumber(org.memberCount),
    },
    {
      id: "created",
      header: t("admin.orgs.col.created"),
      cell: (org) => formatShortDate(org.createdAt),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <FilterBar fields={fields} />
      <DataTable
        caption={t("admin.nav.orgs")}
        columns={columns}
        rows={list.items}
        rowKey={(org) => org.id}
        status={list.status}
        error={list.error}
        onRetry={list.reload}
        onOpenRow={(org) => {
          open(org.id);
        }}
        rowActions={(org) => [
          {
            id: "details",
            label: t("admin.table.details"),
            icon: Eye,
            onSelect: () => {
              open(org.id);
            },
          },
        ]}
        actionsLabel={(org) => t("admin.table.actionsFor", { name: org.name })}
        nextCursor={list.nextCursor}
        loadingMore={list.loadingMore}
        loadMoreError={list.loadMoreError}
        onLoadMore={list.loadMore}
        filtersActive={filtersActive}
        onClearFilters={() => {
          url.update({ q: null });
        }}
        emptyTitle={t("admin.orgs.empty")}
      />
      {selected.success ? (
        <OrgDrawer
          orgId={selected.data}
          onClose={() => {
            url.update({ org: null });
          }}
        />
      ) : null}
    </div>
  );
}
