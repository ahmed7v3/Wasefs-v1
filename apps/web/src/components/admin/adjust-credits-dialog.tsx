"use client";

import { t } from "@wasfa/shared/i18n";
import {
  adjustCreditsSchema,
  adminAdjustResponseSchema,
  CREDIT_ADJUST_MAX,
  WALLET_OWNER_TYPES,
  type WalletOwner,
  type WalletOwnerType,
} from "@wasfa/shared/schemas/credits";
import { Button, Dialog, Field, Input, Select, Textarea, useToast } from "@wasfa/ui";
import { useState } from "react";

import { ownerTypeLabel } from "../../lib/admin-billing";
import { formatNumber } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { ApiRequestError, errorReason } from "../../lib/api-error";
import { serverFieldErrors, toApiError, validateValues } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { ErrorNotice } from "../error-notice";

import type { FormEvent } from "react";

/** A wallet the dialog is opened for; `null` lets the admin type an owner. */
export interface AdjustTarget {
  owner: WalletOwner;
  /** Name or email, for the heading. */
  label: string | null;
  balance: number;
}

export interface AdjustCreditsDialogProps {
  open: boolean;
  target: AdjustTarget | null;
  /** Wallets already on screen: a typed owner that matches one gets its balance previewed too. */
  knownWallets: readonly { owner: WalletOwner; balance: number }[];
  onClose: () => void;
  onAdjusted: () => void;
}

/** Whole number from the field, `undefined` for an empty one (so it reads as "required"). */
function parseDelta(text: string): number | undefined {
  return text.trim() === "" ? undefined : Number(text);
}

