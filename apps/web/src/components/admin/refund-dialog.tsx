"use client";

import { t } from "@wasfa/shared/i18n";
import { fromMinor, toMinor } from "@wasfa/shared/money";
import { Field, Input, Skeleton, moneyText, useToast } from "@wasfa/ui";
import { CircleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  refundPreviewSchema,
  type PaymentRecord,
  type RefundPreview,
} from "../../lib/admin-billing-schemas";
import { formatShortDate } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { ErrorNotice } from "../error-notice";

import { ReasonDialog } from "./reason-dialog";

const PREVIEW_DEBOUNCE_MS = 300;

/** What is still refundable: the paid amount minus refunds that are asked, approved or done. */
export function refundableOf(record: PaymentRecord): number {
  const spent = record.refunds
    .filter((refund) => !["failed", "rejected"].includes(refund.status))
    .reduce((sum, refund) => sum + refund.amountMinor, 0);
  return Math.max(0, record.payment.amountMinor - spent);
}

/** The typed amount (major units) as minor units, or `null` when it is not a usable amount. */
export function parseRefundAmount(text: string, currency: string): number | null {
  try {
    const minor = toMinor(text.trim(), currency);
    return minor > 0 ? minor : null;
  } catch {
    return null;
  }
}

type PreviewState =
  | { status: "idle" }
  | { status: "loading"; amountMinor: number }
  | { status: "ready"; amountMinor: number; preview: RefundPreview }
  | { status: "error"; amountMinor: number; error: unknown };

function Consequences({
  preview,
  clawback,
  onClawback,
}: {
  preview: RefundPreview;
  clawback: string;
  onClawback: (value: string) => void;
}) {
  const subscription = preview.subscription;
  const clawbackNumber = Number(clawback);
  const clawbackInvalid =
    clawback.trim() === "" ||
    !Number.isInteger(clawbackNumber) ||
    clawbackNumber < 0 ||
    clawbackNumber > preview.maxClawback;
  return (
    <section
      aria-label={t("admin.revenue.refund.consequences")}
      className="flex flex-col gap-3 rounded-lg border border-border bg-neutral-50 p-4"
      data-testid="refund-consequences"
    >
      <h3 className="font-heading text-lg font-semibold">
        {t("admin.revenue.refund.consequences")}
      </h3>
      <ul className="flex flex-col gap-2 text-base">
        <li>
          {preview.full
            ? t("admin.revenue.refund.fullNote")
            : t("admin.revenue.refund.partialNote", {
                amount: moneyText(preview.refundableMinor, preview.currency),
              })}
        </li>
        <li>
          {subscription
            ? t(`admin.revenue.refund.effect.${subscription.effect}`, {
                plan: subscription.planKey ?? "",
                date: subscription.newPeriodEnd ? formatShortDate(subscription.newPeriodEnd) : "",
              })
            : t("admin.revenue.refund.noSubscription")}
        </li>
        <li>
          {t("admin.revenue.refund.credits", {
            granted: preview.creditsGranted,
            used: preview.creditsUsed,
          })}
        </li>
        <li>{t("admin.revenue.refund.rewards", { count: preview.rewardsToReverse })}</li>
        {preview.couponKept ? <li>{t("admin.revenue.refund.couponKept")}</li> : null}
      </ul>
      <Field
        label={t("admin.revenue.refund.clawback")}
        hint={t("admin.revenue.refund.clawbackHint", { max: preview.maxClawback })}
        error={
          clawbackInvalid
            ? t("admin.revenue.refund.clawbackInvalid", { max: preview.maxClawback })
            : undefined
        }
      >
        {(control) => (
          <Input
            {...control}
            name="clawbackCredits"
            ltr
            inputMode="numeric"
            value={clawback}
            onChange={(event) => {
              onClawback(event.target.value);
            }}
          />
        )}
      </Field>
    </section>
  );
}

export interface RefundDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: PaymentRecord;
  onDone: () => void;
}

/**
 * Issue a refund (BILLING §7.4): the amount (the full refundable by default, partial allowed), the
 * consequences the API reports for exactly that amount - shown BEFORE the confirm button works -
 * the credits to claw back (bounded by what is unused), the external transfer reference and a reason.
 */
