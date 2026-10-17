"use client";

import { SUBSCRIPTION_SOURCES, SUBSCRIPTION_STATUSES } from "@wasfa/shared/billing";
import { t } from "@wasfa/shared/i18n";
import { Button, Field, Input, Select, useToast } from "@wasfa/ui";
import { CalendarPlus, CircleSlash, Clock } from "lucide-react";
import { useMemo, useState } from "react";

import {
  adminPlanListSchema,
  subscriptionDetailSchema,
  subscriptionPageSchema,
  type SubscriptionDetail,
  type SubscriptionRow,
} from "../../lib/admin-billing-schemas";
import { formatDateTime, formatShortDate, tOr } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { buildQuery, useCursorList, useResource } from "../../lib/use-admin-data";
import { useUrlParams } from "../../lib/use-url-params";

import { DataTable, type DataTableColumn } from "./data-table";
import { DetailList, DetailSection } from "./detail-list";
import { FilterBar, useFiltersActive, type FilterField } from "./filter-bar";
import { ReasonDialog } from "./reason-dialog";
import { RecordDrawer, useOpenRecord } from "./record-drawer";
import { ResourceBoundary } from "./resource-boundary";
import { StatusChip } from "./status-chip";
import { Timeline } from "./timeline";

type Action = "extend" | "end" | "cancel";

function ExtendFields({
  mode,
  onMode,
  months,
  onMonths,
  until,
  onUntil,
}: {
  mode: "months" | "until";
  onMode: (mode: "months" | "until") => void;
  months: string;
  onMonths: (value: string) => void;
  until: string;
  onUntil: (value: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t("admin.revenue.sub.extend.mode")}>
        {(control) => (
          <Select
            {...control}
            name="mode"
            value={mode}
            onChange={(event) => {
              onMode(event.target.value === "until" ? "until" : "months");
            }}
          >
            <option value="months">{t("admin.revenue.sub.extend.byMonths")}</option>
            <option value="until">{t("admin.revenue.sub.extend.byDate")}</option>
          </Select>
        )}
      </Field>
      {mode === "months" ? (
        <Field label={t("admin.revenue.sub.extend.months")} required>
          {(control) => (
            <Input
              {...control}
              name="months"
              ltr
              inputMode="numeric"
              value={months}
              onChange={(event) => {
                onMonths(event.target.value);
              }}
            />
          )}
        </Field>
      ) : (
        <Field label={t("admin.revenue.sub.extend.until")} required>
          {(control) => (
            <Input
              {...control}
              name="until"
              type="date"
              ltr
              value={until}
              onChange={(event) => {
                onUntil(event.target.value);
              }}
            />
          )}
        </Field>
      )}
    </div>
  );
}

function ExtendDialog({
  id,
  open,
  onOpenChange,
  onDone,
}: {
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"months" | "until">("months");
  const [months, setMonths] = useState("1");
  const [until, setUntil] = useState("");
  const monthsNumber = Number(months);
  const valid =
    mode === "months"
      ? Number.isInteger(monthsNumber) && monthsNumber >= 1 && monthsNumber <= 24
      : /^\d{4}-\d{2}-\d{2}$/.test(until);
  return (
    <ReasonDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("admin.revenue.sub.extend.title")}
      effect={t("admin.revenue.sub.extend.effect")}
      confirmLabel={t("admin.revenue.sub.extend.confirm")}
      canSubmit={valid}
      onConfirm={async (reason) => {
        await api(`/admin/billing/subscriptions/${id}/extend`, {
          method: "POST",
          body: mode === "months" ? { months: monthsNumber, reason } : { until, reason },
        });
        onDone();
      }}
    >
      <ExtendFields
        mode={mode}
        onMode={setMode}
        months={months}
        onMonths={setMonths}
        until={until}
        onUntil={setUntil}
      />
    </ReasonDialog>
  );
}

