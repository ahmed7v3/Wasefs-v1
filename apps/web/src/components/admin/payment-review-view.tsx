"use client";

import { PAYMENT_REJECT_REASONS } from "@wasfa/shared/billing";
import { t } from "@wasfa/shared/i18n";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  CopyField,
  Dialog,
  Field,
  Select,
  Skeleton,
  Textarea,
  moneyText,
  periodLabel,
  useToast,
} from "@wasfa/ui";
import {
  CircleAlert,
  CircleCheck,
  Clock,
  HelpCircle,
  Lock,
  SkipForward,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

import {
  methodListSchema,
  reviewDecisionSchema,
  reviewDetailSchema,
  reviewPageSchema,
  type ReviewDetail,
  type ReviewItem,
} from "../../lib/admin-billing-schemas";
import { durationText, flagText } from "../../lib/admin-revenue";
import { api } from "../../lib/api-client";
import { ApiRequestError, errorReason } from "../../lib/api-error";
import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { useCursorList, useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import { ConfirmDialog } from "./confirm-dialog";
import { EmptyHint } from "./empty-hint";
import { ProofViewer } from "./proof-viewer";
import { QueueLayout } from "./queue-layout";
import { useOpenRecord } from "./record-drawer";
import { ResourceBoundary } from "./resource-boundary";

import type { FormEvent } from "react";

const CLAIM_DELAY_MS = 800;
const TICK_MS = 30_000;

/** The four-eyes threshold, when this admin may read the setting; `null` hides the second-approval hint. */
function useFourEyesThreshold(): number | null {
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api("/admin/settings", {
      schema: z.object({ items: z.array(z.object({ key: z.string(), value: z.unknown() })) }),
      signal: controller.signal,
    }).then(
      (settings) => {
        const billing = settings.items.find((item) => item.key === "billing")?.value;
        const parsed = z.object({ fourEyesThresholdMinor: z.number() }).safeParse(billing);
        setValue(parsed.success ? parsed.data.fourEyesThresholdMinor : null);
      },
      () => {
        setValue(null);
      },
    );
    return () => {
      controller.abort();
    };
  }, []);
  return value;
}

/** A clock that re-renders every `TICK_MS`, so the age and SLA labels keep moving. */
function useTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((value) => value + 1);
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return tick;
}

type ClaimState =
  | { id: string; status: "mine" }
  | { id: string; status: "locked"; holder: string | null }
  | { id: string; status: "error"; error: unknown };

function QueueRow({
  item,
  selected,
  onSelect,
}: {
  item: ReviewItem;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={
          selected
            ? "flex min-h-16 w-full flex-col gap-1 rounded-lg border border-primary bg-primary-soft px-3 py-2 text-start focus-visible:outline-none focus-visible:shadow-focus"
            : "flex min-h-16 w-full flex-col gap-1 rounded-lg border border-border bg-surface px-3 py-2 text-start hover:bg-primary-soft/50 focus-visible:outline-none focus-visible:shadow-focus"
        }
      >
        <span className="flex items-center justify-between gap-2">
          <bdi dir="ltr" className="font-semibold">
            {item.number}
          </bdi>
          <span className="tabular-nums font-semibold">
            {moneyText(item.amountMinor, item.currency)}
          </span>
        </span>
        <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm text-text-muted">
          <span>
            {item.method} · <bdi dir="ltr">{item.maskedUser}</bdi>
          </span>
          <span className="tabular-nums">{durationText(item.ageSeconds)}</span>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {item.status === "awaiting_second_approval" ? (
            <Badge tone="info">
              <Clock aria-hidden className="size-3.5" />
              {t("admin.revenue.review.second")}
            </Badge>
          ) : null}
          {item.flags.length > 0 ? (
            <Badge tone="danger">
              <TriangleAlert aria-hidden className="size-3.5" />
              {t("admin.revenue.review.flagsCount", { count: item.flags.length })}
            </Badge>
          ) : null}
          {item.lockHolder ? (
            <Badge tone="warning">
              <Lock aria-hidden className="size-3.5" />
              {t("admin.revenue.review.lockedBy", { name: item.lockHolder.displayName ?? "" })}
            </Badge>
          ) : null}
        </span>
      </button>
    </li>
  );
}

