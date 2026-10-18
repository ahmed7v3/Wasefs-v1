"use client";

import { t } from "@wasfa/shared/i18n";
import { planMargin } from "@wasfa/shared/margin";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  PriceTag,
  Select,
  moneyText,
  useToast,
} from "@wasfa/ui";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";

import { type AdminPlan, type MethodView, type TaxRuleView } from "../../lib/admin-billing-schemas";
import { api } from "../../lib/api-client";
import { toApiError } from "../../lib/forms";
import { marginAssumptions, type MarginAssumptions } from "../../lib/plan-margin";
import {
  emptyPromotionForm,
  estimateAfterMinor,
  promotionBody,
  ruleFromForm,
  type PromotionForm,
  type PromotionKindChoice,
} from "../../lib/promotion-form";
import { useReauth } from "../../lib/reauth";
import { ErrorNotice } from "../error-notice";

import { RuleSentence } from "./rule-sentence";
import { SimulationResultView, simulate, type SimulationResult } from "./simulator-panel";

import type { ApiRequestError } from "../../lib/api-error";
import type { ReactNode } from "react";

/** What the create call answers with: the new promotion, of which only the id is needed to publish it. */
const createdSchema = z.object({ id: z.string() });

const STEPS = ["what", "where", "when", "review"] as const;
const KINDS: readonly PromotionKindChoice[] = ["percent", "fixed", "bonus_credits", "extra_months"];
const MONTH_CHOICES = [1, 3, 6, 12] as const;

export interface PromotionWizardProps {
  plans: readonly AdminPlan[];
  taxRules: readonly TaxRuleView[];
  methods: readonly MethodView[];
  onClose: () => void;
  onCreated: () => void;
  canPublish: boolean;
}

function toggle<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item];
}

function Group({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold text-text">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">{children}</div>
    </fieldset>
  );
}

interface Basket {
  plan: AdminPlan;
  months: number;
  listMinor: number;
}

/** Three example baskets from the EGP prices: the cheapest monthly, a middle one, the biggest period. */
export function exampleBaskets(plans: readonly AdminPlan[], planIds: readonly string[]): Basket[] {
  const pool = plans.filter((plan) => planIds.length === 0 || planIds.includes(plan.id));
  const options: Basket[] = [];
  for (const plan of pool) {
    for (const price of plan.prices) {
      if (price.currency === "EGP" && price.amountMinor !== null && price.amountMinor > 0) {
        options.push({ plan, months: price.months, listMinor: price.amountMinor });
      }
    }
  }
  if (options.length === 0) return [];
  const byMonths = [...options].sort((a, b) => a.months - b.months || a.listMinor - b.listMinor);
  const byPrice = [...options].sort((a, b) => a.listMinor - b.listMinor);
  const picks = [
    byMonths[0],
    byPrice[Math.floor(byPrice.length / 2)],
    byMonths[byMonths.length - 1],
  ];
  const unique: Basket[] = [];
  for (const pick of picks) {
    if (
      pick &&
      !unique.some((entry) => entry.plan.id === pick.plan.id && entry.months === pick.months)
    ) {
      unique.push(pick);
    }
  }
  return unique;
}

function SidePreview({ form, plans }: { form: PromotionForm; plans: readonly AdminPlan[] }) {
  const planNames = plans
    .filter((plan) => form.planIds.includes(plan.id))
    .map((plan) => plan.nameAr);
  const rule = ruleFromForm(form, planNames);
  const basket = exampleBaskets(plans, form.planIds)[0];
  const after = basket ? estimateAfterMinor(rule, basket.listMinor, "EGP") : null;
  return (
    <Card
      elevation="flat"
      className="flex flex-col gap-3"
      aria-label={t("admin.pricing.promo.preview")}
    >
      <h3 className="font-heading text-lg font-semibold">{t("admin.pricing.promo.preview")}</h3>
      {basket && after !== null ? (
        <div className="flex flex-col gap-2">
          <p className="text-base font-semibold">
            {basket.plan.nameAr}
            {form.badgeAr.trim() ? (
              <Badge tone="success" className="ms-2">
                {form.badgeAr}
              </Badge>
            ) : null}
          </p>
          <PriceTag
            amountMinor={after}
            currency="EGP"
            struckMinor={after < basket.listMinor ? basket.listMinor : null}
            size="lg"
            suffix={t("admin.pricing.promo.previewFor", { months: basket.months })}
          />
          <p className="text-sm text-text-muted">{t("admin.pricing.promo.previewNote")}</p>
        </div>
      ) : (
        <p className="text-base text-text-muted">{t("admin.pricing.promo.previewEmpty")}</p>
      )}
      <RuleSentence rule={rule} />
    </Card>
  );
}