function Body({
  id,
  detail,
  canManage,
  onChanged,
}: {
  id: string;
  detail: SubscriptionDetail;
  canManage: boolean;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [action, setAction] = useState<Action | null>(null);
  const { subscription, owner } = detail;
  const live = ["trialing", "active", "grace"].includes(subscription.status);
  const done = (message: string) => {
    toast({ tone: "success", title: message });
    onChanged();
  };
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusChip kind="subscription" status={subscription.status} />
        <span className="text-base text-text-muted">{owner.label}</span>
      </div>
      {canManage && live ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            name="extend"
            onClick={() => {
              setAction("extend");
            }}
          >
            <CalendarPlus aria-hidden className="size-5" />
            {t("admin.revenue.sub.extend")}
          </Button>
          {!subscription.cancelAtPeriodEnd ? (
            <Button
              variant="secondary"
              name="cancel-at-end"
              onClick={() => {
                setAction("cancel");
              }}
            >
              <Clock aria-hidden className="size-5" />
              {t("admin.revenue.sub.cancelAtEnd")}
            </Button>
          ) : null}
          <Button
            variant="danger"
            name="end"
            onClick={() => {
              setAction("end");
            }}
          >
            <CircleSlash aria-hidden className="size-5" />
            {t("admin.revenue.sub.end")}
          </Button>
        </div>
      ) : null}
      <DetailList
        items={[
          {
            label: t("admin.revenue.sub.col.source"),
            value: tOr(`admin.revenue.source.${subscription.source}`, subscription.source),
          },
          {
            label: t("admin.revenue.sub.periodStart"),
            value: formatDateTime(subscription.currentPeriodStart),
          },
          {
            label: t("admin.revenue.sub.col.periodEnd"),
            value: formatDateTime(subscription.currentPeriodEnd),
          },
          {
            label: t("admin.revenue.sub.graceUntil"),
            value: subscription.graceUntil ? formatDateTime(subscription.graceUntil) : null,
          },
          {
            label: t("admin.revenue.sub.cancelAtPeriodEnd"),
            value: subscription.cancelAtPeriodEnd ? t("admin.revenue.yes") : t("admin.revenue.no"),
          },
          {
            label: t("admin.revenue.sub.credits"),
            value: detail.creditBalance === null ? null : String(detail.creditBalance),
          },
        ]}
      />
      <DetailSection title={t("admin.revenue.sub.timeline")}>
        <Timeline
          label={t("admin.revenue.sub.timeline")}
          entries={detail.events.map((event) => ({
            key: event.id,
            title: tOr(`admin.revenue.subEvent.${event.type}`, event.type),
            time: formatDateTime(event.createdAt),
          }))}
        />
      </DetailSection>
      <ExtendDialog
        id={id}
        open={action === "extend"}
        onOpenChange={(next) => {
          setAction(next ? "extend" : null);
        }}
        onDone={() => {
          done(t("admin.revenue.sub.extend.done"));
        }}
      />
      <ReasonDialog
        open={action === "cancel"}
        onOpenChange={(next) => {
          setAction(next ? "cancel" : null);
        }}
        title={t("admin.revenue.sub.cancelAtEnd")}
        effect={t("admin.revenue.sub.cancelEffect", {
          date: formatShortDate(subscription.currentPeriodEnd),
        })}
        confirmLabel={t("admin.revenue.sub.cancelAtEnd")}
        onConfirm={async (reason) => {
          await api(`/admin/billing/subscriptions/${id}/cancel-at-period-end`, {
            method: "POST",
            body: { reason },
          });
          done(t("admin.revenue.sub.cancelDone"));
        }}
      />
      <ReasonDialog
        open={action === "end"}
        onOpenChange={(next) => {
          setAction(next ? "end" : null);
        }}
        title={t("admin.revenue.sub.end")}
        effect={t("admin.revenue.sub.endEffect")}
        confirmLabel={t("admin.revenue.sub.endConfirm")}
        tone="danger"
        typedConfirmation={t("admin.revenue.sub.endWord")}
        onConfirm={async (reason) => {
          await api(`/admin/billing/subscriptions/${id}/end`, { method: "POST", body: { reason } });
          done(t("admin.revenue.sub.endDone"));
        }}
      />
    </>
  );
}

function DrawerBody({
  id,
  canManage,
  onChanged,
}: {
  id: string;
  canManage: boolean;
  onChanged: () => void;
}) {
  const resource = useResource(`/admin/billing/subscriptions/${id}`, subscriptionDetailSchema);
  return (
    <ResourceBoundary resource={resource}>
      {(detail) => (
        <Body
          id={id}
          detail={detail}
          canManage={canManage}
          onChanged={() => {
            resource.reload();
            onChanged();
          }}
        />
      )}
    </ResourceBoundary>
  );
}

const EXPIRING_DAYS = [3, 7, 14, 30] as const;

