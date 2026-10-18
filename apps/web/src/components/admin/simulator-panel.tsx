"use client";

import { t } from "@wasfa/shared/i18n";
import {
  simulateBillingResponseSchema,
  type SimulateBillingInput,
} from "@wasfa/shared/schemas/billing";
import { Badge, Button, Field, Input, Select, moneyText } from "@wasfa/ui";
import { CircleCheck, CircleX, FlaskConical } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { tOr } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { toApiError } from "../../lib/forms";
import { ErrorNotice } from "../error-notice";

import { CheckoutSummaryPreview } from "./checkout-summary-preview";
import { UserPicker, type PickedUser } from "./user-picker";

import type { ApiRequestError } from "../../lib/api-error";

export type SimulationResult = z.output<typeof simulateBillingResponseSchema>;

export interface SimulatorPlan {
  key: string;
  name: string;
}

type Months = SimulateBillingInput["months"];
const MONTHS: readonly Months[] = [1, 3, 6, 12];

/** Asks the engine what a basket costs now (`POST /admin/billing/simulate`); nothing is stored. */
export function simulate(input: SimulateBillingInput): Promise<SimulationResult> {
  return api("/admin/billing/simulate", {
    method: "POST",
    body: input,
    schema: simulateBillingResponseSchema,
  });
}

/** The engine's answer as the admin reads it: the checkout summary, why each discount won or lost, the code outcome. */
export function SimulationResultView({
  result,
  subject,
}: {
  result: SimulationResult;
  subject: string;
}) {
  return (
    <div className="flex flex-col gap-4" data-testid="simulation-result">
      {result.error ? (
        <p role="alert" className="flex items-center gap-2 text-base text-danger">
          <CircleX aria-hidden className="size-5 shrink-0" />
          {tOr(`admin.revenue.sim.error.${result.error}`, result.error)}
        </p>
      ) : null}
      {result.quote ? <CheckoutSummaryPreview quote={result.quote} subject={subject} /> : null}
      {result.coupon ? (
        <p className="text-base">
          <span className="font-semibold">{t("admin.revenue.sim.couponOutcome")} </span>
          {t(`admin.revenue.sim.coupon.${result.coupon.status}`)}
        </p>
      ) : null}
      {result.candidates.length > 0 ? (
        <section aria-label={t("admin.revenue.sim.candidates")} className="flex flex-col gap-2">
          <h4 className="font-heading text-base font-semibold">
            {t("admin.revenue.sim.candidates")}
          </h4>
          <ul className="flex flex-col gap-2">
            {result.candidates.map((candidate) => (
              <li
                key={candidate.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
              >
                <span>
                  {candidate.name ?? t(`admin.revenue.sim.source.${candidate.source}`)}
                  <span className="text-sm text-text-muted">
                    {" · "}
                    {t(`admin.revenue.sim.source.${candidate.source}`)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {candidate.aloneSavingMinor > 0 && result.quote ? (
                    <span className="text-sm tabular-nums">
                      {moneyText(candidate.aloneSavingMinor, result.quote.currency)}
                    </span>
                  ) : null}
                  <Badge
                    tone={candidate.chosen ? "success" : candidate.eligible ? "info" : "neutral"}
                  >
                    {candidate.chosen ? (
                      <CircleCheck aria-hidden className="size-3.5" />
                    ) : (
                      <CircleX aria-hidden className="size-3.5" />
                    )}
                    {candidate.chosen
                      ? t("admin.revenue.sim.chosen")
                      : candidate.eligible
                        ? t("admin.revenue.sim.eligible")
                        : t("admin.revenue.sim.notEligible")}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export interface SimulatorPanelProps {
  plans: readonly SimulatorPlan[];
  initialCode?: string | undefined;
}

/** The test box: a user, a plan, a period and a code, and exactly what the engine would charge. */
export function SimulatorPanel({ plans, initialCode = "" }: SimulatorPanelProps) {
  const [user, setUser] = useState<PickedUser | null>(null);
  const [chosenPlan, setPlanKey] = useState("");
  // The plan list arrives after the first render: until one is chosen, the first plan is the default.
  const planKey = plans.some((plan) => plan.key === chosenPlan)
    ? chosenPlan
    : (plans[0]?.key ?? "");
  const [months, setMonths] = useState<Months>(1);
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [result, setResult] = useState<SimulationResult | null>(null);

  const run = () => {
    if (busy || planKey === "") return;
    setBusy(true);
    setError(null);
    simulate({
      planKey,
      months,
      ...(user ? { userId: user.id } : {}),
      ...(code.trim() !== "" ? { couponCode: code.trim().toUpperCase() } : {}),
    }).then(
      (value) => {
        setBusy(false);
        setResult(value);
      },
      (failure: unknown) => {
        setBusy(false);
        setError(toApiError(failure));
      },
    );
  };

  return (
    <section aria-label={t("admin.revenue.sim.title")} className="flex flex-col gap-4">
      <h3 className="flex items-center gap-2 font-heading text-lg font-semibold">
        <FlaskConical aria-hidden className="size-5" />
        {t("admin.revenue.sim.title")}
      </h3>
      <p className="text-base text-text-muted">{t("admin.revenue.sim.lead")}</p>
      <UserPicker label={t("admin.revenue.sim.user")} value={user} onChange={setUser} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("admin.revenue.sim.plan")}>
          {(control) => (
            <Select
              {...control}
              name="sim-plan"
              value={planKey}
              onChange={(event) => {
                setPlanKey(event.target.value);
              }}
            >
              {plans.map((plan) => (
                <option key={plan.key} value={plan.key}>
                  {plan.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("admin.revenue.sim.months")}>
          {(control) => (
            <Select
              {...control}
              name="sim-months"
              value={String(months)}
              onChange={(event) => {
                const next = MONTHS.find((value) => String(value) === event.target.value);
                if (next) setMonths(next);
              }}
            >
              {MONTHS.map((value) => (
                <option key={value} value={value}>
                  {t("admin.pricing.matrix.months", { count: value })}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("admin.revenue.sim.code")}>
          {(control) => (
            <Input
              {...control}
              name="sim-code"
              ltr
              autoComplete="off"
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
              }}
            />
          )}
        </Field>
      </div>
      <Button name="simulate" className="self-start" loading={busy} onClick={run}>
        {t("admin.revenue.sim.run")}
      </Button>
      {error ? <ErrorNotice error={error} /> : null}
      {result ? (
        <SimulationResultView
          result={result}
          subject={plans.find((plan) => plan.key === planKey)?.name ?? planKey}
        />
      ) : null}
    </section>
  );
}
