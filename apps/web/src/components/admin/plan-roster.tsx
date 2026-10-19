"use client";

import { t } from "@wasfa/shared/i18n";
import { formatMoney } from "@wasfa/shared/money";
import { Badge, Button, useToast } from "@wasfa/ui";
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Star, Trash2 } from "lucide-react";
import { useState } from "react";

import { formatNumber } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { toApiError } from "../../lib/forms";
import { planSaleState } from "../../lib/plan-draft";
import { useReauth } from "../../lib/reauth";
import { ErrorNotice } from "../error-notice";

import { ConfirmDialog } from "./confirm-dialog";
import { PlanDialog } from "./plan-dialog";

import type { AdminPlan } from "../../lib/admin-billing-schemas";
import type { ApiRequestError } from "../../lib/api-error";

export interface PlanRosterProps {
  plans: readonly AdminPlan[];
  selectedId: string;
  /** `plans.write`: create, reorder, show or hide, make default and delete. */
  canEdit: boolean;
  onSelect: (plan: AdminPlan) => void;
  onChanged: () => void;
}

const SALE_TONE = {
  on_sale: "success",
  scheduled: "info",
  ended: "warning",
  hidden: "neutral",
} as const;

/** The plan's headline price: one month in EGP when offered, else its shortest offered period. */
function headlinePrice(plan: AdminPlan): string {
  if (plan.isDefault && plan.prices.every((price) => price.amountMinor === null))
    return t("admin.pricing.roster.free");
  const offered = plan.prices
    .filter((price) => price.amountMinor !== null)
    .sort(
      (a, b) => Number(b.currency === "EGP") - Number(a.currency === "EGP") || a.months - b.months,
    );
  const price = offered[0];
  if (!price || price.amountMinor === null) return t("admin.pricing.roster.noPrice");
  const amount = formatMoney(price.amountMinor, price.currency);
  return price.months === 1
    ? t("admin.pricing.roster.perMonth", { amount })
    : t("admin.pricing.roster.perMonths", { amount, months: price.months });
}

/**
 * Every plan at a glance (status for customers, headline price, subscribers) with the actions that
 * act on the plan as a whole: create, order on the pricing page, show or hide, make default,
 * delete. Selecting a row opens it in the editor below.
 */
