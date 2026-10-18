"use client";

import { t } from "@wasfa/shared/i18n";
import { referralOverviewSchema } from "@wasfa/shared/schemas/admin-growth";
import { growthFunnelResponseSchema, type GrowthFunnelResponse } from "@wasfa/shared/schemas/growth";
import { Card, moneyText } from "@wasfa/ui";

import { formatNumber, tOr } from "../../lib/admin-format";
import { useResource } from "../../lib/use-admin-data";

import { KpiCard } from "./kpi-card";
import { ResourceBoundary } from "./resource-boundary";

const percent = (bps: number) => `${(bps / 100).toFixed(1)}%`;

function FunnelSteps({ funnel }: { funnel: GrowthFunnelResponse }) {
  const steps = [
    ["visitToSignup", funnel.visitToSignup],
    ["signupToActivation", funnel.signupToActivation],
    ["activationToPaid", funnel.activationToPaid],
    ["checkoutToPaid", funnel.checkoutToPaid],
  ] as const;
  return (
    <Card elevation="card" className="flex flex-col gap-4">
      <h2 className="font-heading text-xl font-bold text-text">{t("admin.growthOverview.funnel")}</h2>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="funnel-steps">
        {steps.map(([key, step]) => (
          <li key={key} className="flex flex-col gap-1 rounded-lg border border-border p-3" data-step={key}>
            <span className="text-sm text-text-muted">{t(`admin.growthOverview.step.${key}`)}</span>
            <span className="font-heading text-2xl font-bold text-text tabular-nums">{percent(step.rateBps)}</span>
            <span className="text-sm text-text-muted tabular-nums">{`${formatNumber(step.from)} → ${formatNumber(step.to)}`}</span>
          </li>
        ))}
      </ol>
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="flex flex-col gap-2">
          <h3 className="font-semibold text-text">{t("admin.growthOverview.prompts")}</h3>
          {funnel.prompts.length === 0 ? (
            <p className="text-sm text-text-muted">{t("admin.growthOverview.none")}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm text-text">
              {funnel.prompts.map((row) => (
                <li key={row.kind}>{`${tOr(`admin.growthOverview.prompt.${row.kind}`, row.kind)}: ${t("admin.growthOverview.promptCounts", { shown: formatNumber(row.shown), clicked: formatNumber(row.clicked), dismissed: formatNumber(row.dismissed) })}`}</li>
              ))}
            </ul>
          )}
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="font-semibold text-text">{t("admin.growthOverview.methods")}</h3>
          {funnel.methodMix.length === 0 ? (
            <p className="text-sm text-text-muted">{t("admin.growthOverview.none")}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm text-text">
              {funnel.methodMix.map((row) => <li key={row.method}>{`${row.method}: ${formatNumber(row.count)}`}</li>)}
            </ul>
          )}
        </section>
        <section className="flex flex-col gap-1 text-sm text-text">
          <h3 className="font-semibold text-text">{t("admin.growthOverview.conversion")}</h3>
          <p>{t("admin.growthOverview.tastes", { started: formatNumber(funnel.tastes.started), completed: formatNumber(funnel.tastes.completed) })}</p>
          <p>{t("admin.growthOverview.offers", { shown: formatNumber(funnel.offers.shown), used: formatNumber(funnel.offers.used) })}</p>
          <p>{t("admin.growthOverview.kFactor", { k: (funnel.referral.kFactorMilli / 1_000).toFixed(2) })}</p>
        </section>
      </div>
    </Card>
  );
}

/** `/admin/growth`: the referral programme at a glance (ADMIN-CONSOLE-SPEC §6.1) and the GROWTH §9 funnel. */
export function GrowthOverviewView({ canReadFunnel }: { canReadFunnel: boolean }) {
  const overview = useResource("/admin/growth/referrals/overview", referralOverviewSchema);
  const funnel = useResource(canReadFunnel ? "/admin/growth/funnel" : null, growthFunnelResponseSchema);
  return (
    <div className="flex flex-col gap-6">
      <ResourceBoundary resource={overview}>
        {(data) => (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label={t("admin.growthOverview.invited")} value={formatNumber(data.funnel.invited)} />
            <KpiCard label={t("admin.growthOverview.verified")} value={formatNumber(data.funnel.verified)} />
            <KpiCard label={t("admin.growthOverview.paid")} value={formatNumber(data.funnel.paid)} />
            <KpiCard label={t("admin.growthOverview.accrued")} value={moneyText(data.rewards.accrued.valueMinor, data.currency)} />
          </div>
        )}
      </ResourceBoundary>
      {canReadFunnel ? <ResourceBoundary resource={funnel}>{(data) => <FunnelSteps funnel={data} />}</ResourceBoundary> : null}
    </div>
  );
}
