"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n/public";
import { submitPaymentProofSchema } from "@wasfa/shared/schemas/manual-payment";
import { Button, CopyField, Field, Input, ProofUploader, buttonStyles, moneyText } from "@wasfa/ui";
import { Check, Circle, Clock, MessageCircle, TriangleAlert } from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";

import { submitProof, type ManualInstructions } from "../../lib/billing-api";
import { userTransportFor } from "../../lib/capture/transports";
import { createCaptureUploader } from "../../lib/capture/uploader";
import { formatDateTime } from "../../lib/dates";
import { ErrorNotice } from "../error-notice";
import { Notice } from "../notice";

const subscribeNone = (): (() => void) => () => undefined;
/** False while hydrating, true afterwards: times in the visitor's zone are drawn only then. */
function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeNone,
    () => true,
    () => false,
  );
}

const REJECT_KEYS: Record<string, MessageKey> = {
  amount_differs: "billing.reject.amount_differs",
  not_received: "billing.reject.not_received",
  unreadable_proof: "billing.reject.unreadable_proof",
  duplicate_proof: "billing.reject.duplicate_proof",
  wrong_reference: "billing.reject.wrong_reference",
  other: "billing.reject.other",
};

function ProofForm({
  paymentId,
  submissionsLeft,
  onSubmitted,
}: {
  paymentId: string;
  submissionsLeft: number;
  onSubmitted: () => void;
}) {
  const uploader = useMemo(() => createCaptureUploader(userTransportFor("payment_proof")), []);
  const [fileId, setFileId] = useState<string | null>(null);
  const [txnId, setTxnId] = useState("");
  const [senderPhone, setSenderPhone] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    txnId?: string;
    senderPhone?: string;
    file?: string;
  }>({});
  const [error, setError] = useState<unknown>(null);
  const [sending, setSending] = useState(false);

  async function submit() {
    setError(null);
    const parsed = submitPaymentProofSchema.safeParse({
      txnId,
      senderPhone,
      fileId: fileId ?? "",
    });
    if (!parsed.success) {
      const paths = new Set(parsed.error.issues.map((issue) => issue.path[0]));
      setFieldErrors({
        ...(paths.has("txnId") ? { txnId: t("billing.proof.txnInvalid") } : {}),
        ...(paths.has("senderPhone") ? { senderPhone: t("billing.proof.phoneInvalid") } : {}),
        ...(paths.has("fileId") ? { file: t("billing.proof.fileRequired") } : {}),
      });
      return;
    }
    setFieldErrors({});
    setSending(true);
    try {
      await submitProof(paymentId, parsed.data);
      onSubmitted();
    } catch (failure) {
      setError(failure);
      setSending(false);
    }
  }

  return (
    <form
      aria-labelledby="proof-title"
      className="flex flex-col gap-4 rounded-xl border border-border/60 bg-surface p-5 shadow-card sm:p-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-col gap-1">
        <h2 id="proof-title" className="font-heading text-xl font-bold text-text">
          {t("billing.proof.title")}
        </h2>
        <p className="text-sm text-text-muted">
          {t("billing.proof.attemptsLeft", { count: submissionsLeft })}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <ProofUploader uploader={uploader} onChange={setFileId} disabled={sending} />
        {fieldErrors.file ? (
          <p role="alert" className="text-sm text-danger">
            {fieldErrors.file}
          </p>
        ) : null}
      </div>
      <Field
        label={t("billing.proof.txnId")}
        hint={t("billing.proof.txnHint")}
        required
        error={fieldErrors.txnId}
      >
        {(control) => (
          <Input
            {...control}
            ltr
            name="txnId"
            autoComplete="off"
            value={txnId}
            onChange={(event) => {
              setTxnId(event.target.value);
            }}
          />
        )}
      </Field>
      <Field
        label={t("billing.proof.senderPhone")}
        hint={t("billing.proof.phoneHint")}
        required
        error={fieldErrors.senderPhone}
      >
        {(control) => (
          <Input
            {...control}
            ltr
            name="senderPhone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={senderPhone}
            onChange={(event) => {
              setSenderPhone(event.target.value);
            }}
          />
        )}
      </Field>
      {error ? <ErrorNotice error={error} /> : null}
      <Button type="submit" size="lg" loading={sending} disabled={sending}>
        {t("billing.proof.submit")}
      </Button>
    </form>
  );
}

