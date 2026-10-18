"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import {
  adminWithdrawalDetailSchema,
  adminWithdrawalListSchema,
  revealedDestinationSchema,
  withdrawalStepResultSchema,
  type AdminWithdrawalDetail,
} from "@wasfa/shared/schemas/withdrawals";
import { WITHDRAWAL_REJECT_REASONS } from "@wasfa/shared/withdrawals";
import { Button, Card, Dialog, Field, Input, Select, Skeleton, Textarea, moneyText, useToast } from "@wasfa/ui";
import { Banknote, CircleCheck, Copy, Download, Eye, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { formatDateTime, formatNumber } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { errorReason } from "../../lib/api-error";
import { downloadCsv } from "../../lib/csv-download";
import { useReauth } from "../../lib/reauth";
import { buildQuery, useCursorList, useResource } from "../../lib/use-admin-data";
import { useUrlParams } from "../../lib/use-url-params";
import { ErrorNotice } from "../error-notice";
import { Notice } from "../notice";

import { EmptyHint } from "./empty-hint";
import { QueueLayout } from "./queue-layout";
import { useOpenRecord } from "./record-drawer";
import { ResourceBoundary } from "./resource-boundary";
import { StatusChip } from "./status-chip";

import type { z } from "zod";

type Row = z.output<typeof adminWithdrawalListSchema>["items"][number];
type Totals = z.output<typeof adminWithdrawalListSchema>["totals"];

const ageText = (seconds: number) =>
  seconds < 3_600
    ? t("admin.growth.age.minutes", { count: formatNumber(Math.max(1, Math.floor(seconds / 60))) })
    : seconds < 86_400
      ? t("admin.growth.age.hours", { count: formatNumber(Math.floor(seconds / 3_600)) })
      : t("admin.growth.age.days", { count: formatNumber(Math.floor(seconds / 86_400)) });

/** ISO week of today, `2026-W42`, for the accountant's weekly CSV. */
function isoWeek(date = new Date()): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((day.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${String(day.getUTCFullYear())}-W${String(week).padStart(2, "0")}`;
}

function TotalsStrip({ totals }: { totals: Totals }) {
  const cell = (label: string, rows: Totals["waiting"]) => (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3">
      <span className="text-sm text-text-muted">{label}</span>
      {rows.length === 0 ? (
        <span className="font-heading text-lg font-bold text-text">0</span>
      ) : (
        rows.map((row) => (
          <span key={row.currency} className="font-heading text-lg font-bold text-text tabular-nums">
            {`${formatNumber(row.count)} · ${moneyText(row.amountMinor, row.currency)}`}
          </span>
        ))
      )}
    </div>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-3" data-testid="withdrawal-totals">
      {cell(t("admin.growth.withdrawals.totals.waiting"), totals.waiting)}
      {cell(t("admin.growth.withdrawals.totals.approved"), totals.approvedNotPaid)}
      {cell(t("admin.growth.withdrawals.totals.paidMonth"), totals.paidThisMonth)}
    </div>
  );
}

function QueueRow({ item, selected, onSelect }: { item: Row; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={`flex w-full flex-col gap-1 rounded-lg border p-3 text-start focus-visible:outline-none focus-visible:shadow-focus ${
          selected ? "border-primary bg-primary-soft" : "border-border bg-surface hover:bg-neutral-100"
        }`}
      >
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold text-text tabular-nums">
            {`${formatNumber(item.points)} · ${moneyText(item.amountMinor, item.currency)}`}
          </span>
          <StatusChip kind="withdrawal" status={item.status} />
        </span>
        <span className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
          <span>{item.maskedUser}</span>
          <span>{ageText(item.ageSeconds)}</span>
          {item.overdue ? <span className="font-semibold text-danger">{t("admin.growth.withdrawals.overdue")}</span> : null}
          {item.awaitingSecondApproval ? <span>{t("admin.growth.withdrawals.secondNeeded")}</span> : null}
          {item.flags.map((flag) => (
            <span key={flag} className="rounded bg-warning-soft px-1.5 text-text">
              {t(`admin.growth.flag.${flag}` as MessageKey)}
            </span>
          ))}
        </span>
      </button>
    </li>
  );
}

type DialogKind = "approve" | "reject" | "paid" | null;

function ReviewPane({
  detail,
  canPay,
  onDone,
}: {
  detail: AdminWithdrawalDetail;
  canPay: boolean;
  onDone: (message: string) => void;
}) {
  const { toast } = useToast();
  const reauth = useReauth();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [revealed, setRevealed] = useState<Record<string, string> | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [override, setOverride] = useState(false);
  const [rejectKey, setRejectKey] = useState<string>(WITHDRAWAL_REJECT_REASONS[0]);
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const lockedByOther = detail.lockHolder !== null && !override;

  useEffect(() => {
    setRevealed(null);
    setOverride(false);
    setFailure(null);
  }, [detail.id]);

  const step = async (path: string, body: object, message: string) => {
    setBusy(true);
    setFailure(null);
    try {
      await reauth.run(() =>
        api(`/admin/growth/withdrawals/${detail.id}/${path}`, {
          method: "POST",
          body: { ...body, override },
          schema: withdrawalStepResultSchema,
        }),
      );
      setDialog(null);
      onDone(message);
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  };

  const reveal = async () => {
    setFailure(null);
    try {
      const value = await reauth.run(() =>
        api(`/admin/growth/withdrawals/${detail.id}/reveal`, {
          method: "POST",
          body: { override },
          schema: revealedDestinationSchema,
        }),
      );
      setRevealed(value.values);
    } catch (error) {
      setFailure(error);
    }
  };

  const copyForWallet = async () => {
    const number = revealed ? Object.values(revealed).join(" ") : "";
    const text = `${moneyText(detail.amountMinor, detail.currency)} ${number}`.trim();
    try {
      await navigator.clipboard.writeText(text);
      toast({ tone: "success", title: t("admin.growth.withdrawals.copied") });
    } catch {
      toast({ tone: "error", title: t("admin.growth.withdrawals.copyFailed") });
    }
  };

  const open = detail.status === "requested" || detail.status === "approved";
  return (
    <Card elevation="card" className="flex flex-col gap-5" data-testid="withdrawal-pane">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="font-heading text-2xl font-bold text-text tabular-nums" data-testid="withdrawal-amount">
            {moneyText(detail.amountMinor, detail.currency)}
          </p>
          <p className="text-sm text-text-muted">
            {t("admin.growth.withdrawals.pointsAt", {
              points: formatNumber(detail.points),
              rate: formatNumber(detail.rateMinorPerPoint),
            })}
          </p>
        </div>
        <StatusChip kind="withdrawal" status={detail.status} />
      </div>

      {detail.lockHolder ? (
        <Notice tone="warning">
          <span className="flex flex-wrap items-center gap-3">
            {t("admin.growth.withdrawals.lockedBy", { name: detail.lockHolder.displayName ?? "" })}
            {override ? null : (
              <Button variant="secondary" onClick={() => { setOverride(true); }}>
                {t("admin.growth.withdrawals.takeOver")}
              </Button>
            )}
          </span>
        </Notice>
      ) : null}

      <dl className="grid gap-3 sm:grid-cols-2">
        <div><dt className="text-sm text-text-muted">{t("admin.growth.withdrawals.user")}</dt><dd className="text-text">{detail.user.maskedUser}</dd></div>
        <div><dt className="text-sm text-text-muted">{t("admin.growth.withdrawals.accountAge")}</dt><dd className="text-text">{t("admin.growth.age.days", { count: formatNumber(detail.user.accountAgeDays) })}</dd></div>
        <div><dt className="text-sm text-text-muted">{t("admin.growth.withdrawals.lifetime")}</dt><dd className="text-text tabular-nums">{formatNumber(detail.user.lifetimeEarned)}</dd></div>
        <div><dt className="text-sm text-text-muted">{t("admin.growth.withdrawals.debt")}</dt><dd className="text-text tabular-nums">{formatNumber(detail.user.openDebt)}</dd></div>
        <div className="sm:col-span-2">
          <dt className="text-sm text-text-muted">{t("admin.growth.withdrawals.destination")}</dt>
          <dd className="flex flex-wrap items-center gap-3 text-text">
            <span>{detail.destination.methodNameAr}</span>
            <bdi dir="ltr" data-testid="destination-value">
              {revealed ? Object.values(revealed).join(" ") : detail.destination.masked}
            </bdi>
            {canPay && !revealed ? (
              <Button variant="ghost" name="reveal" onClick={() => { void reveal(); }}>
                <Eye aria-hidden className="size-4" />
                {t("admin.growth.withdrawals.reveal")}
              </Button>
            ) : null}
            {revealed ? (
              <Button variant="ghost" name="copy" onClick={() => { void copyForWallet(); }}>
                <Copy aria-hidden className="size-4" />
                {t("admin.growth.withdrawals.copy")}
              </Button>
            ) : null}
          </dd>
        </div>
      </dl>

      {detail.flags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <ShieldAlert aria-hidden className="size-4 text-warning" />
          {detail.flags.map((flag) => (
            <span key={flag} className="rounded bg-warning-soft px-2 py-0.5 text-sm text-text">
              {t(`admin.growth.flag.${flag}` as MessageKey)}
            </span>
          ))}
        </div>
      ) : null}
      {detail.requiresSecondApproval ? (
        <p className="text-sm text-text-muted">
          {detail.awaitingSecondApproval
            ? t("admin.growth.withdrawals.secondNeeded")
            : t("admin.growth.withdrawals.fourEyes", { points: formatNumber(detail.fourEyesThresholdPoints) })}
        </p>
      ) : null}

      <section className="flex flex-col gap-2">
        <h3 className="text-base font-semibold text-text">{t("admin.growth.withdrawals.funding")}</h3>
        {detail.funding.length === 0 ? (
          <p className="text-sm text-text-muted">{t("admin.growth.withdrawals.fundingEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm text-text">
            {detail.funding.slice(0, 10).map((entry, index) => (
              <li key={`${entry.at}-${String(index)}`}>
                {`${formatDateTime(entry.at)} · +${formatNumber(entry.points)}${entry.refereeInitials ? ` · ${entry.refereeInitials}` : ""}${entry.event ? ` · ${t(`admin.growth.event.${entry.event}` as MessageKey)}` : ""}`}
              </li>
            ))}
          </ul>
        )}
      </section>

      {detail.transferReference ? (
        <p className="text-base text-text" data-testid="paid-reference">
          {t("admin.growth.withdrawals.reference", { reference: detail.transferReference })}
        </p>
      ) : null}

      {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}

      {open ? (
        <div className="flex flex-wrap gap-3 border-t border-border/60 pt-4">
          {detail.status === "requested" ? (
            <Button name="approve" aria-keyshortcuts="A" disabled={lockedByOther} onClick={() => { setDialog("approve"); }}>
              <CircleCheck aria-hidden className="size-4" />
              {t("admin.growth.withdrawals.approve")}
            </Button>
          ) : null}
          {detail.status === "approved" && canPay ? (
            <Button name="mark-paid" disabled={lockedByOther} onClick={() => { setDialog("paid"); }}>
              <Banknote aria-hidden className="size-4" />
              {t("admin.growth.withdrawals.markPaid")}
            </Button>
          ) : null}
          <Button variant="danger" name="reject" aria-keyshortcuts="R" disabled={lockedByOther} onClick={() => { setDialog("reject"); }}>
            {t("admin.growth.withdrawals.reject")}
          </Button>
        </div>
      ) : null}

      <Dialog
        open={dialog === "approve"}
        onOpenChange={(next) => { if (!next) setDialog(null); }}
        title={t("admin.growth.withdrawals.approveTitle")}
        description={t("admin.growth.withdrawals.approveEffect", { amount: moneyText(detail.amountMinor, detail.currency) })}
      >
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={() => { setDialog(null); }}>{t("common.cancel")}</Button>
          <Button name="confirm-approve" loading={busy} onClick={() => { void step("approve", {}, t("admin.growth.withdrawals.approved")); }}>
            {t("admin.growth.withdrawals.approve")}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={dialog === "reject"}
        onOpenChange={(next) => { if (!next) setDialog(null); }}
        title={t("admin.growth.withdrawals.rejectTitle")}
        description={t("admin.growth.withdrawals.rejectEffect")}
      >
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void step("reject", { reasonKey: rejectKey, ...(note.trim() ? { note: note.trim() } : {}) }, t("admin.growth.withdrawals.rejected"));
          }}
        >
          <Field label={t("admin.growth.withdrawals.rejectReason")}>
            {(control) => (
              <Select {...control} name="reject-reason" value={rejectKey} onChange={(event) => { setRejectKey(event.target.value); }}>
                {WITHDRAWAL_REJECT_REASONS.map((key) => (
                  <option key={key} value={key}>{t(`rewards.withdrawal.reject.${key}` as MessageKey)}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("admin.growth.withdrawals.rejectNote")} hint={t("admin.growth.withdrawals.rejectNoteHint")}>
            {(control) => <Textarea {...control} name="reject-note" maxLength={500} value={note} onChange={(event) => { setNote(event.target.value); }} />}
          </Field>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => { setDialog(null); }}>{t("common.cancel")}</Button>
            <Button type="submit" variant="danger" name="confirm-reject" loading={busy}>{t("admin.growth.withdrawals.reject")}</Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={dialog === "paid"}
        onOpenChange={(next) => { if (!next) setDialog(null); }}
        title={t("admin.growth.withdrawals.paidTitle")}
        description={t("admin.growth.withdrawals.paidEffect")}
      >
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (reference.trim().length < 3) return;
            void step("mark-paid", { transferReference: reference.trim() }, t("admin.growth.withdrawals.paid"));
          }}
        >
          <Field label={t("admin.growth.withdrawals.referenceField")} required>
            {(control) => <Input {...control} name="transfer-reference" ltr autoComplete="off" maxLength={100} value={reference} onChange={(event) => { setReference(event.target.value); }} />}
          </Field>
          {errorReason(failure) === "reference_taken" ? <Notice tone="warning">{t("admin.growth.withdrawals.referenceTaken")}</Notice> : null}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => { setDialog(null); }}>{t("common.cancel")}</Button>
            <Button type="submit" name="confirm-paid" loading={busy} disabled={reference.trim().length < 3}>{t("admin.growth.withdrawals.markPaid")}</Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}

/**
 * `/admin/growth/withdrawals` (ADMIN-CONSOLE-SPEC §6.3): the queue (overdue first), the review pane
 * with the reward breakdown behind the balance, flags, past requests and the masked destination
 * ("Reveal" decrypts once and is audited), and Approve / Reject / Mark paid behind fresh auth. A
 * totals strip and the accountant's weekly CSV sit above it.
 */
export function GrowthWithdrawalsView({ canPay, canExport }: { canPay: boolean; canExport: boolean }) {
  const { toast } = useToast();
  const url = useUrlParams();
  const status = url.get("status");
  const list = useCursorList(
    "/admin/growth/withdrawals",
    buildQuery({ status: status === "" ? undefined : status }),
    adminWithdrawalListSchema,
  );
  // The first page also carries the totals strip; read it once more here (the cursor hook keeps only rows).
  const totalsQuery = buildQuery({ status: status === "" ? undefined : status });
  const totals = useResource(`/admin/growth/withdrawals${totalsQuery ? `?${totalsQuery}` : ""}`, adminWithdrawalListSchema);
  const record = useOpenRecord("item");
  const items = list.items;
  const index = items.findIndex((item) => item.id === record.id);
  const selected = index >= 0 ? items[index] : undefined;
  const detail = useResource(selected ? `/admin/growth/withdrawals/${selected.id}` : null, adminWithdrawalDetailSchema);
  const { reload: reloadDetail } = detail;

  useEffect(() => {
    if (list.status !== "ready" || items.length === 0) return;
    if (index < 0) record.open(items[0]?.id ?? "");
  }, [list.status, items, index, record]);

  useEffect(() => {
    if (!selected) return;
    const timer = setTimeout(() => {
      void api(`/admin/growth/withdrawals/${selected.id}/claim`, { method: "POST" }).catch(() => undefined);
    }, 600);
    return () => {
      clearTimeout(timer);
    };
  }, [selected]);

  const move = useCallback(
    (delta: number) => {
      const next = items[index + delta];
      if (next) record.open(next.id);
    },
    [items, index, record],
  );
  const shortcuts = useMemo(() => ({ j: () => { move(1); }, k: () => { move(-1); } }), [move]);

  const exportCsv = async () => {
    try {
      await downloadCsv(`/admin/growth/withdrawals/export.csv?week=${isoWeek()}`, `withdrawals-${isoWeek()}.csv`);
    } catch {
      toast({ tone: "error", title: t("admin.growth.withdrawals.exportFailed") });
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label={t("admin.growth.withdrawals.views")} className="flex flex-wrap gap-2">
          {(["", "requested", "approved", "paid", "rejected"] as const).map((value) => (
            <Button
              key={value || "all"}
              variant={status === value ? "primary" : "secondary"}
              aria-pressed={status === value}
              onClick={() => { url.update({ status: value === "" ? null : value, item: null }); }}
            >
              {value === "" ? t("admin.growth.withdrawals.view.all") : t(`admin.growth.withdrawalStatus.${value}` as MessageKey)}
            </Button>
          ))}
        </div>
        {canExport ? (
          <Button variant="secondary" name="export" onClick={() => { void exportCsv(); }}>
            <Download aria-hidden className="size-4" />
            {t("admin.growth.withdrawals.export")}
          </Button>
        ) : null}
      </div>
      {totals.status === "ready" ? <TotalsStrip totals={totals.data.totals} /> : null}
      <QueueLayout
        listLabel={t("admin.growth.withdrawals.queue")}
        paneLabel={t("admin.growth.withdrawals.pane")}
        shortcutsEnabled={detail.status === "ready"}
        shortcuts={shortcuts}
        hints={[
          { key: "j", label: t("admin.revenue.review.hint.next") },
          { key: "k", label: t("admin.revenue.review.hint.prev") },
        ]}
        list={
          list.status === "loading" ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : list.status === "error" ? (
            <ErrorNotice error={list.error} onRetry={list.reload} />
          ) : items.length === 0 ? (
            <EmptyHint icon={<CircleCheck />} title={t("admin.growth.withdrawals.empty")} hint={t("admin.growth.withdrawals.emptyHint")} />
          ) : (
            <>
              <ul className="flex flex-col gap-2">
                {items.map((item) => (
                  <QueueRow key={item.id} item={item} selected={item.id === selected?.id} onSelect={() => { record.open(item.id); }} />
                ))}
              </ul>
              {list.nextCursor ? (
                <Button variant="secondary" className="mt-2 w-full" loading={list.loadingMore} onClick={list.loadMore}>
                  {t("admin.table.loadMore")}
                </Button>
              ) : null}
            </>
          )
        }
        pane={
          selected ? (
            <ResourceBoundary resource={detail}>
              {(data) => (
                <ReviewPane
                  detail={data}
                  canPay={canPay}
                  onDone={(message) => {
                    toast({ tone: "success", title: message });
                    list.reload();
                    totals.reload();
                    reloadDetail();
                  }}
                />
              )}
            </ResourceBoundary>
          ) : (
            <Card elevation="flat">
              <p className="text-base text-text-muted">{t("admin.growth.withdrawals.pick")}</p>
            </Card>
          )
        }
      />
    </div>
  );
}
