"use client";

import { t } from "@wasfa/shared/i18n/public";
import {
  couponCodeSchema,
  type CatalogResponse,
  type QuoteResponse,
} from "@wasfa/shared/schemas/billing";
import {
  Button,
  CheckoutSummary,
  Field,
  Input,
  MethodPicker,
  buttonStyles,
  moneyText,
  periodLabel,
  type MethodOption,
} from "@wasfa/ui";
import { ShieldCheck, TicketPercent } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { createOrder, requestQuote } from "../../lib/billing-api";
import { previewForMethod, summaryFromQuote } from "../../lib/checkout-summary";
import { type CheckoutTarget } from "../../lib/checkout-target";
import { formatDate } from "../../lib/dates";
import { trackGrowth } from "../../lib/growth-events";
import { ErrorNotice } from "../error-notice";
import { Notice } from "../notice";

type CatalogMethod = CatalogResponse["methods"][number];

export interface CheckoutFormProps {
  target: CheckoutTarget;
  /** The quote the server rendered, priced with `initialMethodKey`. */
  initial: QuoteResponse;
  initialMethodKey: string | null;
  methods: readonly CatalogMethod[];
  /** Plan or pack name, as the catalog (or the subscription) calls it. */
  subjectName: string;
  currency: string;
  refundWindowDays: number;
  reviewSlaMinutes: number;
  /** Buying for this organization (`?org=`); absent = the personal account. */
  orgId?: string | undefined;
}

type Pending = "method" | "coupon" | "pay" | null;
type Feedback = { tone: "success" | "info" | "danger"; message: string } | null;

function feeText(feeMinor: number, currency: string): string {
  return feeMinor > 0 ? `+ ${moneyText(feeMinor, currency)}` : t("billing.method.noFee");
}

/**
 * The checkout step before the order exists (BILLING §6.2). The summary arrives complete from the
 * server; changing the method moves the total at once from the quote's own `methodOptions` and is
 * then confirmed by a fresh quote. Pay re-quotes first and creates the order only if the total is
 * still the one on the button, so nothing changes after the click.
 */
