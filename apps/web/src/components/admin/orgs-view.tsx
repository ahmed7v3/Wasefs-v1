"use client";

import { t } from "@wasfa/shared/i18n";
import {
  adminOrgDetailSchema,
  adminOrgListResponseSchema,
  type AdminOrg,
} from "@wasfa/shared/schemas/admin";
import { joinLinkItemSchema, joinLinkListResponseSchema } from "@wasfa/shared/schemas/org";
import { Button, Field, Input, Skeleton, useToast } from "@wasfa/ui";
import { ArrowUpCircle, Eye } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";

import { formatDateTime, formatNumber, formatShortDate } from "../../lib/admin-format";
import { canAccess } from "../../lib/admin-nav";
import { api } from "../../lib/api-client";
import { label } from "../../lib/labels";
import { buildQuery, useCursorList, useResource } from "../../lib/use-admin-data";
import { useUrlParams } from "../../lib/use-url-params";
import { ErrorNotice } from "../error-notice";

import { DataTable, type DataTableColumn } from "./data-table";
import { DetailList, DetailSection } from "./detail-list";
import { DetailDrawer } from "./drawer";
import { FilterBar, useFiltersActive, type FilterField } from "./filter-bar";
import { PlanChangeDialog } from "./plan-change-dialog";

const idSchema = z.uuid();

/** Join links of the organisation (ADMIN-CONSOLE-SPEC §7): list, create with a slug, disable. */
function JoinLinks({ orgId, canWrite }: { orgId: string; canWrite: boolean }) {
  const { toast } = useToast();
  const links = useResource(`/admin/orgs/${orgId}/join-links`, joinLinkListResponseSchema);
  const [slug, setSlug] = useState("");
  const [failure, setFailure] = useState<unknown>(null);
  const create = async () => {
    setFailure(null);
    try {
      await api(`/admin/orgs/${orgId}/join-links`, {
        method: "POST",
        body: { slug: slug.trim().toLowerCase() },
        schema: joinLinkItemSchema,
      });
      setSlug("");
      toast({ tone: "success", title: t("admin.orgs.links.created") });
      links.reload();
    } catch (error) {
      setFailure(error);
    }
  };
  const disable = async (linkId: string) => {
    setFailure(null);
    try {
      await api(`/admin/orgs/${orgId}/join-links/${linkId}/disable`, { method: "POST", body: {} });
      links.reload();
    } catch (error) {
      setFailure(error);
    }
  };
  return (
    <DetailSection title={t("admin.orgs.links.title")}>
      {links.status === "ready" ? (
        links.data.items.length === 0 ? (
          <p className="text-base text-text-muted">{t("admin.orgs.links.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {links.data.items.map((link) => (
              <li key={link.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-col">
                  <bdi dir="ltr" className="font-semibold">{`/join/${link.slug}`}</bdi>
                  <span className="text-sm text-text-muted">
                    {t("admin.orgs.links.uses", {
                      used: formatNumber(link.usedCount),
                      max: link.maxUses === null ? "∞" : formatNumber(link.maxUses),
                    })}
                    {link.dealId ? ` · ${t("admin.orgs.links.withDeal")}` : ""}
                    {link.active ? "" : ` · ${t("admin.orgs.links.disabled")}`}
                  </span>
                </span>
                {canWrite && link.active ? (
                  <Button variant="ghost" onClick={() => { void disable(link.id); }}>{t("admin.orgs.links.disable")}</Button>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
      {canWrite ? (
        <form noValidate className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void create(); }}>
          <Field label={t("admin.orgs.links.slug")}>
            {(control) => <Input {...control} name="org-link-slug" ltr value={slug} onChange={(event) => { setSlug(event.target.value); }} />}
          </Field>
          <Button type="submit" variant="secondary" disabled={slug.trim().length < 3}>{t("admin.orgs.links.create")}</Button>
        </form>
      ) : null}
      {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}
    </DetailSection>
  );
}

function OrgDrawer({
  orgId,
  onClose,
  permissions,
}: {
  orgId: string;
  onClose: () => void;
  permissions: readonly string[];
}) {
  const detail = useResource(`/admin/orgs/${orgId}`, adminOrgDetailSchema);
  const org = detail.status === "ready" ? detail.data : null;
  const [changing, setChanging] = useState(false);

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
          {canAccess(permissions, "users.upgrade") ? (
            <div className="mb-3">
              <Button name="org-plan-change" onClick={() => { setChanging(true); }}>
                <ArrowUpCircle aria-hidden className="size-4" />
                {t("admin.user360.action.plan")}
              </Button>
            </div>
          ) : null}
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
          <JoinLinks orgId={orgId} canWrite={canAccess(permissions, "orgs.write")} />
          <PlanChangeDialog
            open={changing}
            base={`/admin/orgs/${orgId}`}
            targetName={org.name}
            onClose={() => { setChanging(false); }}
            onChanged={detail.reload}
          />
        </>
      ) : null}
    </DetailDrawer>
  );
}

export function OrgsView({ permissions }: { permissions: readonly string[] }) {
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
          permissions={permissions}
          onClose={() => {
            url.update({ org: null });
          }}
        />
      ) : null}
    </div>
  );
}
