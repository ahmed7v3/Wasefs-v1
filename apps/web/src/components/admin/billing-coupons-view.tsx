"use client";

import { DISCOUNT_STATUSES } from "@wasfa/shared/billing";
import { t } from "@wasfa/shared/i18n";
import {
  couponDetailViewSchema,
  couponListResponseSchema,
  type couponViewSchema,
} from "@wasfa/shared/schemas/billing";
import { Button, Card, useToast } from "@wasfa/ui";
import { Download, Pause, Play, Plus, Rocket, Square } from "lucide-react";
import { useMemo, useState } from "react";
import { type z } from "zod";

import { adminPlanListSchema } from "../../lib/admin-billing-schemas";
import { formatDateTime, tOr } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { downloadCsv } from "../../lib/csv-download";
import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { buildQuery, useCursorList, useResource } from "../../lib/use-admin-data";
import { useUrlParams } from "../../lib/use-url-params";
import { ErrorNotice } from "../error-notice";

import { CouponDialog } from "./coupon-dialog";
import { DataTable, type DataTableColumn } from "./data-table";
import { DetailList, DetailSection } from "./detail-list";
import { FilterBar, useFiltersActive, type FilterField } from "./filter-bar";
import { MoneyCell } from "./money-cell";
import { RecordDrawer, useOpenRecord } from "./record-drawer";
import { ResourceBoundary } from "./resource-boundary";
import { RuleSentence } from "./rule-sentence";
import { SimulatorPanel } from "./simulator-panel";
import { StatusChip } from "./status-chip";

type Coupon = z.output<typeof couponViewSchema>;
type Transition = "publish" | "pause" | "resume" | "end";

function ruleOf(coupon: Coupon, planNames: ReadonlyMap<string, string>) {
  return {
    kind: coupon.kind,
    value: coupon.value,
    currency: coupon.currency,
    planNames: coupon.planIds.map((id) => planNames.get(id) ?? id),
    months: coupon.months,
    audience: coupon.audience,
    countries: coupon.countries,
    newCustomersOnly: coupon.newCustomersOnly,
    minAmountMinor: coupon.minAmountMinor,
    maxRedemptions: coupon.maxRedemptions,
    perOwnerLimit: coupon.perOwnerLimit,
    startsAt: coupon.startsAt,
    endsAt: coupon.endsAt,
    stacking: coupon.stacking,
  };
}

const ACTIONS: Record<string, readonly Transition[]> = {
  draft: ["publish"],
  scheduled: ["pause", "end"],
  active: ["pause", "end"],
  paused: ["resume", "end"],
  ended: [],
};
const ICONS = { publish: Rocket, pause: Pause, resume: Play, end: Square } as const;