export function CheckoutForm({
  target,
  initial,
  initialMethodKey,
  methods,
  subjectName,
  currency: initialCurrency,
  refundWindowDays,
  reviewSlaMinutes,
  orgId,
}: CheckoutFormProps) {
  const router = useRouter();
  const [quote, setQuote] = useState(initial);
  const [methodKey, setMethodKey] = useState(initialMethodKey);
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const latest = useRef(0);

  const currency = quote.quote.currency || initialCurrency;
  const free = quote.quote.isFreeOrder;
  const subject =
    target.kind === "pack" ? subjectName : `${subjectName} · ${periodLabel(quote.quote.months)}`;
  const preview =
    methodKey && methodKey !== quote.quote.methodKey
      ? previewForMethod(quote.quote, subject, methodKey)
      : null;
  const model = preview ?? summaryFromQuote(quote.quote, subject);
  const busy = pending !== null;
  const canCoupon = target.kind === "plan";

  const options: MethodOption[] = methods.map((method) => {
    const row = quote.quote.methodOptions.find((candidate) => candidate.key === method.key);
    return {
      key: method.key,
      label: method.names.ar,
      feeText: row ? feeText(row.feeMinor, currency) : "",
      disabled: !row?.available,
      hint: !row?.available
        ? t("billing.method.unavailable")
        : method.kind === "manual"
          ? t("billing.method.hint.manual", { minutes: reviewSlaMinutes })
          : t("billing.method.hint.gateway"),
    };
  });

  async function requote(next: {
    method: string | null;
    code: string | null;
  }): Promise<QuoteResponse> {
    return requestQuote(target, {
      methodKey: next.method ?? undefined,
      couponCode: next.code ?? undefined,
      currency,
      orgId,
    });
  }

  async function chooseMethod(key: string) {
    if (pending === "pay" || pending === "coupon" || key === methodKey) return;
    const previewTotal = previewForMethod(quote.quote, subject, key)?.totalMinor;
    trackGrowth("method_selected", { method: key });
    setMethodKey(key);
    setError(null);
    setNotice(null);
    setPending("method");
    const mine = ++latest.current;
    try {
      const fresh = await requote({ method: key, code: coupon });
      if (mine !== latest.current) return;
      setQuote(fresh);
      if (previewTotal !== undefined && previewTotal !== fresh.quote.totalMinor) {
        setNotice(t("billing.checkout.totalUpdated"));
      }
    } catch (failure) {
      if (mine === latest.current) setError(failure);
    } finally {
      if (mine === latest.current) setPending(null);
    }
  }

  async function applyCoupon() {
    const parsed = couponCodeSchema.safeParse(couponInput);
    setError(null);
    setNotice(null);
    if (!parsed.success) {
      setFeedback({ tone: "danger", message: t("billing.coupon.invalid") });
      return;
    }
    setPending("coupon");
    try {
      const fresh = await requote({ method: methodKey, code: parsed.data });
      const outcome = fresh.coupon;
      setQuote(fresh);
      if (outcome?.status === "applied") {
        setCoupon(parsed.data);
        setFeedback({
          tone: "success",
          message: t("billing.coupon.applied", { code: parsed.data }),
        });
      } else if (outcome?.status === "not_applied") {
        setCoupon(null);
        setFeedback({ tone: "info", message: t("billing.coupon.notApplied") });
      } else {
        setCoupon(null);
        setFeedback({
          tone: "danger",
          message: outcome?.startsAt
            ? t("billing.coupon.startsAt", { date: formatDate(outcome.startsAt) })
            : t("billing.coupon.invalid"),
        });
      }
    } catch (failure) {
      setError(failure);
    } finally {
      setPending(null);
    }
  }

  async function removeCoupon() {
    setPending("coupon");
    setError(null);
    try {
      setQuote(await requote({ method: methodKey, code: null }));
      setCoupon(null);
      setCouponInput("");
      setFeedback(null);
    } catch (failure) {
      setError(failure);
    } finally {
      setPending(null);
    }
  }

  async function pay() {
    if (busy || (!free && !methodKey)) return;
    const shown = model.buttonTotalMinor;
    setPending("pay");
    setError(null);
    setNotice(null);
    try {
      // The order needs a quote priced with this very method, and the person is owed the total
      // that is on the button: confirm both before anything is created.
      const fresh = await requote({ method: methodKey, code: coupon });
      if (fresh.quote.display.buttonTotalMinor !== shown) {
        setQuote(fresh);
        setNotice(t("billing.checkout.priceChanged"));
        setPending(null);
        return;
      }
      setQuote(fresh);
      const order = await createOrder(fresh.quoteId, methodKey ?? undefined, orgId);
      if (order.redirectUrl) {
        window.location.assign(order.redirectUrl);
      } else {
        router.push(`/checkout/${order.orderId}`);
      }
    } catch (failure) {
      setError(failure);
      setPending(null);
    }
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void pay();
      }}
    >
      <section
        aria-labelledby="summary-title"
        className="flex flex-col gap-4 rounded-xl border border-border/60 bg-surface p-5 shadow-card sm:p-6"
      >
        <h2 id="summary-title" className="font-heading text-xl font-bold text-text">
          {t("billing.summary.title")}
        </h2>
        {quote.target.kind === "upgrade" ? (
          <p className="text-base text-text-muted">{t("billing.checkout.upgradeLead")}</p>
        ) : null}
        <CheckoutSummary
          currency={currency}
          lines={model.lines}
          perks={model.perks}
          fee={model.fee}
          totalMinor={model.totalMinor}
          updating={pending === "method" || pending === "coupon"}
        />
      </section>

      {canCoupon ? (
        <section aria-labelledby="coupon-title" className="flex flex-col gap-2">
          <h2 id="coupon-title" className="font-heading text-lg font-bold text-text">
            {t("billing.coupon.title")}
          </h2>
          <div className="flex items-start gap-2">
            <Field
              label={t("billing.coupon.label")}
              className="flex-1"
              {...(feedback?.tone === "danger" ? { error: feedback.message } : {})}
            >
              {(control) => (
                <Input
                  {...control}
                  ltr
                  name="coupon"
                  autoComplete="off"
                  autoCapitalize="characters"
                  value={couponInput}
                  disabled={busy || coupon !== null}
                  startIcon={<TicketPercent className="size-5" />}
                  onChange={(event) => {
                    setCouponInput(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void applyCoupon();
                    }
                  }}
                />
              )}
            </Field>
            {coupon ? (
              <Button
                variant="ghost"
                className="mt-8"
                disabled={busy}
                onClick={() => {
                  void removeCoupon();
                }}
              >
                {t("billing.coupon.remove")}
              </Button>
            ) : (
              <Button
                variant="secondary"
                className="mt-8"
                loading={pending === "coupon"}
                disabled={busy || couponInput.trim() === ""}
                onClick={() => {
                  void applyCoupon();
                }}
              >
                {t("billing.coupon.apply")}
              </Button>
            )}
          </div>
          {feedback && feedback.tone !== "danger" ? (
            <p
              role="status"
              className={
                feedback.tone === "success"
                  ? "text-base font-semibold text-success"
                  : "text-base text-text-muted"
              }
            >
              {feedback.message}
            </p>
          ) : null}
        </section>
      ) : null}

      {free ? null : (
        <MethodPicker
          legend={t("billing.method.title")}
          name="method"
          options={options}
          value={methodKey}
          disabled={pending === "pay" || pending === "coupon"}
          onChange={(key) => {
            void chooseMethod(key);
          }}
        />
      )}

      {methods.length === 0 && !free ? (
        <Notice tone="warning">{t("billing.method.none")}</Notice>
      ) : null}

      {notice ? <Notice tone="warning">{notice}</Notice> : null}
      {error ? <ErrorNotice error={error} /> : null}

      <div className="flex flex-col gap-3">
        <Button
          type="submit"
          size="lg"
          className="w-full"
          loading={pending === "pay"}
          disabled={busy || (!free && !methodKey)}
        >
          {free
            ? t("billing.checkout.activate")
            : t("billing.checkout.pay", { total: moneyText(model.buttonTotalMinor, currency) })}
        </Button>
        <p className="flex items-start gap-2 text-sm text-text-muted">
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
          <span>
            {t("billing.checkout.trust")}
            {refundWindowDays > 0
              ? ` ${t("billing.trust.refund", { days: refundWindowDays })}.`
              : ""}{" "}
            {t("billing.trust.noAutoRenew")}.
          </span>
        </p>
        <Link
          href="/pricing"
          className={buttonStyles({ variant: "ghost", className: "self-start" })}
        >
          {t("billing.checkout.backToPricing")}
        </Link>
      </div>
    </form>
  );
}
