"use client";

import { t } from "@wasfa/shared/i18n";
import { planListResponseSchema } from "@wasfa/shared/schemas/plans";
import { Badge, Button, Card, Tab, TabList, TabPanel, Tabs, useToast } from "@wasfa/ui";
import { Save, Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import {
  adminPlanListSchema,
  methodListSchema,
  taxRuleListSchema,
  type AdminPlan,
} from "../../lib/admin-billing-schemas";
import { api } from "../../lib/api-client";
import { toApiError } from "../../lib/forms";
import {
  draftFromPlan,
  featuresValid,
  isDirty,
  patchFromDraft,
  type PlanDraft,
} from "../../lib/plan-draft";
import { marginAssumptions } from "../../lib/plan-margin";
import { matrixCurrencies, matrixFromPrices, type MatrixDraft } from "../../lib/price-matrix";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { useUrlParams } from "../../lib/use-url-params";
import { ErrorNotice } from "../error-notice";

import { EntitlementsEditor } from "./entitlements-editor";
import { PlanFeaturesTab } from "./plan-features-tab";
import { PlanMarginTab } from "./plan-margin-tab";
import { PlanOverviewTab } from "./plan-overview-tab";
import { PlanPreview } from "./plan-preview";
import { PlanPricesTab } from "./plan-prices-tab";
import { ResourceBoundary } from "./resource-boundary";

import type { ApiRequestError } from "../../lib/api-error";
import type { PlanView } from "@wasfa/shared/schemas/plans";

export interface BillingPlansViewProps {
  /** `billing.write`: publish prices. */
  canPublish: boolean;
  /** `plans.write`: edit texts, features and allowances. */
  canEditPlan: boolean;
  /** `plans.read`: the allowances tab reads the Phase 2 plan list. */
  canReadAllowances: boolean;
}

function Editor({
  plan,
  plans,
  entitlementsPlan,
  assumptions,
  canPublish,
  canEditPlan,
  onChanged,
  onEntitlementsSaved,
}: {
  plan: AdminPlan;
  plans: readonly AdminPlan[];
  entitlementsPlan: PlanView | null;
  assumptions: ReturnType<typeof marginAssumptions>;
  canPublish: boolean;
  canEditPlan: boolean;
  onChanged: () => void;
  onEntitlementsSaved: () => void;
}) {
  const { toast } = useToast();
  const reauth = useReauth();
  const [tab, setTab] = useState("overview");
  const [draft, setDraft] = useState<PlanDraft>(() => draftFromPlan(plan));
  const [matrix, setMatrix] = useState<MatrixDraft>(() => matrixFromPrices(plan.prices));
  const [extra, setExtra] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  const stored = matrixFromPrices(plan.prices);
  const matrixDirty = Object.keys({ ...stored, ...matrix }).some(
    (key) => (stored[key] ?? "") !== (matrix[key] ?? ""),
  );
  const patch = patchFromDraft(plan, draft);
  const dirty = isDirty(plan, draft);
  const currencies = matrixCurrencies(plan.prices, extra);
  const monthsList = useMemo(
    () =>
      [...new Set([1, 3, 6, 12, ...plan.prices.map((price) => price.months)])].sort(
        (a, b) => a - b,
      ),
    [plan.prices],
  );
  const monthlyCredits = Number(draft.monthlyCredits);

  const save = () => {
    if (saving || !("body" in patch)) return;
    setSaving(true);
    setError(null);
    reauth
      .run(() => api(`/admin/plans/${plan.id}`, { method: "PATCH", body: patch.body }))
      .then(
        () => {
          setSaving(false);
          toast({ tone: "success", title: t("admin.pricing.plan.saved", { name: draft.nameAr }) });
          onChanged();
        },
        (failure: unknown) => {
          setSaving(false);
          setError(toApiError(failure));
        },
      );
  };

  const saveBar = canEditPlan ? (
    <div className="flex flex-wrap items-center gap-3">
      <Button name="save-plan" onClick={save} loading={saving} disabled={!("body" in patch)}>
        <Save aria-hidden className="size-5" />
        {t("admin.pricing.plan.save")}
      </Button>
      {dirty ? <Badge tone="warning">{t("admin.pricing.plan.unsaved")}</Badge> : null}
      {"errors" in patch && patch.errors.length > 0 && !patch.errors.includes("nothing") ? (
        <span role="alert" className="text-sm text-danger">
          {t("admin.pricing.plan.invalid")}
        </span>
      ) : null}
    </div>
  ) : null;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card elevation="flat" className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-xl font-semibold">{plan.nameAr}</h2>
          <Badge tone={plan.visibility === "public" ? "success" : "neutral"}>
            {t(`admin.pricing.plan.visibility.${plan.visibility}`)}
          </Badge>
        </div>
        {error ? <ErrorNotice error={error} /> : null}
        <Tabs value={tab} onValueChange={setTab}>
          <TabList aria-label={t("admin.pricing.tabs.label")} className="flex flex-wrap gap-1">
            {(["overview", "prices", "allowances", "features", "margin", "who"] as const).map(
              (id) => (
                <Tab key={id} value={id}>
                  {t(`admin.pricing.tabs.${id}`)}
                </Tab>
              ),
            )}
          </TabList>
          <TabPanel value="overview" className="pt-4">
            <div className="flex flex-col gap-4">
              <PlanOverviewTab
                draft={draft}
                disabled={!canEditPlan}
                onChange={(change) => {
                  setDraft((current) => ({ ...current, ...change }));
                }}
              />
              {saveBar}
            </div>
          </TabPanel>
          <TabPanel value="prices" className="pt-4">
            <PlanPricesTab
              plan={plan}
              matrix={matrix}
              extraCurrencies={extra}
              disabled={!canPublish}
              dirty={matrixDirty}
              onMatrix={setMatrix}
              onAddCurrency={(currency) => {
                setExtra((current) => [...current, currency]);
              }}
              onPublished={onChanged}
            />
          </TabPanel>
          <TabPanel value="allowances" className="pt-4">
            <div className="flex flex-col gap-4">
              <label className="flex max-w-xs flex-col gap-1 text-base font-semibold">
                {t("admin.pricing.allowances.monthlyCredits")}
                <input
                  name="monthlyCredits"
                  inputMode="numeric"
                  dir="ltr"
                  disabled={!canEditPlan}
                  value={draft.monthlyCredits}
                  onChange={(event) => {
                    setDraft((current) => ({ ...current, monthlyCredits: event.target.value }));
                  }}
                  className="min-h-11 rounded-lg border border-border bg-surface px-3 text-base tabular-nums focus-visible:outline-none focus-visible:shadow-focus"
                />
              </label>
              {saveBar}
              {entitlementsPlan ? (
                <EntitlementsEditor
                  key={`${entitlementsPlan.id}:${entitlementsPlan.updatedAt}`}
                  plan={entitlementsPlan}
                  canWrite={canEditPlan}
                  onSaved={onEntitlementsSaved}
                />
              ) : (
                <p className="text-base text-text-muted">
                  {t("admin.pricing.allowances.noAccess")}
                </p>
              )}
            </div>
          </TabPanel>
          <TabPanel value="features" className="pt-4">
            <div className="flex flex-col gap-4">
              <PlanFeaturesTab
                features={draft.features}
                disabled={!canEditPlan}
                onChange={(features) => {
                  setDraft((current) => ({ ...current, features }));
                }}
              />
              {!featuresValid(draft.features) ? (
                <p role="alert" className="text-sm text-danger">
                  {t("admin.pricing.features.invalid")}
                </p>
              ) : null}
              {saveBar}
            </div>
          </TabPanel>
          <TabPanel value="margin" className="pt-4">
            <PlanMarginTab
              plan={plan}
              matrix={matrix}
              months={monthsList}
              currencies={currencies}
              monthlyCredits={
                Number.isFinite(monthlyCredits) ? monthlyCredits : plan.monthlyCredits
              }
              assumptions={assumptions}
            />
          </TabPanel>
          <TabPanel value="who" className="pt-4">
            <div className="flex flex-col gap-3">
              <p className="text-base">
                {t("admin.pricing.who.count", { count: plan.activeSubscribers })}
              </p>
              <Link
                href={`/admin/billing/subscriptions?planKey=${plan.key}`}
                className="inline-flex min-h-11 items-center gap-2 self-start rounded-lg px-3 text-base font-semibold text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus"
              >
                <Users aria-hidden className="size-5" />
                {t("admin.pricing.who.open")}
              </Link>
            </div>
          </TabPanel>
        </Tabs>
      </Card>
      <PlanPreview
        plans={plans}
        selected={plan}
        draft={draft}
        matrix={matrix}
        currencies={currencies}
      />
    </div>
  );
}