function Timeline({ minutes }: { minutes: number }) {
  const steps = [
    { key: "sent", label: t("billing.timeline.sent"), state: "done" },
    { key: "review", label: t("billing.timeline.review", { minutes }), state: "current" },
    { key: "active", label: t("billing.timeline.active"), state: "next" },
  ] as const;
  return (
    <ol aria-label={t("billing.timeline.label")} className="flex flex-col gap-3">
      {steps.map((step) => (
        <li
          key={step.key}
          aria-current={step.state === "current" ? "step" : undefined}
          className="flex items-start gap-3 text-base"
        >
          <span
            aria-hidden
            className={
              step.state === "done"
                ? "mt-0.5 inline-flex size-6 items-center justify-center rounded-full bg-success text-on-primary"
                : step.state === "current"
                  ? "mt-0.5 inline-flex size-6 items-center justify-center rounded-full bg-primary text-on-primary"
                  : "mt-0.5 inline-flex size-6 items-center justify-center rounded-full border border-neutral-400 text-neutral-500"
            }
          >
            {step.state === "done" ? (
              <Check className="size-4" />
            ) : step.state === "current" ? (
              <Clock className="size-4" />
            ) : (
              <Circle className="size-3" />
            )}
          </span>
          <span
            className={step.state === "current" ? "font-semibold text-text" : "text-text-muted"}
          >
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

export interface ManualPaymentProps {
  instructions: ManualInstructions;
  paymentId: string;
  number: string;
  supportHref: string | null;
  /** The payment changed (a proof was sent): read the order again. */
  onChanged: () => void;
}

/**
 * The manual transfer flow after the order exists: what to send and where (amount, account,
 * reference, expiry), the proof form, then the review timeline, a rejection with its reason and the
 * way to send a better proof while attempts remain.
 */
export function ManualPayment({
  instructions,
  paymentId,
  number,
  supportHref,
  onChanged,
}: ManualPaymentProps) {
  const mounted = useMounted();
  const reviewing =
    instructions.status === "awaiting_review" || instructions.status === "awaiting_second_approval";
  const rejected = instructions.status === "rejected";
  const canSend = !reviewing && instructions.submissionsLeft > 0;

  return (
    <div className="flex flex-col gap-6">
      {reviewing ? (
        <section
          aria-labelledby="review-title"
          className="flex flex-col gap-4 rounded-xl border border-primary/30 bg-primary-soft p-5 sm:p-6"
        >
          <h2 id="review-title" className="font-heading text-xl font-bold text-primary">
            {t("billing.manual.submittedTitle")}
          </h2>
          <p role="status" className="text-base text-text">
            {t("billing.manual.submittedBody")}
          </p>
          <Timeline minutes={instructions.reviewSlaMinutes} />
        </section>
      ) : null}

      {rejected ? (
        <section
          aria-labelledby="rejected-title"
          className="flex flex-col gap-2 rounded-xl border border-danger/30 bg-danger-soft p-5 sm:p-6"
        >
          <h2
            id="rejected-title"
            className="flex items-center gap-2 font-heading text-xl font-bold text-danger"
          >
            <TriangleAlert aria-hidden className="size-5" />
            {t("billing.manual.rejectedTitle")}
          </h2>
          <p role="alert" className="text-base text-text" data-testid="reject-reason">
            {instructions.rejectReason
              ? t(REJECT_KEYS[instructions.rejectReason] ?? "billing.reject.other")
              : t("billing.reject.other")}
          </p>
          <p className="text-base text-text">
            {canSend
              ? t("billing.manual.rejectedResend", { count: instructions.submissionsLeft })
              : t("billing.manual.rejectedNoMore")}
          </p>
          {!canSend && supportHref ? (
            <a
              href={supportHref}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonStyles({ variant: "secondary", className: "self-start" })}
            >
              <MessageCircle aria-hidden className="size-4" />
              {t("billing.help.whatsapp")}
            </a>
          ) : null}
        </section>
      ) : null}

      <section
        aria-labelledby="instructions-title"
        className="flex flex-col gap-4 rounded-xl border border-border/60 bg-surface p-5 shadow-card sm:p-6"
      >
        <h2 id="instructions-title" className="font-heading text-xl font-bold text-text">
          {t("billing.manual.title", { method: instructions.method.nameAr })}
        </h2>
        <p className="whitespace-pre-line text-base text-text">{instructions.instructionsAr}</p>
        <dl className="flex flex-col gap-1">
          <dt className="text-sm font-semibold text-text-muted">{t("billing.manual.amount")}</dt>
          <dd
            data-testid="manual-amount"
            className="font-heading text-3xl font-bold tabular-nums text-text"
          >
            <bdi>{moneyText(instructions.amountMinor, instructions.currency)}</bdi>
          </dd>
        </dl>
        <CopyField label={t("billing.manual.account")} value={instructions.accountDisplay} />
        {instructions.accountHolder ? (
          <p className="text-base text-text">
            {t("billing.manual.holder", { name: instructions.accountHolder })}
          </p>
        ) : null}
        <CopyField label={t("billing.manual.reference")} value={instructions.reference} />
        <p className="text-sm text-text-muted">
          {mounted
            ? t("billing.manual.expires", { time: formatDateTime(instructions.expiresAt) })
            : ""}
        </p>
        <p className="text-sm text-text-muted">
          {t("billing.manual.sla", { minutes: instructions.reviewSlaMinutes })} ·{" "}
          {t("billing.order.number", { number })}
        </p>
      </section>

      {canSend ? (
        <ProofForm
          paymentId={paymentId}
          submissionsLeft={instructions.submissionsLeft}
          onSubmitted={onChanged}
        />
      ) : null}

      {!reviewing && !rejected && instructions.submissionsLeft === 0 ? (
        <Notice tone="warning">{t("billing.manual.rejectedNoMore")}</Notice>
      ) : null}
    </div>
  );
}
