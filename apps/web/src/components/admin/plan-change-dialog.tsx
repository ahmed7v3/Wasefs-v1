"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import { ADMIN_PLAN_CHANGE_KINDS, type AdminPlanChangeKind } from "@wasfa/shared/schemas/admin-user-360";
import { planListResponseSchema } from "@wasfa/shared/schemas/plans";
import { Button, Checkbox, Dialog, Field, Input, Select, Textarea, useToast } from "@wasfa/ui";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatDateTime, formatNumber } from "../../lib/admin-format";
import { planChangePreviewSchema, type PlanChangePreview } from "../../lib/admin-user-360";
import { api } from "../../lib/api-client";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";
import { Notice } from "../notice";

import { REASON_MIN_LENGTH } from "./reason-dialog";

export interface PlanChangeDialogProps {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  /** `/admin/users/<id>` or `/admin/orgs/<id>`: the dialog posts to `<base>/plan-change`. */
  base: string;
  /** The target's name, for the title. */
  targetName: string;
}

const MONTHS = [1, 3, 6, 12] as const;
const PREVIEW_DELAY_MS = 350;

function Form({ onClose, onChanged, base }: Omit<PlanChangeDialogProps, "open" | "targetName">) {
  const { toast } = useToast();
  const reauth = useReauth();
  const plans = useResource("/admin/plans", planListResponseSchema);
  const [planKey, setPlanKey] = useState("");
  const [months, setMonths] = useState<number>(3);
  const [kind, setKind] = useState<AdminPlanChangeKind>("gift");
  const [extra, setExtra] = useState("0");
  const [notify, setNotify] = useState(true);
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("EGP");
  const [methodKey, setMethodKey] = useState("instapay");
  const [reference, setReference] = useState("");
  const [dealId, setDealId] = useState("");
  const [preview, setPreview] = useState<PlanChangePreview | null>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const requestId = useRef(crypto.randomUUID());

  const choices = useMemo(
    () => (plans.status === "ready" ? plans.data.items.filter((plan) => !plan.isDefault) : []),
    [plans],
  );
  useEffect(() => {
    if (planKey === "" && choices[0]) setPlanKey(choices[0].key);
  }, [choices, planKey]);

  const extraCredits = /^\d{1,7}$/.test(extra.trim()) ? Number(extra.trim()) : null;
  const amountMinor = /^\d+(\.\d{1,2})?$/.test(amount.trim()) ? Math.round(Number(amount.trim()) * 100) : null;
  const body = useMemo(() => {
    if (planKey === "" || extraCredits === null) return null;
    return {
      planKey,
      duration: { months },
      kind,
      extraCredits,
      notify,
      reason: reason.trim().length >= REASON_MIN_LENGTH ? reason.trim() : "pending preview",
      ...(kind === "paid_offline"
        ? { paidOffline: { amountMinor: amountMinor ?? 1, currency, methodKey, reference: reference.trim() || "pending" } }
        : {}),
      ...(kind === "sponsored" ? { dealId: dealId.trim() || "00000000-0000-4000-8000-000000000000" } : {}),
    };
  }, [planKey, months, kind, extraCredits, notify, reason, amountMinor, currency, methodKey, reference, dealId]);

  useEffect(() => {
    if (body === null) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api(`${base}/plan-change/preview`, {
        method: "POST",
        body,
        schema: planChangePreviewSchema,
        signal: controller.signal,
      }).then(
        (answer) => {
          setPreview(answer);
          setPreviewError(null);
        },
        (error: unknown) => {
          if (!controller.signal.aborted) setPreviewError(error);
        },
      );
    }, PREVIEW_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [base, body]);

  const paidReady =
    kind !== "paid_offline" || (amountMinor !== null && amountMinor > 0 && reference.trim().length > 0);
  const ready =
    body !== null &&
    reason.trim().length >= REASON_MIN_LENGTH &&
    paidReady &&
    (kind !== "sponsored" || /^[0-9a-f-]{36}$/i.test(dealId.trim())) &&
    preview !== null &&
    preview.blocked === null;

  const apply = async () => {
    if (!ready) return;
    setBusy(true);
    setFailure(null);
    try {
      await reauth.run(() =>
        api(`${base}/plan-change`, {
          method: "POST",
          body: { ...body, reason: reason.trim(), requestId: requestId.current },
        }),
      );
      toast({ tone: "success", title: t("admin.user360.plan.done") });
      onChanged();
      onClose();
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      className="grid gap-5 lg:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        void apply();
      }}
    >
      <div className="flex flex-col gap-4">
        <Field label={t("admin.user360.plan.plan")}>
          {(control) => (
            <Select {...control} name="plan" value={planKey} onChange={(event) => { setPlanKey(event.target.value); }}>
              {choices.map((plan) => (
                <option key={plan.key} value={plan.key}>{plan.nameAr}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("admin.user360.plan.months")}>
          {(control) => (
            <Select {...control} name="months" value={String(months)} onChange={(event) => { setMonths(Number(event.target.value)); }}>
              {MONTHS.map((value) => (
                <option key={value} value={value}>{t("admin.user360.plan.monthsValue", { count: String(value) })}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("admin.user360.plan.kind")}>
          {(control) => (
            <Select {...control} name="kind" value={kind} onChange={(event) => { setKind(event.target.value as AdminPlanChangeKind); }}>
              {ADMIN_PLAN_CHANGE_KINDS.map((value) => (
                <option key={value} value={value}>{t(`admin.user360.plan.kind.${value}` as MessageKey)}</option>
              ))}
            </Select>
          )}
        </Field>
        {kind === "paid_offline" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("admin.user360.plan.amount")} required>
              {(control) => <Input {...control} name="amount" inputMode="decimal" ltr value={amount} onChange={(event) => { setAmount(event.target.value); }} />}
            </Field>
            <Field label={t("admin.user360.plan.currency")}>
              {(control) => <Input {...control} name="currency" ltr maxLength={3} value={currency} onChange={(event) => { setCurrency(event.target.value.toUpperCase()); }} />}
            </Field>
            <Field label={t("admin.user360.plan.method")}>
              {(control) => (
                <Select {...control} name="method" value={methodKey} onChange={(event) => { setMethodKey(event.target.value); }}>
                  <option value="instapay">InstaPay</option>
                  <option value="vodafone_cash">Vodafone Cash</option>
                </Select>
              )}
            </Field>
            <Field label={t("admin.user360.plan.reference")} required>
              {(control) => <Input {...control} name="reference" ltr maxLength={120} value={reference} onChange={(event) => { setReference(event.target.value); }} />}
            </Field>
          </div>
        ) : null}
        {kind === "sponsored" ? (
          <Field label={t("admin.user360.plan.deal")} hint={t("admin.user360.plan.dealHint")} required>
            {(control) => <Input {...control} name="deal" ltr value={dealId} onChange={(event) => { setDealId(event.target.value); }} />}
          </Field>
        ) : null}
        <Field label={t("admin.user360.plan.extraCredits")}>
          {(control) => <Input {...control} name="extra" inputMode="numeric" ltr value={extra} onChange={(event) => { setExtra(event.target.value); }} />}
        </Field>
        <Checkbox name="notify" label={t("admin.user360.plan.notify")} checked={notify} onChange={(event) => { setNotify(event.target.checked); }} />
        <Field label={t("admin.user360.plan.reason")} required hint={t("admin.user360.plan.reasonHint")}>
          {(control) => <Textarea {...control} name="reason" maxLength={500} value={reason} onChange={(event) => { setReason(event.target.value); }} />}
        </Field>
      </div>

      <aside className="flex flex-col gap-3 rounded-lg bg-neutral-100 p-4" aria-live="polite" data-testid="plan-preview">
        <h3 className="font-heading text-lg font-semibold text-text">{t("admin.user360.plan.previewTitle")}</h3>
        {previewError ? <ErrorNotice error={previewError} supportHref={null} /> : null}
        {preview ? (
          <>
            {preview.blocked ? <Notice tone="warning">{t(`admin.user360.plan.blocked.${preview.blocked}` as MessageKey)}</Notice> : null}
            <p className="text-base text-text">{t(`admin.user360.plan.effect.${preview.effect}` as MessageKey)}</p>
            <p className="text-base text-text">
              {t("admin.user360.plan.newExpiry", { date: formatDateTime(preview.newExpiry) })}
            </p>
            {preview.effect === "schedule" ? (
              <p className="text-sm text-text-muted">{t("admin.user360.plan.startsAt", { date: formatDateTime(preview.effectiveAt) })}</p>
            ) : null}
            <p className="text-base text-text">
              {t("admin.user360.plan.credits", { total: formatNumber(preview.credits.total), plan: formatNumber(preview.credits.plan), extra: formatNumber(preview.credits.extra) })}
            </p>
            <ul className="flex flex-col gap-1 text-sm text-text-muted">
              {preview.entitlements.filter((entry) => entry.allowed).map((entry) => (
                <li key={entry.task}>{`${t(`admin.ai.task.${entry.task}` as MessageKey)} · ${entry.modes.join("، ")}`}</li>
              ))}
            </ul>
            {preview.freshAuthRequired ? <p className="text-sm text-text-muted">{t("admin.user360.plan.freshAuth")}</p> : null}
          </>
        ) : (
          <p className="text-sm text-text-muted">{t("admin.user360.plan.previewWaiting")}</p>
        )}
      </aside>

      <div className="flex flex-col gap-3 lg:col-span-2">
        {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" name="confirm-plan-change" loading={busy} disabled={!ready}>
            {t("admin.user360.plan.apply")}
          </Button>
        </div>
      </div>
    </form>
  );
}

/**
 * «ترقية / تغيير الباقة» (ADMIN-CONSOLE-SPEC §8.3): plan, duration, kind, extra credits, notify and a
 * required reason, with the server's preview of the effect beside the form (entitlements, new
 * expiry, credits, replace/extend/schedule). Paid-offline records the payment; large changes ask
 * for the password again. Shared by the user 360 page and the organization drawer.
 */
export function PlanChangeDialog({ open, targetName, ...rest }: PlanChangeDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) rest.onClose();
      }}
      title={t("admin.user360.plan.title", { name: targetName })}
      className="max-w-4xl"
    >
      {open ? <Form {...rest} /> : null}
    </Dialog>
  );
}