/** `/admin/billing/subscriptions`: every subscription, who it belongs to and what happens next. */
export function BillingSubscriptionsView({ canManage }: { canManage: boolean }) {
  const url = useUrlParams();
  const record = useOpenRecord();
  const plans = useResource("/admin/billing/plans", adminPlanListSchema);
  const planOptions = useMemo(
    () =>
      plans.status === "ready"
        ? plans.data.items.map((plan) => ({ value: plan.key, label: plan.nameAr }))
        : [],
    [plans],
  );
  const fields = useMemo<FilterField[]>(
    () => [
      {
        kind: "select",
        name: "status",
        label: t("admin.revenue.sub.filter.status"),
        allLabel: t("admin.revenue.filter.all"),
        options: SUBSCRIPTION_STATUSES.map((value) => ({
          value,
          label: tOr(`admin.revenue.status.subscription.${value}`, value),
        })),
      },
      {
        kind: "select",
        name: "source",
        label: t("admin.revenue.sub.filter.source"),
        allLabel: t("admin.revenue.filter.all"),
        options: SUBSCRIPTION_SOURCES.map((value) => ({
          value,
          label: tOr(`admin.revenue.source.${value}`, value),
        })),
      },
      {
        kind: "select",
        name: "expiringWithinDays",
        label: t("admin.revenue.sub.filter.expiring"),
        allLabel: t("admin.revenue.filter.all"),
        options: EXPIRING_DAYS.map((days) => ({
          value: String(days),
          label: t("admin.revenue.sub.filter.expiringDays", { count: days }),
        })),
      },
      ...(planOptions.length > 0
        ? ([
            {
              kind: "select",
              name: "planKey",
              label: t("admin.revenue.sub.filter.plan"),
              allLabel: t("admin.revenue.filter.all"),
              options: planOptions,
            },
          ] satisfies FilterField[])
        : []),
    ],
    [planOptions],
  );
  const filtersActive = useFiltersActive(fields);
  const list = useCursorList(
    "/admin/billing/subscriptions",
    buildQuery({
      status: url.get("status"),
      source: url.get("source"),
      expiringWithinDays: url.get("expiringWithinDays"),
      planKey: url.get("planKey"),
    }),
    subscriptionPageSchema,
  );

  const columns: DataTableColumn<SubscriptionRow>[] = [
    {
      id: "owner",
      header: t("admin.revenue.sub.col.owner"),
      primary: true,
      cell: (row) => row.owner.label,
    },
    { id: "plan", header: t("admin.revenue.sub.col.plan"), cell: (row) => row.planKey },
    {
      id: "status",
      header: t("admin.revenue.sub.col.status"),
      cell: (row) => <StatusChip kind="subscription" status={row.status} />,
    },
    {
      id: "source",
      header: t("admin.revenue.sub.col.source"),
      cell: (row) => tOr(`admin.revenue.source.${row.source}`, row.source),
    },
    {
      id: "end",
      header: t("admin.revenue.sub.col.periodEnd"),
      cell: (row) => <span className="tabular-nums">{formatShortDate(row.currentPeriodEnd)}</span>,
    },
    {
      id: "next",
      header: t("admin.revenue.sub.col.next"),
      cell: (row) => t(`admin.revenue.sub.next.${row.nextAction}`),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <FilterBar fields={fields} />
      <DataTable
        caption={t("admin.nav.subscriptions")}
        columns={columns}
        rows={list.items}
        rowKey={(row) => row.id}
        status={list.status}
        error={list.error}
        onRetry={list.reload}
        onOpenRow={(row) => {
          record.open(row.id);
        }}
        openLabel={(row) => t("admin.revenue.sub.open", { owner: row.owner.label })}
        nextCursor={list.nextCursor}
        loadingMore={list.loadingMore}
        loadMoreError={list.loadMoreError}
        onLoadMore={list.loadMore}
        filtersActive={filtersActive}
        onClearFilters={() => {
          url.update({ status: null, source: null, expiringWithinDays: null, planKey: null });
        }}
        emptyTitle={t("admin.revenue.sub.empty")}
        emptyDescription={t("admin.revenue.sub.emptyHint")}
      />
      <RecordDrawer title={t("admin.revenue.sub.detail")}>
        {(id) => <DrawerBody id={id} canManage={canManage} onChanged={list.reload} />}
      </RecordDrawer>
    </div>
  );
}