export function PlanRoster({ plans, selectedId, canEdit, onSelect, onChanged }: PlanRosterProps) {
  const { toast } = useToast();
  const reauth = useReauth();
  const [creating, setCreating] = useState(false);
  const [makingDefault, setMakingDefault] = useState<AdminPlan | null>(null);
  const [removing, setRemoving] = useState<AdminPlan | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const now = new Date();

  const patch = (id: string, body: Record<string, unknown>) =>
    reauth.run(() => api(`/admin/plans/${id}`, { method: "PATCH", body }));

  const run = (id: string, work: () => Promise<unknown>, done: string) => {
    if (busy) return;
    setBusy(id);
    setError(null);
    work().then(
      () => {
        setBusy(null);
        toast({ tone: "success", title: done });
        onChanged();
      },
      (failure: unknown) => {
        setBusy(null);
        setError(toApiError(failure));
      },
    );
  };

  /** Moves a plan one place and renumbers the list 10, 20, 30… so equal sort values cannot tie. */
  const move = (index: number, step: -1 | 1) => {
    const target = index + step;
    const current = plans[index];
    if (!current || target < 0 || target >= plans.length) return;
    const order = [...plans];
    order.splice(index, 1);
    order.splice(target, 0, current);
    const changes = order
      .map((plan, position) => ({ plan, sort: (position + 1) * 10 }))
      .filter(({ plan, sort }) => plan.sort !== sort);
    run(
      current.id,
      async () => {
        for (const change of changes) await patch(change.plan.id, { sort: change.sort });
      },
      t("admin.pricing.roster.moved", { name: current.nameAr }),
    );
  };

  return (
    <section aria-labelledby="plan-roster-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="plan-roster-title" className="font-heading text-xl font-semibold text-text">
            {t("admin.pricing.roster.title")}
          </h2>
          <p className="text-sm text-text-muted">{t("admin.pricing.roster.lead")}</p>
        </div>
        {canEdit ? (
          <Button
            name="new-plan"
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus aria-hidden className="size-5" />
            {t("admin.plans.create")}
          </Button>
        ) : null}
      </div>
      {error ? <ErrorNotice error={error} /> : null}
      <ul className="flex flex-col gap-2" aria-label={t("admin.pricing.plans.list")}>
        {plans.map((plan, index) => {
          const state = planSaleState(plan, now);
          const selected = plan.id === selectedId;
          return (
            <li
              key={plan.id}
              className={
                selected
                  ? "flex flex-wrap items-center gap-3 rounded-lg border-2 border-primary bg-primary-soft p-3"
                  : "flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-3"
              }
            >
              <button
                type="button"
                name={`plan-${plan.key}`}
                aria-current={selected ? "true" : undefined}
                onClick={() => {
                  onSelect(plan);
                }}
                className="flex min-h-11 min-w-0 flex-1 flex-col items-start gap-1 rounded-md text-start focus-visible:outline-none focus-visible:shadow-focus"
              >
                <span className="flex flex-wrap items-center gap-2 text-base font-semibold text-text">
                  {plan.nameAr}
                  <Badge tone={SALE_TONE[state]}>{t(`admin.pricing.plan.sale.${state}`)}</Badge>
                  {plan.isDefault ? <Badge tone="info">{t("admin.plans.default")}</Badge> : null}
                  {plan.pinRecommended ? (
                    <Badge tone="warning">{t("admin.pricing.roster.recommended")}</Badge>
                  ) : null}
                </span>
                <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-muted">
                  <span>{headlinePrice(plan)}</span>
                  <span className="tabular-nums">
                    {t("admin.pricing.roster.subscribers", {
                      count: formatNumber(plan.activeSubscribers),
                    })}
                  </span>
                  <span className="tabular-nums">
                    {t("admin.pricing.roster.credits", {
                      count: formatNumber(plan.monthlyCredits),
                    })}
                  </span>
                </span>
              </button>
              {canEdit ? (
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    variant="ghost"
                    className="px-3"
                    name={`up-${plan.key}`}
                    aria-label={t("admin.pricing.roster.moveUp", { name: plan.nameAr })}
                    disabled={index === 0 || busy !== null}
                    onClick={() => {
                      move(index, -1);
                    }}
                  >
                    <ArrowUp aria-hidden className="size-5" />
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-3"
                    name={`down-${plan.key}`}
                    aria-label={t("admin.pricing.roster.moveDown", { name: plan.nameAr })}
                    disabled={index === plans.length - 1 || busy !== null}
                    onClick={() => {
                      move(index, 1);
                    }}
                  >
                    <ArrowDown aria-hidden className="size-5" />
                  </Button>
                  <Button
                    variant="secondary"
                    name={`visibility-${plan.key}`}
                    loading={busy === plan.id}
                    disabled={busy !== null}
                    onClick={() => {
                      const next = plan.visibility === "public" ? "hidden" : "public";
                      run(
                        plan.id,
                        () => patch(plan.id, { visibility: next }),
                        t(
                          next === "public"
                            ? "admin.pricing.roster.shown"
                            : "admin.pricing.roster.hidden",
                          { name: plan.nameAr },
                        ),
                      );
                    }}
                  >
                    {plan.visibility === "public" ? (
                      <EyeOff aria-hidden className="size-5" />
                    ) : (
                      <Eye aria-hidden className="size-5" />
                    )}
                    {t(
                      plan.visibility === "public"
                        ? "admin.pricing.roster.hide"
                        : "admin.pricing.roster.show",
                    )}
                  </Button>
                  {!plan.isDefault ? (
                    <>
                      <Button
                        variant="ghost"
                        className="px-3"
                        name={`default-${plan.key}`}
                        aria-label={t("admin.plans.makeDefaultTitle", { name: plan.nameAr })}
                        disabled={busy !== null}
                        onClick={() => {
                          setMakingDefault(plan);
                        }}
                      >
                        <Star aria-hidden className="size-5" />
                      </Button>
                      <Button
                        variant="ghost"
                        className="px-3"
                        name={`delete-${plan.key}`}
                        aria-label={t("admin.plans.deleteTitle", { name: plan.nameAr })}
                        disabled={busy !== null}
                        onClick={() => {
                          setRemoving(plan);
                        }}
                      >
                        <Trash2 aria-hidden className="size-5 text-danger" />
                      </Button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <PlanDialog
        open={creating}
        plan={null}
        onClose={() => {
          setCreating(false);
        }}
        onSaved={onChanged}
      />

      <ConfirmDialog
        open={makingDefault !== null}
        onOpenChange={(open) => {
          if (!open) setMakingDefault(null);
        }}
        title={t("admin.plans.makeDefaultTitle", { name: makingDefault?.nameAr ?? "" })}
        description={t("admin.plans.makeDefaultBody")}
        confirmLabel={t("admin.plans.makeDefault")}
        onConfirm={async () => {
          if (!makingDefault) return;
          await api(`/admin/plans/${makingDefault.id}`, {
            method: "PATCH",
            body: { isDefault: true },
          });
          toast({
            tone: "success",
            title: t("admin.plans.madeDefault", { name: makingDefault.nameAr }),
          });
          onChanged();
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("admin.plans.deleteTitle", { name: removing?.nameAr ?? "" })}
        description={t("admin.pricing.roster.deleteBody")}
        confirmLabel={t("admin.plans.delete")}
        tone="danger"
        onConfirm={async () => {
          if (!removing) return;
          await api(`/admin/plans/${removing.id}`, { method: "DELETE" });
          toast({ tone: "success", title: t("admin.plans.deleted", { name: removing.nameAr }) });
          onChanged();
        }}
      />
    </section>
  );
}