function ChecklistRow({
  label,
  value,
  checkLabel,
}: {
  label: string;
  value: string;
  checkLabel: string;
}) {
  return (
    <li className="flex flex-wrap items-end gap-3">
      <CopyField label={label} value={value} className="min-w-0 flex-1 basis-48" />
      <Checkbox label={checkLabel} name={`match-${label}`} />
    </li>
  );
}

function RejectDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: string, note: string) => Promise<void>;
}) {
  const reauth = useReauth();
  const [reason, setReason] = useState<string>(PAYMENT_REJECT_REASONS[0]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const noteRequired = reason === "other" || reason === "amount_differs";
  const noteMissing = noteRequired && note.trim() === "";

  useEffect(() => {
    if (!open) return;
    setReason(PAYMENT_REJECT_REASONS[0]);
    setNote("");
    setError(null);
  }, [open]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || noteMissing) return;
    setBusy(true);
    setError(null);
    reauth
      .run(() => onSubmit(reason, note.trim()))
      .then(
        () => {
          setBusy(false);
          onOpenChange(false);
        },
        (failure: unknown) => {
          setBusy(false);
          setError(toApiError(failure));
        },
      );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("admin.revenue.review.reject.title")}
      description={t("admin.revenue.review.reject.body")}
    >
      {open ? (
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Field label={t("admin.revenue.review.reject.reason")} required>
            {(control) => (
              <Select
                {...control}
                name="reason"
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
              >
                {PAYMENT_REJECT_REASONS.map((value) => (
                  <option key={value} value={value}>
                    {t(`admin.revenue.review.reject.reason.${value}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label={t("admin.revenue.review.reject.note")}
            required={noteRequired}
            error={noteMissing ? t("admin.revenue.review.reject.noteRequired") : undefined}
          >
            {(control) => (
              <Textarea
                {...control}
                name="note"
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
            )}
          </Field>
          {error ? <ErrorNotice error={error} /> : null}
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              name="cancel"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant="danger"
              name="confirm"
              loading={busy}
              disabled={noteMissing}
            >
              {t("admin.revenue.review.reject.confirm")}
            </Button>
          </div>
        </form>
      ) : null}
    </Dialog>
  );
}

function ProofRequestDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  useEffect(() => {
    if (!open) return;
    setNote("");
    setError(null);
  }, [open]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    onSubmit(note.trim()).then(
      () => {
        setBusy(false);
        onOpenChange(false);
      },
      (failure: unknown) => {
        setBusy(false);
        setError(toApiError(failure));
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("admin.revenue.review.proof.title")}
      description={t("admin.revenue.review.proof.body")}
    >
      {open ? (
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Field label={t("admin.revenue.review.proof.note")}>
            {(control) => (
              <Textarea
                {...control}
                name="note"
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
            )}
          </Field>
          {error ? <ErrorNotice error={error} /> : null}
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              name="cancel"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" name="confirm" loading={busy}>
              {t("admin.revenue.review.proof.confirm")}
            </Button>
          </div>
        </form>
      ) : null}
    </Dialog>
  );
}

interface PaneProps {
  detail: ReviewDetail;
  ageSeconds: number;
  claim: ClaimState | undefined;
  slaMinutes: number | null;
  fourEyesThresholdMinor: number | null;
  overridden: boolean;
  dialog: "approve" | "reject" | "proof" | "override" | null;
  onDialog: (dialog: "approve" | "reject" | "proof" | "override" | null) => void;
  onSkip: () => void;
  onApprove: () => Promise<void>;
  onReject: (reason: string, note: string) => Promise<void>;
  onRequestProof: (note: string) => Promise<void>;
  onOverride: () => void;
}

function ReviewPane({
  detail,
  ageSeconds,
  claim,
  slaMinutes,
  fourEyesThresholdMinor,
  overridden,
  dialog,
  onDialog,
  onSkip,
  onApprove,
  onReject,
  onRequestProof,
  onOverride,
}: PaneProps) {
  const { payment, order, method, user } = detail;
  const overdue = slaMinutes !== null && ageSeconds > slaMinutes * 60;
  const second = payment.status === "awaiting_second_approval";
  const needsSecond =
    !second &&
    fourEyesThresholdMinor !== null &&
    payment.currency === "EGP" &&
    payment.amountMinor >= fourEyesThresholdMinor;
  const lockedByOther = claim?.status === "locked" && !overridden;
  const warnings = [
    ...payment.flags.map((flag) => flagText(flag)),
    ...(detail.earlierRejected.length > 0
      ? [t("admin.revenue.review.flag.earlier_rejected", { count: detail.earlierRejected.length })]
      : []),
  ];
  const subject = order.planKey
    ? `${order.planKey}${order.months ? ` · ${periodLabel(order.months)}` : ""}`
    : t("admin.revenue.review.pack");
  const matches = t("admin.revenue.review.matches");

  return (
    <Card elevation="flat" className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-xl font-semibold">
            <bdi dir="ltr">{order.number}</bdi> · {user.name ?? "—"}
          </h2>
          <p className="text-base text-text-muted">
            {t("admin.revenue.review.willStart", { subject })}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-sm">
          <Badge tone={overdue ? "danger" : "neutral"}>
            <Clock aria-hidden className="size-3.5" />
            {t("admin.revenue.review.waiting", { age: durationText(ageSeconds) })}
            {overdue ? ` · ${t("admin.revenue.attention.overdue")}` : ""}
          </Badge>
          {slaMinutes !== null ? (
            <span className="text-text-muted">
              {t("admin.revenue.review.sla", { minutes: slaMinutes })}
            </span>
          ) : null}
          {detail.lockHolder ? (
            <Badge tone="warning">
              <Lock aria-hidden className="size-3.5" />
              {t("admin.revenue.review.lockedBy", { name: detail.lockHolder.displayName ?? "" })}
            </Badge>
          ) : null}
        </div>
      </header>

      {claim?.status === "locked" ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-warning-soft px-4 py-3 text-base text-warning"
        >
          <span className="flex items-center gap-2">
            <Lock aria-hidden className="size-5" />
            {overridden
              ? t("admin.revenue.review.overridden")
              : t("admin.revenue.review.lockedNotice", { name: claim.holder ?? "" })}
          </span>
          {!overridden ? (
            <Button
              variant="secondary"
              name="override"
              onClick={() => {
                onDialog("override");
              }}
            >
              {t("admin.revenue.review.override")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {second ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg bg-primary-soft px-4 py-3 text-base"
        >
          <CircleAlert aria-hidden className="size-5 shrink-0" />
          {t("admin.revenue.review.secondBanner")}
        </p>
      ) : null}

      {warnings.length > 0 ? (
        <div
          role="group"
          aria-label={t("admin.revenue.review.warnings")}
          className="flex flex-col gap-1 rounded-lg bg-danger-soft px-4 py-3 text-base text-danger"
        >
          {warnings.map((warning) => (
            <p key={warning} className="flex items-center gap-2 font-semibold">
              <TriangleAlert aria-hidden className="size-5 shrink-0" />
              {warning}
            </p>
          ))}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2">
        <ProofViewer
          src={detail.proofUrl}
          unavailable={detail.proofUnavailable}
          alt={t("admin.revenue.review.proofAlt", { number: order.number })}
        />
        <section aria-label={t("admin.revenue.review.checklist")} className="flex flex-col gap-3">
          <h3 className="font-heading text-lg font-semibold">
            {t("admin.revenue.review.checklist")}
          </h3>
          <ul className="flex flex-col gap-3">
            <ChecklistRow
              label={t("admin.revenue.review.expected")}
              value={moneyText(payment.amountMinor, payment.currency)}
              checkLabel={matches}
            />
            <ChecklistRow
              label={t("admin.revenue.review.reference")}
              value={payment.reference}
              checkLabel={matches}
            />
            <ChecklistRow
              label={t("admin.revenue.review.method")}
              value={method.name}
              checkLabel={matches}
            />
            {(user.phone ?? payment.senderPhoneMasked) ? (
              <ChecklistRow
                label={t("admin.revenue.review.sender")}
                value={user.phone ?? payment.senderPhoneMasked ?? ""}
                checkLabel={matches}
              />
            ) : null}
            {payment.txnId ? (
              <ChecklistRow
                label={t("admin.revenue.review.txn")}
                value={payment.txnId}
                checkLabel={matches}
              />
            ) : null}
          </ul>
          <p className="text-sm text-text-muted">{t("admin.revenue.review.matchesHint")}</p>
        </section>
      </div>

      <div className="flex flex-wrap gap-3 border-t border-border pt-4">
        <Button
          name="approve"
          aria-keyshortcuts="A"
          disabled={lockedByOther}
          onClick={() => {
            onDialog("approve");
          }}
        >
          <CircleCheck aria-hidden className="size-5" />
          {needsSecond
            ? t("admin.revenue.review.sendSecond")
            : second
              ? t("admin.revenue.review.confirmSecond")
              : t("admin.revenue.review.approve")}
        </Button>
        <Button
          variant="danger"
          name="reject"
          aria-keyshortcuts="R"
          disabled={lockedByOther}
          onClick={() => {
            onDialog("reject");
          }}
        >
          <X aria-hidden className="size-5" />
          {t("admin.revenue.review.reject")}
        </Button>
        <Button
          variant="secondary"
          name="request-proof"
          aria-keyshortcuts="C"
          disabled={lockedByOther}
          onClick={() => {
            onDialog("proof");
          }}
        >
          <HelpCircle aria-hidden className="size-5" />
          {t("admin.revenue.review.askProof")}
        </Button>
        <Button variant="ghost" name="skip" aria-keyshortcuts="S" onClick={onSkip}>
          <SkipForward aria-hidden className="size-5 rtl:-scale-x-100" />
          {t("admin.revenue.review.skip")}
        </Button>
      </div>

      <ConfirmDialog
        open={dialog === "approve"}
        onOpenChange={(next) => {
          onDialog(next ? "approve" : null);
        }}
        title={
          needsSecond
            ? t("admin.revenue.review.sendSecond")
            : t("admin.revenue.review.approveTitle")
        }
        description={
          needsSecond
            ? t("admin.revenue.review.sendSecondBody", {
                amount: moneyText(payment.amountMinor, payment.currency),
              })
            : t("admin.revenue.review.approveBody", {
                subject,
                amount: moneyText(payment.amountMinor, payment.currency),
              })
        }
        confirmLabel={
          needsSecond
            ? t("admin.revenue.review.sendSecond")
            : t("admin.revenue.review.approveConfirm")
        }
        onConfirm={onApprove}
      />
      <RejectDialog
        open={dialog === "reject"}
        onOpenChange={(next) => {
          onDialog(next ? "reject" : null);
        }}
        onSubmit={onReject}
      />
      <ProofRequestDialog
        open={dialog === "proof"}
        onOpenChange={(next) => {
          onDialog(next ? "proof" : null);
        }}
        onSubmit={onRequestProof}
      />
      <ConfirmDialog
        open={dialog === "override"}
        onOpenChange={(next) => {
          onDialog(next ? "override" : null);
        }}
        title={t("admin.revenue.review.overrideTitle")}
        description={t("admin.revenue.review.overrideBody", {
          name: claim?.status === "locked" ? (claim.holder ?? "") : "",
        })}
        confirmLabel={t("admin.revenue.review.override")}
        tone="danger"
        onConfirm={() => {
          onOverride();
          return Promise.resolve();
        }}
      />
    </Card>
  );
}

/**
 * The manual-payment review queue (ADMIN-CONSOLE-SPEC §4.2): the queue on the inline-start, the
 * review pane beside it (under it on a phone). J/K move, A/R/C act, S skips. Opening a payment
 * claims it for five minutes (soft lock); approving and rejecting go through the fresh-auth prompt.
 */
export function PaymentReviewView() {
  const { toast } = useToast();
  const list = useCursorList("/admin/billing/payments/review", "", reviewPageSchema);
  const record = useOpenRecord("item");
  const selectedId = record.id;
  const items = list.items;
  const index = items.findIndex((item) => item.id === selectedId);
  const selectedItem = index >= 0 ? items[index] : undefined;
  const detail = useResource(
    selectedItem ? `/admin/billing/payments/${selectedItem.id}` : null,
    reviewDetailSchema,
  );
  const methods = useResource("/admin/billing/methods", methodListSchema);
  const threshold = useFourEyesThreshold();
  const [claim, setClaim] = useState<ClaimState | undefined>(undefined);
  const [overrides, setOverrides] = useState<ReadonlySet<string>>(new Set());
  const [dialog, setDialog] = useState<PaneProps["dialog"]>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const tick = useTick();
  // Seconds since the queue was loaded, so the waiting time keeps counting between reloads.
  const loadedAt = useRef(Date.now());
  useEffect(() => {
    loadedAt.current = Date.now();
  }, [list.items]);
  const elapsed = tick >= 0 ? Math.floor((Date.now() - loadedAt.current) / 1_000) : 0;

  // Select the first payment when nothing (or something no longer in the queue) is selected.
  useEffect(() => {
    if (list.status !== "ready" || items.length === 0) return;
    if (index < 0) record.open(items[0]?.id ?? "");
  }, [list.status, items, index, record]);

  // Claim the opened payment after a short pause, so paging past rows does not lock them all.
  useEffect(() => {
    if (!selectedItem) return;
    const id = selectedItem.id;
    const timer = setTimeout(() => {
      api(`/admin/billing/payments/${id}/claim`, { method: "POST" }).then(
        () => {
          setClaim({ id, status: "mine" });
        },
        (error: unknown) => {
          if (errorReason(error) === "review_locked") {
            const holder =
              error instanceof ApiRequestError && typeof error.details?.["holder"] === "string"
                ? error.details["holder"]
                : null;
            setClaim({ id, status: "locked", holder });
          } else {
            setClaim({ id, status: "error", error });
          }
        },
      );
    }, CLAIM_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [selectedItem]);

  const select = useCallback(
    (id: string, scroll: boolean) => {
      record.open(id);
      if (
        scroll &&
        typeof window !== "undefined" &&
        window.matchMedia("(max-width: 1023px)").matches
      ) {
        paneRef.current?.scrollIntoView?.({ block: "start" });
      }
    },
    [record],
  );

  const move = useCallback(
    (delta: number) => {
      const next = items[index + delta];
      if (next) select(next.id, false);
    },
    [items, index, select],
  );

  const afterDecision = (message: string) => {
    const next = items[index + 1] ?? items[index - 1];
    toast({ tone: "success", title: message });
    if (next) record.open(next.id);
    list.reload();
  };

  const decide = (path: string, body: object, message: (status: string | undefined) => string) =>
    api(`/admin/billing/payments/${selectedItem?.id ?? ""}/${path}`, {
      method: "POST",
      body,
      schema: reviewDecisionSchema,
    }).then((result) => {
      afterDecision(message(result.status));
    });

  const overridden = selectedItem ? overrides.has(selectedItem.id) : false;
  const current = claim && claim.id === selectedItem?.id ? claim : undefined;
  const slaMinutes =
    methods.status === "ready" && detail.status === "ready"
      ? (methods.data.items.find((method) => method.key === detail.data.method.key)
          ?.reviewSlaMinutes ?? null)
      : null;

  const shortcuts = useMemo(
    () => ({
      j: () => {
        move(1);
      },
      k: () => {
        move(-1);
      },
      a: () => {
        setDialog("approve");
      },
      r: () => {
        setDialog("reject");
      },
      c: () => {
        setDialog("proof");
      },
      s: () => {
        move(1);
      },
    }),
    [move],
  );

  const ready = detail.status === "ready" && selectedItem !== undefined;

  const listNode =
    list.status === "loading" ? (
      <div className="flex flex-col gap-2" aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    ) : list.status === "error" ? (
      <ErrorNotice error={list.error} onRetry={list.reload} />
    ) : items.length === 0 ? (
      <EmptyHint
        icon={<CircleCheck />}
        title={t("admin.revenue.review.empty")}
        hint={t("admin.revenue.review.emptyHint")}
      />
    ) : (
      <>
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <QueueRow
              key={item.id}
              item={item}
              selected={item.id === selectedItem?.id}
              onSelect={() => {
                select(item.id, true);
              }}
            />
          ))}
        </ul>
        {list.nextCursor ? (
          <Button
            variant="secondary"
            className="mt-2 w-full"
            loading={list.loadingMore}
            onClick={list.loadMore}
          >
            {t("admin.table.loadMore")}
          </Button>
        ) : null}
      </>
    );

  return (
    <QueueLayout
      listLabel={t("admin.revenue.review.queue")}
      paneLabel={t("admin.revenue.review.pane")}
      shortcutsEnabled={ready}
      shortcuts={shortcuts}
      hints={[
        { key: "j", label: t("admin.revenue.review.hint.next") },
        { key: "k", label: t("admin.revenue.review.hint.prev") },
        { key: "a", label: t("admin.revenue.review.hint.approve") },
        { key: "r", label: t("admin.revenue.review.hint.reject") },
        { key: "c", label: t("admin.revenue.review.hint.proof") },
        { key: "s", label: t("admin.revenue.review.hint.skip") },
      ]}
      list={listNode}
      pane={
        <div ref={paneRef}>
          {selectedItem ? (
            <ResourceBoundary resource={detail}>
              {(data) => (
                <ReviewPane
                  detail={data}
                  ageSeconds={selectedItem.ageSeconds + elapsed}
                  claim={current}
                  slaMinutes={slaMinutes}
                  fourEyesThresholdMinor={threshold}
                  overridden={overridden}
                  dialog={dialog}
                  onDialog={setDialog}
                  onSkip={() => {
                    move(1);
                  }}
                  onApprove={() =>
                    decide("approve", { override: overridden }, (status) =>
                      status === "awaiting_second_approval"
                        ? t("admin.revenue.review.sentSecond")
                        : t("admin.revenue.review.approved"),
                    )
                  }
                  onReject={(reason, note) =>
                    decide(
                      "reject",
                      { reason, override: overridden, ...(note ? { note } : {}) },
                      () => t("admin.revenue.review.rejected"),
                    )
                  }
                  onRequestProof={(note) =>
                    decide(
                      "request-proof",
                      { override: overridden, ...(note ? { note } : {}) },
                      () => t("admin.revenue.review.proofAsked"),
                    )
                  }
                  onOverride={() => {
                    setOverrides((currentSet) => new Set(currentSet).add(selectedItem.id));
                  }}
                />
              )}
            </ResourceBoundary>
          ) : (
            <Card elevation="flat">
              <p className="text-base text-text-muted">{t("admin.revenue.review.pick")}</p>
            </Card>
          )}
        </div>
      }
    />
  );
}