export function RefundDialog({ open, onOpenChange, record, onDone }: RefundDialogProps) {
  const { toast } = useToast();
  const { currency } = record.payment;
  const refundable = useMemo(() => refundableOf(record), [record]);
  const [amount, setAmount] = useState(() => fromMinor(refundable, currency));
  const [reference, setReference] = useState("");
  const [clawback, setClawback] = useState("0");
  const [state, setState] = useState<PreviewState>({ status: "idle" });
  const amountMinor = parseRefundAmount(amount, currency);

  useEffect(() => {
    if (!open) return;
    setAmount(fromMinor(refundable, currency));
    setReference("");
    setClawback("0");
  }, [open, refundable, currency]);

  useEffect(() => {
    if (!open || amountMinor === null || amountMinor > refundable) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "loading", amountMinor });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api(`/admin/billing/payments/${record.payment.id}/refund/preview`, {
        method: "POST",
        body: { amountMinor },
        schema: refundPreviewSchema,
        signal: controller.signal,
      }).then(
        (preview) => {
          setState({ status: "ready", amountMinor, preview });
          // Unused credits are the natural default: the refund takes back what was not spent.
          setClawback(String(preview.maxClawback));
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          setState({ status: "error", amountMinor, error });
        },
      );
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, amountMinor, refundable, record.payment.id]);

  const current =
    state.status === "ready" && state.amountMinor === amountMinor ? state.preview : null;
  const clawbackNumber = Number(clawback);
  const clawbackValid =
    current !== null &&
    clawback.trim() !== "" &&
    Number.isInteger(clawbackNumber) &&
    clawbackNumber >= 0 &&
    clawbackNumber <= current.maxClawback;
  const amountError =
    amountMinor === null
      ? t("admin.revenue.refund.amountInvalid")
      : amountMinor > refundable
        ? t("admin.revenue.refund.amountTooHigh", { max: moneyText(refundable, currency) })
        : undefined;
  const canSubmit = current !== null && clawbackValid && reference.trim() !== "";

  return (
    <ReasonDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("admin.revenue.refund.title", { number: record.order.number })}
      effect={t("admin.revenue.refund.effect", {
        amount: amountMinor === null ? "—" : moneyText(amountMinor, currency),
      })}
      confirmLabel={t("admin.revenue.refund.confirm")}
      tone="danger"
      canSubmit={canSubmit}
      onConfirm={async (reason) => {
        if (amountMinor === null || current === null) return;
        await api(`/admin/billing/payments/${record.payment.id}/refund`, {
          method: "POST",
          body: {
            amountMinor,
            reason,
            transferReference: reference.trim(),
            clawbackCredits: clawbackNumber,
          },
        });
        toast({ tone: "success", title: t("admin.revenue.refund.done") });
        onDone();
      }}
    >
      <Field
        label={t("admin.revenue.refund.amount", { currency })}
        hint={t("admin.revenue.refund.amountHint", { max: moneyText(refundable, currency) })}
        required
        error={amountError}
      >
        {(control) => (
          <Input
            {...control}
            name="amount"
            ltr
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
          />
        )}
      </Field>
      {state.status === "loading" && amountError === undefined ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <p className="sr-only" role="status">
            {t("admin.revenue.refund.loadingPreview")}
          </p>
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      ) : null}
      {state.status === "error" && amountError === undefined ? (
        <ErrorNotice error={state.error} />
      ) : null}
      {current ? (
        <Consequences preview={current} clawback={clawback} onClawback={setClawback} />
      ) : amountError === undefined && state.status !== "error" ? null : (
        <p className="flex items-center gap-2 text-sm text-text-muted">
          <CircleAlert aria-hidden className="size-4" />
          {t("admin.revenue.refund.previewFirst")}
        </p>
      )}
      <Field
        label={t("admin.revenue.refund.reference")}
        hint={t("admin.revenue.refund.referenceHint")}
        required
      >
        {(control) => (
          <Input
            {...control}
            name="transferReference"
            ltr
            autoComplete="off"
            value={reference}
            onChange={(event) => {
              setReference(event.target.value);
            }}
          />
        )}
      </Field>
    </ReasonDialog>
  );
}