function AdjustForm({ target, knownWallets, onClose, onAdjusted }: AdjustCreditsDialogProps) {
  const reauth = useReauth();
  const { toast } = useToast();
  // One key per opening: a double click or a retry after a lost answer cannot adjust twice.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [ownerType, setOwnerType] = useState<WalletOwnerType>(target?.owner.type ?? "user");
  const [ownerId, setOwnerId] = useState(target?.owner.id ?? "");
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<ApiRequestError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitCount, setSubmitCount] = useState(0);

  const owner: WalletOwner = target?.owner ?? { type: ownerType, id: ownerId.trim() };
  const balance =
    target?.balance ??
    knownWallets.find((wallet) => wallet.owner.type === owner.type && wallet.owner.id === owner.id)
      ?.balance;
  const amount = parseDelta(delta);
  const after =
    balance !== undefined && amount !== undefined && Number.isInteger(amount)
      ? balance + amount
      : undefined;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const values = { owner, delta: amount, reason, idempotencyKey };
    const invalid = validateValues(adjustCreditsSchema, values);
    if (invalid["delta"]) invalid["delta"] = t("admin.credits.adjust.deltaInvalid");
    if (Object.keys(invalid).length > 0) {
      setErrors(invalid);
      setFormError(null);
      setSubmitCount((count) => count + 1);
      return;
    }
    setSubmitting(true);
    setErrors({});
    setFormError(null);
    reauth
      .run(() =>
        api("/admin/credits/adjust", {
          method: "POST",
          body: values,
          schema: adminAdjustResponseSchema,
        }),
      )
      .then(
        (result) => {
          toast({
            tone: "success",
            title: t("admin.credits.adjust.done", { balance: formatNumber(result.wallet.balance) }),
          });
          onAdjusted();
          onClose();
        },
        (error: unknown) => {
          setSubmitting(false);
          if (errorReason(error) === "insufficient_balance") {
            setErrors({ delta: t("admin.credits.reason.insufficient_balance") });
            setSubmitCount((count) => count + 1);
            return;
          }
          if (error instanceof ApiRequestError && error.code === "NOT_FOUND") {
            setErrors({ "owner.id": t("admin.credits.adjust.ownerNotFound") });
            setSubmitCount((count) => count + 1);
            return;
          }
          const mapped = serverFieldErrors(error, adjustCreditsSchema, values, [
            "owner.id",
            "delta",
            "reason",
          ]);
          if (mapped) {
            setErrors(mapped);
            setSubmitCount((count) => count + 1);
          } else {
            setFormError(toApiError(error));
          }
        },
      );
  };

  const announce = submitCount > 0;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {target ? (
        <p className="rounded-md border border-border bg-neutral-50 p-3 text-base">
          <span className="font-semibold">{target.label ?? target.owner.id}</span>{" "}
          <span className="text-text-muted">({ownerTypeLabel(target.owner.type)})</span>
          <span className="mt-1 block text-sm text-text-muted">
            {t("admin.credits.adjust.current")}{" "}
            <span dir="ltr" className="tabular-nums">
              {formatNumber(target.balance)}
            </span>
          </span>
        </p>
      ) : (
        <>
          <Field label={t("admin.plans.assign.ownerType")}>
            {(control) => (
              <Select
                {...control}
                name="ownerType"
                value={ownerType}
                onChange={(event) => {
                  setOwnerType(event.target.value === "org" ? "org" : "user");
                }}
              >
                {WALLET_OWNER_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {ownerTypeLabel(type)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label={t("admin.plans.assign.ownerId")}
            hint={t("admin.credits.adjust.ownerIdHint")}
            required
            error={errors["owner.id"]}
            announceError={announce}
          >
            {(control) => (
              <Input
                {...control}
                name="ownerId"
                ltr
                autoComplete="off"
                value={ownerId}
                onChange={(event) => {
                  setOwnerId(event.target.value);
                }}
              />
            )}
          </Field>
        </>
      )}
      {target && errors["owner.id"] ? (
        <p role="alert" className="text-sm text-danger">
          {errors["owner.id"]}
        </p>
      ) : null}

      <Field
        label={t("admin.credits.adjust.delta")}
        hint={t("admin.credits.adjust.deltaHint", { max: formatNumber(CREDIT_ADJUST_MAX) })}
        required
        error={errors["delta"]}
        announceError={announce}
      >
        {(control) => (
          <Input
            {...control}
            name="delta"
            type="number"
            inputMode="numeric"
            step={1}
            ltr
            value={delta}
            onChange={(event) => {
              setDelta(event.target.value);
            }}
          />
        )}
      </Field>
      <p role="status" aria-live="polite" className="min-h-6 text-base">
        {after === undefined ? (
          balance === undefined && owner.id !== "" ? (
            <span className="text-text-muted">{t("admin.credits.adjust.balanceUnknown")}</span>
          ) : null
        ) : (
          <span className={after < 0 ? "text-danger" : "text-text"}>
            {t("admin.credits.adjust.after")}{" "}
            <span dir="ltr" className="font-semibold tabular-nums">
              {formatNumber(after)}
            </span>
            {after < 0 ? ` — ${t("admin.credits.adjust.wouldBeNegative")}` : ""}
          </span>
        )}
      </p>

      <Field
        label={t("admin.reason.label")}
        hint={t("admin.reason.hint")}
        required
        error={errors["reason"]}
        announceError={announce}
      >
        {(control) => (
          <Textarea
            {...control}
            name="reason"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        )}
      </Field>
      {formError ? <ErrorNotice error={formError} /> : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="ghost" name="cancel" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" name="apply" loading={submitting}>
          {t("admin.credits.adjust.submit")}
        </Button>
      </div>
    </form>
  );
}

/** Add or deduct credits of one wallet (`credits.adjust`), with a written reason for the audit trail. */
export function AdjustCreditsDialog(props: AdjustCreditsDialogProps) {
  const { open, onClose } = props;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("admin.credits.adjust.title")}
      description={t("admin.credits.adjust.lead")}
    >
      {/* Mounted only while open: each opening gets its own idempotency key and a clean form. */}
      {open ? <AdjustForm {...props} /> : null}
    </Dialog>
  );
}
