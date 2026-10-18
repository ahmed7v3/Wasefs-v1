"use client";

import { t } from "@wasfa/shared/i18n";
import { accountChangeSchema } from "@wasfa/shared/schemas/admin-payment-methods";
import { Button, Field, Input, Textarea, useToast } from "@wasfa/ui";
import { ArrowLeftRight, Clock, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";

import {
  accountChangeRequestedSchema,
  pendingAccountChangeSchema,
} from "../../lib/admin-billing-schemas";
import { clockText, remainingSeconds } from "../../lib/admin-revenue";
import { api } from "../../lib/api-client";
import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import { ResourceBoundary } from "./resource-boundary";

import type { ApiRequestError } from "../../lib/api-error";
import type { FormEvent } from "react";

/** A clock that ticks every second while a deadline is ahead. */
function useSecondsLeft(effectiveAt: string): number {
  const [left, setLeft] = useState(() => remainingSeconds(effectiveAt));
  useEffect(() => {
    setLeft(remainingSeconds(effectiveAt));
    const timer = setInterval(() => {
      setLeft(remainingSeconds(effectiveAt));
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, [effectiveAt]);
  return left;
}

function Pending({
  methodKey,
  change,
  canCancel,
  onChanged,
}: {
  methodKey: string;
  change: {
    oldAccountDisplay: string;
    newAccountDisplay: string;
    oldAccountHolder: string | null;
    newAccountHolder: string | null;
    effectiveAt: string;
  };
  canCancel: boolean;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const reauth = useReauth();
  const left = useSecondsLeft(change.effectiveAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  // Once the wait is over the change is applied by a job: look again shortly after.
  const elapsed = left <= 0;
  useEffect(() => {
    if (!elapsed) return;
    const timer = setTimeout(onChanged, 3_000);
    return () => {
      clearTimeout(timer);
    };
  }, [elapsed, onChanged]);

  const cancel = () => {
    setBusy(true);
    setError(null);
    reauth
      .run(() =>
        api(`/admin/billing/methods/${methodKey}/account-change/cancel`, { method: "POST" }),
      )
      .then(
        () => {
          setBusy(false);
          toast({ tone: "success", title: t("admin.pricing.account.canceled") });
          onChanged();
        },
        (failure: unknown) => {
          setBusy(false);
          setError(toApiError(failure));
        },
      );
  };

  return (
    <div
      role="region"
      aria-label={t("admin.pricing.account.pendingTitle")}
      className="flex flex-col gap-3 rounded-lg border border-warning bg-warning-soft p-4"
      data-testid="account-pending"
    >
      <p className="flex items-center gap-2 font-heading text-lg font-semibold text-warning">
        <ShieldAlert aria-hidden className="size-5" />
        {t("admin.pricing.account.pendingTitle")}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-base">
        <dt className="text-text-muted">{t("admin.pricing.account.old")}</dt>
        <dd>
          <bdi dir="ltr">{change.oldAccountDisplay || "—"}</bdi>
        </dd>
        <dt className="text-text-muted">{t("admin.pricing.account.new")}</dt>
        <dd>
          <bdi dir="ltr" className="font-semibold">
            {change.newAccountDisplay}
          </bdi>
        </dd>
        {change.newAccountHolder !== change.oldAccountHolder ? (
          <>
            <dt className="text-text-muted">{t("admin.pricing.account.holder")}</dt>
            <dd>
              {change.oldAccountHolder ?? "—"}{" "}
              <ArrowLeftRight aria-hidden className="inline size-4" />{" "}
              {change.newAccountHolder ?? "—"}
            </dd>
          </>
        ) : null}
      </dl>
      <p className="flex items-center gap-2 text-base" aria-live="off">
        <Clock aria-hidden className="size-5" />
        {left > 0 ? t("admin.pricing.account.countdown") : t("admin.pricing.account.applying")}
        <span
          className="font-mono text-xl font-semibold tabular-nums"
          data-testid="account-countdown"
          role="timer"
          aria-label={t("admin.pricing.account.countdownLabel")}
        >
          {clockText(left)}
        </span>
      </p>
      <p className="text-sm text-text-muted">{t("admin.pricing.account.notice")}</p>
      {error ? <ErrorNotice error={error} /> : null}
      {canCancel ? (
        <Button
          variant="danger"
          name="cancel-account-change"
          className="self-start"
          loading={busy}
          onClick={cancel}
        >
          {t("admin.pricing.account.cancel")}
        </Button>
      ) : null}
    </div>
  );
}

function RequestForm({ methodKey, onRequested }: { methodKey: string; onRequested: () => void }) {
  const { toast } = useToast();
  const reauth = useReauth();
  const [values, setValues] = useState({
    accountDisplay: "",
    accountHolder: "",
    reason: "",
    totpCode: "",
  });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const parsed = accountChangeSchema.safeParse({
    accountDisplay: values.accountDisplay.trim(),
    accountHolder: values.accountHolder.trim() === "" ? null : values.accountHolder.trim(),
    reason: values.reason.trim(),
    totpCode: values.totpCode.trim(),
  });
  const invalid = (name: keyof typeof values) =>
    touched && !parsed.success && parsed.error.issues.some((issue) => issue.path[0] === name);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    if (busy || !parsed.success) return;
    setBusy(true);
    setError(null);
    const body = parsed.data;
    reauth
      .run(() =>
        api(`/admin/billing/methods/${methodKey}/account-change`, {
          method: "POST",
          body,
          schema: accountChangeRequestedSchema,
        }),
      )
      .then(
        () => {
          setBusy(false);
          toast({ tone: "success", title: t("admin.pricing.account.requested") });
          onRequested();
        },
        (failure: unknown) => {
          setBusy(false);
          setError(toApiError(failure));
        },
      );
  };

  const field = (
    name: keyof typeof values,
    label: string,
    options: { ltr?: boolean; hint?: string; multiline?: boolean } = {},
  ) => (
    <Field
      label={label}
      hint={options.hint}
      required={name !== "accountHolder"}
      error={invalid(name) ? t("admin.pricing.promo.fieldInvalid") : undefined}
    >
      {(control) =>
        options.multiline ? (
          <Textarea
            {...control}
            name={name}
            value={values[name]}
            onChange={(event) => {
              setValues((current) => ({ ...current, [name]: event.target.value }));
            }}
          />
        ) : (
          <Input
            {...control}
            name={name}
            ltr={options.ltr}
            autoComplete="off"
            inputMode={name === "totpCode" ? "numeric" : undefined}
            value={values[name]}
            onChange={(event) => {
              setValues((current) => ({ ...current, [name]: event.target.value }));
            }}
          />
        )
      }
    </Field>
  );

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-4"
      aria-label={t("admin.pricing.account.formTitle")}
    >
      <p className="text-base text-text-muted">{t("admin.pricing.account.lead")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {field("accountDisplay", t("admin.pricing.account.newNumber"), {
          ltr: true,
          hint: t("admin.pricing.account.numberHint"),
        })}
        {field("accountHolder", t("admin.pricing.account.holder"))}
        {field("totpCode", t("admin.pricing.account.totp"), {
          ltr: true,
          hint: t("admin.pricing.account.totpHint"),
        })}
      </div>
      {field("reason", t("admin.reason.label"), { multiline: true })}
      {error ? <ErrorNotice error={error} /> : null}
      <Button type="submit" name="request-account-change" className="self-start" loading={busy}>
        {t("admin.pricing.account.submit")}
      </Button>
    </form>
  );
}

/**
 * The protected flow for a manual method's account number (BILLING §12): fresh auth and a TOTP code,
 * the change waits ten minutes with a visible countdown (all channels are told), and another admin
 * can cancel it while it waits.
 */
export function AccountChangePanel({
  methodKey,
  canWrite,
}: {
  methodKey: string;
  canWrite: boolean;
}) {
  const resource = useResource(
    `/admin/billing/methods/${methodKey}/account-change`,
    pendingAccountChangeSchema,
  );
  return (
    <ResourceBoundary resource={resource}>
      {(pending) =>
        pending ? (
          <Pending
            methodKey={methodKey}
            change={pending.change}
            canCancel={canWrite}
            onChanged={resource.reload}
          />
        ) : canWrite ? (
          <RequestForm methodKey={methodKey} onRequested={resource.reload} />
        ) : (
          <p className="text-base text-text-muted">{t("admin.pricing.account.readOnly")}</p>
        )
      }
    </ResourceBoundary>
  );
}