function Review({
  form,
  plans,
  assumptions,
}: {
  form: PromotionForm;
  plans: readonly AdminPlan[];
  assumptions: MarginAssumptions;
}) {
  const planNames = plans
    .filter((plan) => form.planIds.includes(plan.id))
    .map((plan) => plan.nameAr);
  const rule = ruleFromForm(form, planNames);
  const baskets = useMemo(() => exampleBaskets(plans, form.planIds), [plans, form.planIds]);
  const [results, setResults] = useState<Record<string, SimulationResult | "error">>({});

  useEffect(() => {
    let active = true;
    for (const basket of baskets) {
      const months = MONTH_CHOICES.find((value) => value === basket.months);
      if (!months) continue;
      simulate({ planKey: basket.plan.key, months, currency: "EGP" }).then(
        (value) => {
          if (active)
            setResults((current) => ({
              ...current,
              [`${basket.plan.key}-${String(basket.months)}`]: value,
            }));
        },
        () => {
          if (active)
            setResults((current) => ({
              ...current,
              [`${basket.plan.key}-${String(basket.months)}`]: "error",
            }));
        },
      );
    }
    return () => {
      active = false;
    };
  }, [baskets]);

  return (
    <div className="flex flex-col gap-4">
      <RuleSentence rule={rule} />
      <p className="text-base text-text-muted">{t("admin.pricing.promo.review.lead")}</p>
      {baskets.length === 0 ? (
        <p className="text-base text-text-muted">{t("admin.pricing.promo.review.noBaskets")}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {baskets.map((basket) => {
            const key = `${basket.plan.key}-${String(basket.months)}`;
            const result = results[key];
            const after = estimateAfterMinor(rule, basket.listMinor, "EGP");
            const margin = planMargin({
              amountMinor: after,
              months: basket.months,
              currency: "EGP",
              monthlyCredits: basket.plan.monthlyCredits,
              costPerCreditUsdMicros: basket.plan.marginInputs.costPerCreditUsdMicros,
              fxUsdToEgp: basket.plan.marginInputs.fxUsdToEgp,
              taxMode: assumptions.taxMode,
              taxRateBps: assumptions.taxRateBps,
              feeBps: assumptions.feeBps,
            });
            return (
              <li
                key={key}
                className="flex flex-col gap-3 rounded-lg border border-border p-4"
                data-testid="basket"
              >
                <p className="text-base font-semibold">
                  {t("admin.pricing.promo.review.basket", {
                    plan: basket.plan.nameAr,
                    months: basket.months,
                  })}
                </p>
                <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-base">
                  <span>
                    {t("admin.pricing.promo.review.before", {
                      amount: moneyText(basket.listMinor, "EGP"),
                    })}
                  </span>
                  <span className="font-semibold">
                    {t("admin.pricing.promo.review.after", { amount: moneyText(after, "EGP") })}
                  </span>
                </p>
                {margin?.warn ? (
                  <p role="alert" className="flex items-center gap-2 text-base text-warning">
                    <TriangleAlert aria-hidden className="size-5 shrink-0" />
                    {t("admin.pricing.promo.review.marginWarn", {
                      percent: (margin.marginBps / 100).toFixed(0),
                    })}
                  </p>
                ) : null}
                {result && result !== "error" ? (
                  <SimulationResultView result={result} subject={basket.plan.nameAr} />
                ) : result === "error" ? (
                  <p className="text-sm text-text-muted">
                    {t("admin.pricing.promo.review.simFailed")}
                  </p>
                ) : (
                  <p className="text-sm text-text-muted">{t("admin.revenue.sim.loading")}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Four steps to a promotion (ADMIN-CONSOLE-SPEC §5.2): what, where, when and how much, review. A
 * plain-language sentence and a pricing-page preview stay on screen; the last step shows the
 * engine's current price of three example baskets, what this promotion would take off (an estimate)
 * and a warning when a basket would fall under the margin floor. It is saved as a draft, or saved
 * and published (publishing asks for fresh auth).
 */
export function PromotionWizard({
  plans,
  taxRules,
  methods,
  onClose,
  onCreated,
  canPublish,
}: PromotionWizardProps) {
  const { toast } = useToast();
  const reauth = useReauth();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<PromotionForm>(emptyPromotionForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const assumptions = marginAssumptions(taxRules, methods);
  const patch = (change: Partial<PromotionForm>) => {
    setForm((current) => ({ ...current, ...change }));
  };
  const built = promotionBody(form);
  const failing = built.ok ? [] : built.errors;
  const stepFields: Record<(typeof STEPS)[number], string[]> = {
    what: ["name", "titleAr", "titleEn", "value", "kind", "currency", "badgeAr", "badgeEn"],
    where: ["planIds", "months", "audience", "countries", "minAmount", "minAmountMinor"],
    when: [
      "startsAt",
      "endsAt",
      "maxRedemptions",
      "perOwnerLimit",
      "showCountdown",
      "stacking",
      "priority",
    ],
    review: [],
  };
  const stepName = STEPS[step] ?? "what";
  const stepInvalid = failing.some((path) =>
    stepFields[stepName].includes(path.split(".")[0] ?? ""),
  );
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const create = (publish: boolean) => {
    if (busy || !built.ok) return;
    setBusy(true);
    setError(null);
    const body = built.body;
    api("/admin/billing/promotions", { method: "POST", body, schema: createdSchema })
      .then(async ({ id }) => {
        if (publish) {
          await reauth.run(() =>
            api(`/admin/billing/promotions/${id}/publish`, { method: "POST" }),
          );
        }
      })
      .then(
        () => {
          setBusy(false);
          toast({
            tone: "success",
            title: t(publish ? "admin.pricing.promo.published" : "admin.pricing.promo.saved", {
              name: form.name,
            }),
          });
          onCreated();
        },
        (failure: unknown) => {
          setBusy(false);
          setError(toApiError(failure));
        },
      );
  };

  const text = (
    name: keyof PromotionForm,
    label: string,
    options: { ltr?: boolean; hint?: string; type?: string } = {},
  ) => (
    <Field
      label={label}
      hint={options.hint}
      error={
        showErrors && failing.includes(name) ? t("admin.pricing.promo.fieldInvalid") : undefined
      }
    >
      {(control) => (
        <Input
          {...control}
          name={name}
          ltr={options.ltr}
          type={options.type ?? "text"}
          value={String(form[name])}
          onChange={(event) => {
            patch({ [name]: event.target.value } as Partial<PromotionForm>);
          }}
        />
      )}
    </Field>
  );

  const body =
    stepName === "what" ? (
      <div className="flex flex-col gap-4">
        {text("name", t("admin.pricing.promo.name"), { hint: t("admin.pricing.promo.nameHint") })}
        <div className="grid gap-4 sm:grid-cols-2">
          {text("titleAr", t("admin.pricing.promo.titleAr"))}
          {text("titleEn", t("admin.pricing.promo.titleEn"), { ltr: true })}
          {text("badgeAr", t("admin.pricing.promo.badgeAr"))}
          {text("badgeEn", t("admin.pricing.promo.badgeEn"), { ltr: true })}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("admin.pricing.promo.kind")}>
            {(control) => (
              <Select
                {...control}
                name="kind"
                value={form.kind}
                onChange={(event) => {
                  const kind = KINDS.find((entry) => entry === event.target.value);
                  if (kind) patch({ kind });
                }}
              >
                {KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`admin.pricing.promo.kind.${kind}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {text("value", t(`admin.pricing.promo.value.${form.kind}`), { ltr: true })}
          {form.kind === "fixed"
            ? text("currency", t("admin.pricing.promo.currency"), { ltr: true })
            : null}
        </div>
      </div>
    ) : stepName === "where" ? (
      <div className="flex flex-col gap-4">
        <Group legend={t("admin.pricing.promo.plans")}>
          {plans.map((plan) => (
            <Checkbox
              key={plan.id}
              label={plan.nameAr}
              checked={form.planIds.includes(plan.id)}
              onChange={() => {
                patch({ planIds: toggle(form.planIds, plan.id) });
              }}
            />
          ))}
        </Group>
        <p className="text-sm text-text-muted">{t("admin.pricing.promo.plansHint")}</p>
        <Group legend={t("admin.pricing.promo.months")}>
          {MONTH_CHOICES.map((months) => (
            <Checkbox
              key={months}
              label={t("admin.pricing.matrix.months", { count: months })}
              checked={form.months.includes(months)}
              onChange={() => {
                patch({ months: toggle(form.months, months).sort((a, b) => a - b) });
              }}
            />
          ))}
        </Group>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("admin.pricing.promo.audience")}>
            {(control) => (
              <Select
                {...control}
                name="audience"
                value={form.audience}
                onChange={(event) => {
                  const audience = (["any", "individual", "organization"] as const).find(
                    (entry) => entry === event.target.value,
                  );
                  if (audience) patch({ audience });
                }}
              >
                <option value="any">{t("admin.pricing.plan.audience.any")}</option>
                <option value="individual">{t("admin.pricing.plan.audience.individual")}</option>
                <option value="organization">
                  {t("admin.pricing.plan.audience.organization")}
                </option>
              </Select>
            )}
          </Field>
          {text("countries", t("admin.pricing.promo.countries"), {
            ltr: true,
            hint: t("admin.pricing.promo.countriesHint"),
          })}
          {text("minAmount", t("admin.pricing.promo.minAmount"), { ltr: true })}
        </div>
        <Checkbox
          label={t("admin.pricing.promo.newOnly")}
          checked={form.newCustomersOnly}
          onChange={(event) => {
            patch({ newCustomersOnly: event.target.checked });
          }}
        />
      </div>
    ) : stepName === "when" ? (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-muted">
          {t("admin.pricing.promo.timeZone", { zone: timeZone })}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {text("startsAt", t("admin.pricing.promo.startsAt"), {
            ltr: true,
            type: "datetime-local",
          })}
          {text("endsAt", t("admin.pricing.promo.endsAt"), { ltr: true, type: "datetime-local" })}
          {text("maxRedemptions", t("admin.pricing.promo.max"), { ltr: true })}
          {text("perOwnerLimit", t("admin.pricing.promo.perOwner"), { ltr: true })}
          {text("priority", t("admin.pricing.promo.priority"), { ltr: true })}
          <Field label={t("admin.pricing.promo.stacking")}>
            {(control) => (
              <Select
                {...control}
                name="stacking"
                value={form.stacking}
                onChange={(event) => {
                  patch({
                    stacking:
                      event.target.value === "stack_with_other" ? "stack_with_other" : "exclusive",
                  });
                }}
              >
                <option value="exclusive">{t("admin.pricing.promo.stacking.exclusive")}</option>
                <option value="stack_with_other">{t("admin.pricing.promo.stacking.stack")}</option>
              </Select>
            )}
          </Field>
        </div>
        <Checkbox
          label={t("admin.pricing.promo.showOnPricing")}
          checked={form.showOnPricing}
          onChange={(event) => {
            patch({ showOnPricing: event.target.checked });
          }}
        />
        <Checkbox
          label={t("admin.pricing.promo.showCountdown")}
          checked={form.showCountdown}
          onChange={(event) => {
            patch({ showCountdown: event.target.checked });
          }}
        />
        {form.showCountdown && form.endsAt.trim() === "" ? (
          <p role="alert" className="text-sm text-danger">
            {t("admin.pricing.promo.countdownNeedsEnd")}
          </p>
        ) : null}
      </div>
    ) : (
      <Review form={form} plans={plans} assumptions={assumptions} />
    );

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Card elevation="flat" className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-xl font-semibold">{t("admin.pricing.promo.wizard")}</h2>
          <p aria-live="polite" className="text-sm text-text-muted">
            {t("admin.pricing.promo.step", { step: step + 1, total: STEPS.length })}
            {" · "}
            {t(`admin.pricing.promo.steps.${stepName}`)}
          </p>
        </div>
        {body}
        {error ? <ErrorNotice error={error} /> : null}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <Button variant="ghost" name="wizard-cancel" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <div className="flex flex-wrap gap-3">
            {step > 0 ? (
              <Button
                variant="secondary"
                name="wizard-back"
                onClick={() => {
                  setStep(step - 1);
                }}
              >
                <ArrowLeft aria-hidden className="size-5 rtl:-scale-x-100" />
                {t("admin.pricing.promo.back")}
              </Button>
            ) : null}
            {step < STEPS.length - 1 ? (
              <Button
                name="wizard-next"
                onClick={() => {
                  if (stepInvalid) {
                    setShowErrors(true);
                    return;
                  }
                  setShowErrors(false);
                  setStep(step + 1);
                }}
              >
                {t("admin.pricing.promo.next")}
              </Button>
            ) : (
              <>
                <Button
                  variant="secondary"
                  name="save-draft"
                  loading={busy}
                  disabled={!built.ok}
                  onClick={() => {
                    create(false);
                  }}
                >
                  {t("admin.pricing.promo.saveDraft")}
                </Button>
                {canPublish ? (
                  <Button
                    name="save-publish"
                    loading={busy}
                    disabled={!built.ok}
                    onClick={() => {
                      create(true);
                    }}
                  >
                    {t("admin.pricing.promo.publish")}
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </div>
      </Card>
      <SidePreview form={form} plans={plans} />
    </div>
  );
}