function Loaded({
  plans,
  canPublish,
  canEditPlan,
  canReadAllowances,
  reload,
}: BillingPlansViewProps & { plans: readonly AdminPlan[]; reload: () => void }) {
  const url = useUrlParams();
  const sorted = useMemo(() => [...plans].sort((a, b) => a.sort - b.sort), [plans]);
  const selected = sorted.find((plan) => plan.key === url.get("plan")) ?? sorted[0];
  const allowances = useResource(canReadAllowances ? "/admin/plans" : null, planListResponseSchema);
  const taxRules = useResource("/admin/billing/tax-rules", taxRuleListSchema);
  const methods = useResource("/admin/billing/methods", methodListSchema);
  const assumptions = marginAssumptions(
    taxRules.status === "ready" ? taxRules.data : [],
    methods.status === "ready" ? methods.data.items : [],
  );
  if (!selected)
    return <p className="text-base text-text-muted">{t("admin.pricing.plans.empty")}</p>;
  const entitlementsPlan =
    allowances.status === "ready"
      ? (allowances.data.items.find((plan) => plan.id === selected.id) ?? null)
      : null;

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label={t("admin.pricing.plans.list")}>
        <ul className="flex flex-wrap gap-2">
          {sorted.map((plan) => (
            <li key={plan.id}>
              <Button
                variant={plan.id === selected.id ? "primary" : "secondary"}
                aria-current={plan.id === selected.id ? "true" : undefined}
                name={`plan-${plan.key}`}
                onClick={() => {
                  url.update({ plan: plan.key });
                }}
              >
                {plan.nameAr}
              </Button>
            </li>
          ))}
        </ul>
      </nav>
      <Editor
        key={`${selected.id}:${JSON.stringify(selected.prices)}:${selected.nameAr}:${selected.features.length}`}
        plan={selected}
        plans={sorted}
        entitlementsPlan={entitlementsPlan}
        assumptions={assumptions}
        canPublish={canPublish}
        canEditPlan={canEditPlan}
        onChanged={reload}
        onEntitlementsSaved={allowances.status === "ready" ? allowances.reload : reload}
      />
    </div>
  );
}

/** `/admin/billing/plans`: the plan editor and its live preview, margin calculator and price publishing. */
export function BillingPlansView(props: BillingPlansViewProps) {
  const resource = useResource("/admin/billing/plans", adminPlanListSchema);
  return (
    <ResourceBoundary resource={resource}>
      {(data) => <Loaded {...props} plans={data.items} reload={resource.reload} />}
    </ResourceBoundary>
  );
}