function CouponBody({
  id,
  canWrite,
  planNames,
  onChanged,
}: {
  id: string;
  canWrite: boolean;
  planNames: ReadonlyMap<string, string>;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const reauth = useReauth();
  const resource = useResource(`/admin/billing/coupons/${id}`, couponDetailViewSchema);
  const [error, setError] = useState<unknown>(null);

  const run = (action: Transition) => {
    setError(null);
    reauth
      .run(() => api(`/admin/billing/coupons/${id}/${action}`, { method: "POST" }))
      .then(
        () => {
          toast({ tone: "success", title: t(`admin.revenue.coupons.done.${action}`) });
          resource.reload();
          onChanged();
        },
        (failure: unknown) => {
          setError(toApiError(failure));
        },
      );
  };

  return (
    <ResourceBoundary resource={resource}>
      {(coupon) => (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <bdi dir="ltr" className="font-mono text-xl font-semibold">
              {coupon.code}
            </bdi>
            <StatusChip kind="discount" status={coupon.status} />
          </div>
          {canWrite ? (
            <div className="flex flex-wrap gap-2">
              {(ACTIONS[coupon.status] ?? []).map((action) => {
                const Icon = ICONS[action];
                return (
                  <Button
                    key={action}
                    variant={action === "end" ? "danger" : "secondary"}
                    name={action}
                    onClick={() => {
                      run(action);
                    }}
                  >
                    <Icon aria-hidden className="size-5" />
                    {t(`admin.revenue.coupons.action.${action}`)}
                  </Button>
                );
              })}
            </div>
          ) : null}
          {error ? <ErrorNotice error={error} /> : null}
          <RuleSentence rule={ruleOf(coupon, planNames)} />
          <DetailList
            items={[
              {
                label: t("admin.revenue.coupons.col.used"),
                value: `${String(coupon.redeemedCount)}${coupon.maxRedemptions !== null ? ` / ${String(coupon.maxRedemptions)}` : ""}`,
              },
              { label: t("admin.revenue.coupons.campaign"), value: coupon.campaign },
              { label: t("admin.revenue.coupons.batch"), value: coupon.batch },
              {
                label: t("admin.revenue.coupons.assignedTo"),
                value: coupon.targetUserId ?? coupon.targetOrgId,
              },
            ]}
          />
          <DetailSection title={t("admin.revenue.coupons.redemptions")}>
            {coupon.redemptions.length === 0 ? (
              <p className="text-base text-text-muted">
                {t("admin.revenue.coupons.noRedemptions")}
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {coupon.redemptions.map((redemption) => (
                  <li
                    key={redemption.orderNumber}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <bdi dir="ltr">{redemption.orderNumber}</bdi>
                    <span className="text-sm text-text-muted">
                      {tOr(
                        `admin.revenue.coupons.redemption.${redemption.status}`,
                        redemption.status,
                      )}
                    </span>
                    <MoneyCell amountMinor={redemption.discountMinor} currency="EGP" />
                    <span className="text-sm tabular-nums text-text-muted">
                      {formatDateTime(redemption.reservedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </DetailSection>
        </>
      )}
    </ResourceBoundary>
  );
}

function BatchBar({
  batch,
  canWrite,
  onChanged,
}: {
  batch: string;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const reauth = useReauth();
  const [error, setError] = useState<unknown>(null);
  const [downloading, setDownloading] = useState(false);

  const run = (action: Transition) => {
    setError(null);
    reauth
      .run(() => api(`/admin/billing/coupons/batches/${batch}/${action}`, { method: "POST" }))
      .then(
        () => {
          toast({
            tone: "success",
            title: t(`admin.revenue.coupons.batchDone.${action}`, { batch }),
          });
          onChanged();
        },
        (failure: unknown) => {
          setError(toApiError(failure));
        },
      );
  };

  return (
    <Card
      elevation="flat"
      padding="compact"
      className="flex flex-col gap-3"
      data-testid="batch-bar"
    >
      <p className="text-base font-semibold">
        {t("admin.revenue.coupons.batchTitle")} <bdi dir="ltr">{batch}</bdi>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          name="batch-csv"
          loading={downloading}
          onClick={() => {
            setDownloading(true);
            downloadCsv(
              `/admin/billing/coupons/batches/${batch}/export`,
              `coupons-${batch}.csv`,
            ).then(
              () => {
                setDownloading(false);
              },
              (failure: unknown) => {
                setDownloading(false);
                setError(toApiError(failure));
              },
            );
          }}
        >
          <Download aria-hidden className="size-5" />
          {t("admin.revenue.coupons.downloadCsv")}
        </Button>
        {canWrite
          ? (["publish", "pause", "resume", "end"] as const).map((action) => {
              const Icon = ICONS[action];
              return (
                <Button
                  key={action}
                  variant="secondary"
                  name={`batch-${action}`}
                  onClick={() => {
                    run(action);
                  }}
                >
                  <Icon aria-hidden className="size-5" />
                  {t(`admin.revenue.coupons.batchAction.${action}`)}
                </Button>
              );
            })
          : null}
      </div>
      {error ? <ErrorNotice error={error} /> : null}
    </Card>
  );
}

/** `/admin/billing/coupons`: single and bulk coupons, batches with CSV, redemptions and the test box. */
export function BillingCouponsView({ canWrite }: { canWrite: boolean }) {
  const url = useUrlParams();
  const record = useOpenRecord();
  const plans = useResource("/admin/billing/plans", adminPlanListSchema);
  const [dialog, setDialog] = useState<"single" | "bulk" | null>(null);
  const planNames = useMemo(
    () =>
      new Map(
        plans.status === "ready" ? plans.data.items.map((plan) => [plan.id, plan.nameAr]) : [],
      ),
    [plans],
  );
  const fields = useMemo<FilterField[]>(
    () => [
      { kind: "search", name: "q", label: t("admin.revenue.coupons.filter.q"), ltr: true },
      {
        kind: "select",
        name: "status",
        label: t("admin.revenue.coupons.filter.status"),
        allLabel: t("admin.revenue.filter.all"),
        options: DISCOUNT_STATUSES.map((value) => ({
          value,
          label: tOr(`admin.revenue.status.discount.${value}`, value),
        })),
      },
      { kind: "text", name: "batch", label: t("admin.revenue.coupons.filter.batch"), ltr: true },
    ],
    [],
  );
  const filtersActive = useFiltersActive(fields);
  const batch = url.get("batch");
  const list = useCursorList(
    "/admin/billing/coupons",
    buildQuery({ q: url.get("q"), status: url.get("status"), batch }),
    couponListResponseSchema,
  );

  const columns: DataTableColumn<Coupon>[] = [
    {
      id: "code",
      header: t("admin.revenue.coupons.col.code"),
      primary: true,
      cell: (row) => (
        <bdi dir="ltr" className="font-mono">
          {row.code}
        </bdi>
      ),
    },
    {
      id: "rule",
      header: t("admin.revenue.coupons.col.rule"),
      cell: (row) => t(`admin.revenue.coupons.kind.${row.kind}`),
    },
    {
      id: "used",
      header: t("admin.revenue.coupons.col.used"),
      cell: (row) => (
        <span className="tabular-nums">
          {row.redeemedCount}
          {row.maxRedemptions !== null ? ` / ${String(row.maxRedemptions)}` : ""}
        </span>
      ),
    },
    {
      id: "status",
      header: t("admin.revenue.coupons.col.status"),
      cell: (row) => <StatusChip kind="discount" status={row.status} />,
    },
    {
      id: "batch",
      header: t("admin.revenue.coupons.col.batch"),
      cell: (row) => (row.batch ? <bdi dir="ltr">{row.batch}</bdi> : "—"),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      {canWrite ? (
        <div className="flex flex-wrap gap-3">
          <Button
            name="new-coupon"
            onClick={() => {
              setDialog("single");
            }}
          >
            <Plus aria-hidden className="size-5" />
            {t("admin.revenue.coupons.newSingle")}
          </Button>
          <Button
            variant="secondary"
            name="new-bulk"
            onClick={() => {
              setDialog("bulk");
            }}
          >
            <Plus aria-hidden className="size-5" />
            {t("admin.revenue.coupons.newBulk")}
          </Button>
        </div>
      ) : null}
      {batch !== "" ? <BatchBar batch={batch} canWrite={canWrite} onChanged={list.reload} /> : null}
      <FilterBar fields={fields} />
      <DataTable
        caption={t("admin.nav.coupons")}
        columns={columns}
        rows={list.items}
        rowKey={(row) => row.id}
        status={list.status}
        error={list.error}
        onRetry={list.reload}
        onOpenRow={(row) => {
          record.open(row.id);
        }}
        openLabel={(row) => t("admin.revenue.coupons.open", { code: row.code })}
        nextCursor={list.nextCursor}
        loadingMore={list.loadingMore}
        loadMoreError={list.loadMoreError}
        onLoadMore={list.loadMore}
        filtersActive={filtersActive}
        onClearFilters={() => {
          url.update({ q: null, status: null, batch: null });
        }}
        emptyTitle={t("admin.revenue.coupons.empty")}
        emptyDescription={t("admin.revenue.coupons.emptyHint")}
      />
      <Card elevation="flat" className="flex flex-col gap-3">
        <SimulatorPanel
          plans={
            plans.status === "ready"
              ? plans.data.items.map((plan) => ({ key: plan.key, name: plan.nameAr }))
              : []
          }
        />
      </Card>
      <RecordDrawer title={t("admin.revenue.coupons.detail")}>
        {(id) => (
          <CouponBody id={id} canWrite={canWrite} planNames={planNames} onChanged={list.reload} />
        )}
      </RecordDrawer>
      {plans.status === "ready" ? (
        <CouponDialog
          open={dialog !== null}
          mode={dialog ?? "single"}
          plans={plans.data.items}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          onCreated={list.reload}
        />
      ) : null}
    </div>
  );
}
