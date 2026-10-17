"use client";

import { t } from "@wasfa/shared/i18n";
import {
  promotionListResponseSchema,
  type promotionViewSchema,
} from "@wasfa/shared/schemas/billing";
import { Button, Card, Skeleton, useToast } from "@wasfa/ui";
import { Copy, Pause, Play, Plus, Rocket, Square } from "lucide-react";
import { useMemo, useState } from "react";
import { type z } from "zod";

import {
  adminPlanListSchema,
  methodListSchema,
  taxRuleListSchema,
} from "../../lib/admin-billing-schemas";
import { formatShortDate } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { useCursorList, useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import { ConfirmDialog } from "./confirm-dialog";
import { EmptyHint } from "./empty-hint";
import { PromotionWizard } from "./promotion-wizard";
import { RecordDrawer, useOpenRecord } from "./record-drawer";
import { RuleSentence } from "./rule-sentence";
import { StatusChip } from "./status-chip";

type Promotion = z.output<typeof promotionViewSchema>;
type Transition = "publish" | "pause" | "resume" | "end" | "duplicate";

const GROUPS = ["active", "scheduled", "paused", "draft", "ended"] as const;

function ruleOf(promotion: Promotion, planNames: ReadonlyMap<string, string>) {
  return {
    kind: promotion.kind,
    value: promotion.value,
    currency: promotion.currency,
    planNames: promotion.planIds.map((id) => planNames.get(id) ?? id),
    months: promotion.months,
    audience: promotion.audience,
    countries: promotion.countries,
    newCustomersOnly: promotion.newCustomersOnly,
    minAmountMinor: promotion.minAmountMinor,
    maxRedemptions: promotion.maxRedemptions,
    perOwnerLimit: promotion.perOwnerLimit,
    startsAt: promotion.startsAt,
    endsAt: promotion.endsAt,
    stacking: promotion.stacking,
  };
}

function PromotionCard({
  promotion,
  planNames,
  canWrite,
  busy,
  onOpen,
  onAction,
}: {
  promotion: Promotion;
  planNames: ReadonlyMap<string, string>;
  canWrite: boolean;
  busy: boolean;
  onOpen: () => void;
  onAction: (action: Transition) => void;
}) {
  const { status } = promotion;
  const button = (
    action: Transition,
    label: string,
    Icon: typeof Pause,
    variant: "secondary" | "primary" | "ghost" = "secondary",
  ) => (
    <Button
      key={action}
      variant={variant}
      name={`${action}-${promotion.id}`}
      disabled={busy}
      onClick={() => {
        onAction(action);
      }}
    >
      <Icon aria-hidden className="size-5" />
      {label}
    </Button>
  );
  return (
    <Card elevation="flat" className="flex flex-col gap-3" data-testid="promotion-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 text-start font-heading text-lg font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
        >
          {promotion.titleAr}
        </button>
        <StatusChip kind="discount" status={status} />
      </div>
      <p className="text-sm text-text-muted">{promotion.name}</p>
      <RuleSentence rule={ruleOf(promotion, planNames)} />
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-text-muted">{t("admin.pricing.promo.card.redemptions")}</dt>
          <dd className="tabular-nums">
            {promotion.redeemedCount}
            {promotion.maxRedemptions !== null ? ` / ${String(promotion.maxRedemptions)}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">{t("admin.pricing.promo.card.dates")}</dt>
          <dd className="tabular-nums">
            {promotion.startsAt ? formatShortDate(promotion.startsAt) : "—"}
            {" → "}
            {promotion.endsAt ? formatShortDate(promotion.endsAt) : "—"}
          </dd>
        </div>
      </dl>
      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          {status === "draft"
            ? button("publish", t("admin.pricing.promo.action.publish"), Rocket, "primary")
            : null}
          {status === "active" || status === "scheduled"
            ? button("pause", t("admin.pricing.promo.action.pause"), Pause)
            : null}
          {status === "paused"
            ? button("resume", t("admin.pricing.promo.action.resume"), Play, "primary")
            : null}
          {status !== "ended" && status !== "draft"
            ? button("end", t("admin.pricing.promo.action.end"), Square)
            : null}
          {button("duplicate", t("admin.pricing.promo.action.duplicate"), Copy, "ghost")}
        </div>
      ) : null}
    </Card>
  );
}

/** `/admin/billing/promotions`: promotions as cards grouped by status, with one-click pause, resume, end and duplicate. */
export function BillingPromotionsView({ canWrite }: { canWrite: boolean }) {
  const { toast } = useToast();
  const reauth = useReauth();
  const record = useOpenRecord();
  const list = useCursorList("/admin/billing/promotions", "limit=100", promotionListResponseSchema);
  const plans = useResource("/admin/billing/plans", adminPlanListSchema);
  const taxRules = useResource("/admin/billing/tax-rules", taxRuleListSchema);
  const methods = useResource("/admin/billing/methods", methodListSchema);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [ending, setEnding] = useState<Promotion | null>(null);

  const planNames = useMemo(
    () =>
      new Map(
        plans.status === "ready" ? plans.data.items.map((plan) => [plan.id, plan.nameAr]) : [],
      ),
    [plans],
  );

  const run = (promotion: Promotion, action: Transition) => {
    setBusyId(promotion.id);
    setError(null);
    return reauth
      .run(() => api(`/admin/billing/promotions/${promotion.id}/${action}`, { method: "POST" }))
      .then(
        () => {
          setBusyId(null);
          toast({
            tone: "success",
            title: t(`admin.pricing.promo.done.${action}`, { name: promotion.titleAr }),
          });
          list.reload();
        },
        (failure: unknown) => {
          setBusyId(null);
          setError(toApiError(failure));
        },
      );
  };

  if (creating) {
    if (plans.status !== "ready") {
      return plans.status === "error" ? (
        <ErrorNotice error={plans.error} onRetry={plans.reload} />
      ) : (
        <Skeleton className="h-64 w-full" />
      );
    }
    return (
      <PromotionWizard
        plans={plans.data.items}
        taxRules={taxRules.status === "ready" ? taxRules.data : []}
        methods={methods.status === "ready" ? methods.data.items : []}
        canPublish={canWrite}
        onClose={() => {
          setCreating(false);
        }}
        onCreated={() => {
          setCreating(false);
          list.reload();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {canWrite ? (
        <Button
          name="new-promotion"
          className="self-start"
          onClick={() => {
            setCreating(true);
          }}
        >
          <Plus aria-hidden className="size-5" />
          {t("admin.pricing.promo.new")}
        </Button>
      ) : null}
      {error ? <ErrorNotice error={error} /> : null}
      {list.status === "loading" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-56 w-full" />
          ))}
        </div>
      ) : list.status === "error" ? (
        <ErrorNotice error={list.error} onRetry={list.reload} />
      ) : list.items.length === 0 ? (
        <EmptyHint
          icon={<Rocket />}
          title={t("admin.pricing.promo.empty")}
          hint={t("admin.pricing.promo.emptyHint")}
        />
      ) : (
        GROUPS.map((group) => {
          const items = list.items.filter((promotion) => promotion.status === group);
          if (items.length === 0) return null;
          return (
            <section key={group} aria-labelledby={`promo-${group}`} className="flex flex-col gap-3">
              <h2 id={`promo-${group}`} className="font-heading text-xl font-semibold">
                {t(`admin.revenue.status.discount.${group}`)}
                <span className="ms-2 text-base font-normal text-text-muted">({items.length})</span>
              </h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {items.map((promotion) => (
                  <PromotionCard
                    key={promotion.id}
                    promotion={promotion}
                    planNames={planNames}
                    canWrite={canWrite}
                    busy={busyId === promotion.id}
                    onOpen={() => {
                      record.open(promotion.id);
                    }}
                    onAction={(action) => {
                      if (action === "end") setEnding(promotion);
                      else void run(promotion, action);
                    }}
                  />
                ))}
              </div>
            </section>
          );
        })
      )}
      {list.nextCursor ? (
        <Button
          variant="secondary"
          className="self-start"
          loading={list.loadingMore}
          onClick={list.loadMore}
        >
          {t("admin.table.loadMore")}
        </Button>
      ) : null}
      <ConfirmDialog
        open={ending !== null}
        onOpenChange={(open) => {
          if (!open) setEnding(null);
        }}
        title={t("admin.pricing.promo.endTitle", { name: ending?.titleAr ?? "" })}
        description={t("admin.pricing.promo.endBody")}
        confirmLabel={t("admin.pricing.promo.action.end")}
        tone="danger"
        onConfirm={async () => {
          if (!ending) return;
          await api(`/admin/billing/promotions/${ending.id}/end`, { method: "POST" });
          toast({
            tone: "success",
            title: t("admin.pricing.promo.done.end", { name: ending.titleAr }),
          });
          list.reload();
        }}
      />
      <RecordDrawer title={t("admin.pricing.promo.detail")}>
        {(id) => {
          const promotion = list.items.find((entry) => entry.id === id);
          return promotion ? (
            <div className="flex flex-col gap-4">
              <StatusChip kind="discount" status={promotion.status} />
              <h3 className="font-heading text-xl font-semibold">{promotion.titleAr}</h3>
              <RuleSentence rule={ruleOf(promotion, planNames)} />
            </div>
          ) : (
            <p className="text-base text-text-muted">{t("admin.pricing.promo.notLoaded")}</p>
          );
        }}
      </RecordDrawer>
    </div>
  );
}
