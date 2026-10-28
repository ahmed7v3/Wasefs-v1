"use client";

import { t } from "@wasfa/shared/i18n";
import {
  learnedListResponseSchema,
  queueActionResponseSchema,
  unmatchedListResponseSchema,
  type LearnedItem,
  type UnmatchedItem,
} from "@wasfa/shared/schemas/admin-drugs";
import { Button, Tab, TabList, TabPanel, Tabs, useToast } from "@wasfa/ui";
import { useState } from "react";

import { formatDateTime, formatNumber } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { useCursorList } from "../../lib/use-admin-data";
import { useUrlParams } from "../../lib/use-url-params";

import { DataTable, type DataTableColumn } from "./data-table";
import { DrugCreateDrawer } from "./drug-drawer";
import { DrugPickerDialog } from "./drug-picker-dialog";

type ReviewTab = "unmatched" | "learned";

const queuePath = (normalized: string, action: "map" | "ignore") =>
  `/admin/drugs/unmatched/${encodeURIComponent(normalized)}/${action}`;

function UnmatchedTab({ canWrite }: { canWrite: boolean }) {
  const { toast } = useToast();
  const list = useCursorList<UnmatchedItem>(
    "/admin/drugs/unmatched",
    "status=open",
    unmatchedListResponseSchema,
  );
  const [mapping, setMapping] = useState<UnmatchedItem | null>(null);
  const [creating, setCreating] = useState<UnmatchedItem | null>(null);

  const mapTo = async (item: UnmatchedItem, drugId: string): Promise<void> => {
    await api(queuePath(item.normalized, "map"), {
      method: "POST",
      body: { drugId },
      schema: queueActionResponseSchema,
    });
    toast({ tone: "success", title: t("admin.drugs.review.mapped", { name: item.sample }) });
    list.reload();
  };

  const ignore = async (item: UnmatchedItem) => {
    try {
      await api(queuePath(item.normalized, "ignore"), {
        method: "POST",
        schema: queueActionResponseSchema,
      });
      toast({ tone: "success", title: t("admin.drugs.review.ignored", { name: item.sample }) });
      list.reload();
    } catch {
      toast({ tone: "error", title: t("admin.drugs.review.failed") });
    }
  };

  const columns: DataTableColumn<UnmatchedItem>[] = [
    {
      id: "sample",
      header: t("admin.drugs.review.col.sample"),
      primary: true,
      cell: (item) => <bdi dir="auto">{item.sample}</bdi>,
    },
    {
      id: "normalized",
      header: t("admin.drugs.review.col.normalized"),
      cell: (item) => (
        <bdi dir="auto" className="text-sm text-text-muted">
          {item.normalized}
        </bdi>
      ),
    },
    {
      id: "hits",
      header: t("admin.drugs.review.col.hits"),
      cell: (item) => <span className="tabular-nums">{formatNumber(item.hits)}</span>,
    },
    {
      id: "lastSeen",
      header: t("admin.drugs.review.col.lastSeen"),
      cell: (item) => formatDateTime(item.lastSeen),
    },
    ...(canWrite
      ? [
          {
            id: "actions",
            header: t("admin.drugs.col.actions"),
            cell: (item: UnmatchedItem) => (
              <span className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  aria-label={t("admin.drugs.review.mapFor", { name: item.sample })}
                  onClick={() => {
                    setMapping(item);
                  }}
                >
                  {t("admin.drugs.review.map")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  aria-label={t("admin.drugs.review.createFor", { name: item.sample })}
                  onClick={() => {
                    setCreating(item);
                  }}
                >
                  {t("admin.drugs.review.create")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={t("admin.drugs.review.ignoreFor", { name: item.sample })}
                  onClick={() => {
                    void ignore(item);
                  }}
                >
                  {t("admin.drugs.review.ignore")}
                </Button>
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-text-muted">{t("admin.drugs.review.unmatched.lead")}</p>
      <DataTable
        caption={t("admin.drugs.review.tab.unmatched")}
        columns={columns}
        rows={list.items}
        rowKey={(item) => item.normalized}
        status={list.status}
        error={list.error}
        onRetry={list.reload}
        nextCursor={list.nextCursor}
        loadingMore={list.loadingMore}
        loadMoreError={list.loadMoreError}
        onLoadMore={list.loadMore}
        emptyTitle={t("admin.drugs.review.unmatched.empty")}
      />
      {mapping ? (
        <DrugPickerDialog
          open
          onOpenChange={(open) => {
            if (!open) setMapping(null);
          }}
          title={t("admin.drugs.review.mapTitle", { name: mapping.sample })}
          description={t("admin.drugs.review.mapBody")}
          initialQuery={mapping.sample}
          confirmLabel={t("admin.drugs.review.mapConfirm")}
          onPick={(drugId) => mapTo(mapping, drugId)}
        />
      ) : null}
      {creating ? (
        <DrugCreateDrawer
          seedBrand={creating.sample}
          onClose={() => {
            setCreating(null);
          }}
          onCreated={(created) => {
            const item = creating;
            setCreating(null);
            // The reading is what this entry was created for: link it so the queue clears.
            mapTo(item, created.id).catch(() => {
              toast({ tone: "error", title: t("admin.drugs.review.failed") });
              list.reload();
            });
          }}
        />
      ) : null}
    </div>
  );
}

function LearnedTab({ canWrite }: { canWrite: boolean }) {
  const { toast } = useToast();
  const list = useCursorList<LearnedItem>(
    "/admin/drugs/learned",
    "status=pending",
    learnedListResponseSchema,
  );

  const decide = async (item: LearnedItem, decision: "approve" | "reject") => {
    try {
      await api(`/admin/drugs/learned/${decision}`, {
        method: "POST",
        body: { normalized: item.normalized, drugId: item.drugId },
        schema: queueActionResponseSchema,
      });
      toast({
        tone: "success",
        title: t(
          decision === "approve" ? "admin.drugs.review.approved" : "admin.drugs.review.rejected",
          { name: item.normalized },
        ),
      });
      list.reload();
    } catch {
      toast({ tone: "error", title: t("admin.drugs.review.failed") });
    }
  };

  const columns: DataTableColumn<LearnedItem>[] = [
    {
      id: "normalized",
      header: t("admin.drugs.review.col.reading"),
      primary: true,
      cell: (item) => <bdi dir="auto">{item.normalized}</bdi>,
    },
    {
      id: "drug",
      header: t("admin.drugs.review.col.drug"),
      cell: (item) => (
        <span className="flex flex-col items-start gap-0.5">
          <bdi dir="ltr">{item.brandEn}</bdi>
          <span className="text-sm font-normal text-text-muted">
            {[item.strengthText, item.form].filter(Boolean).join(" · ")}
          </span>
        </span>
      ),
    },
    {
      id: "votes",
      header: t("admin.drugs.review.col.votes"),
      cell: (item) => <span className="tabular-nums">{formatNumber(item.votes)}</span>,
    },
    ...(canWrite
      ? [
          {
            id: "actions",
            header: t("admin.drugs.col.actions"),
            cell: (item: LearnedItem) => (
              <span className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  aria-label={t("admin.drugs.review.approveFor", { name: item.normalized })}
                  onClick={() => {
                    void decide(item, "approve");
                  }}
                >
                  {t("admin.drugs.review.approve")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={t("admin.drugs.review.rejectFor", { name: item.normalized })}
                  onClick={() => {
                    void decide(item, "reject");
                  }}
                >
                  {t("admin.drugs.review.reject")}
                </Button>
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-text-muted">{t("admin.drugs.review.learned.lead")}</p>
      <DataTable
        caption={t("admin.drugs.review.tab.learned")}
        columns={columns}
        rows={list.items}
        rowKey={(item) => `${item.normalized}:${item.drugId}`}
        status={list.status}
        error={list.error}
        onRetry={list.reload}
        nextCursor={list.nextCursor}
        loadingMore={list.loadingMore}
        loadMoreError={list.loadMoreError}
        onLoadMore={list.loadMore}
        emptyTitle={t("admin.drugs.review.learned.empty")}
      />
    </div>
  );
}

/** `/admin/drugs/review` (docs/MEDICATIONS.md section 7): names nobody could match, and pairs users taught us. */
export function DrugReviewView({ canWrite }: { canWrite: boolean }) {
  const url = useUrlParams();
  const tab: ReviewTab = url.get("tab") === "learned" ? "learned" : "unmatched";
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        url.update({ tab: value === "learned" ? "learned" : null });
      }}
      className="flex flex-col gap-5"
    >
      <TabList aria-label={t("admin.nav.drugReview")}>
        <Tab value="unmatched">{t("admin.drugs.review.tab.unmatched")}</Tab>
        <Tab value="learned">{t("admin.drugs.review.tab.learned")}</Tab>
      </TabList>
      <TabPanel value="unmatched">
        <UnmatchedTab canWrite={canWrite} />
      </TabPanel>
      <TabPanel value="learned">
        <LearnedTab canWrite={canWrite} />
      </TabPanel>
    </Tabs>
  );
}
