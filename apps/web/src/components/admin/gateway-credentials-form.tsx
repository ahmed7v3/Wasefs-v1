"use client";

import { t } from "@wasfa/shared/i18n";
import { gatewayViewSchema, type GatewayView } from "@wasfa/shared/schemas/admin-billing-gateways";
import { Button, Field, Input, PasswordInput } from "@wasfa/ui";
import { useState, type FormEvent } from "react";

import { api } from "../../lib/api-client";
import { useReauth } from "../../lib/reauth";

export function GatewayCredentialsForm({
  gateway,
  onSaved,
}: {
  gateway: GatewayView | null;
  onSaved: () => void;
}) {
  const reauth = useReauth();
  const [merchantId, setMerchantId] = useState("");
  const [paymentApiKey, setPaymentApiKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const credentials = { merchantId: merchantId.trim(), paymentApiKey, secretKey };
    const action = () =>
      api(gateway ? "/admin/billing/gateways/kashier/credentials" : "/admin/billing/gateways", {
        method: gateway ? "PUT" : "POST",
        body: gateway
          ? { credentials, reason }
          : { key: "kashier", provider: "kashier", mode: "test", credentials, reason },
        schema: gatewayViewSchema,
      });
    reauth
      .run(action)
      .then(
        () => {
          setPaymentApiKey("");
          setSecretKey("");
          setReason("");
          onSaved();
        },
        () => setError(t("admin.billing.gateways.error")),
      )
      .finally(() => setBusy(false));
  };

  return (
    <form
      onSubmit={submit}
      className="grid min-w-0 gap-4 rounded-xl border border-border bg-surface p-4 sm:p-6"
    >
      <div>
        <h2 className="text-lg font-semibold">
          {t(
            gateway ? "admin.billing.gateways.credentials.title" : "admin.billing.gateways.create",
          )}
        </h2>
        <p className="mt-1 text-sm text-text-muted">
          {t("admin.billing.gateways.credentials.note")}
        </p>
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <Field label={t("admin.billing.gateways.credentials.merchantId")} required>
          {(control) => (
            <PasswordInput
              {...control}
              value={merchantId}
              onChange={(event) => setMerchantId(event.target.value)}
              autoComplete="off"
            />
          )}
        </Field>
        <Field label={t("admin.billing.gateways.credentials.paymentApiKey")} required>
          {(control) => (
            <PasswordInput
              {...control}
              value={paymentApiKey}
              onChange={(event) => setPaymentApiKey(event.target.value)}
              autoComplete="new-password"
            />
          )}
        </Field>
        <Field label={t("admin.billing.gateways.credentials.secretKey")} required>
          {(control) => (
            <PasswordInput
              {...control}
              value={secretKey}
              onChange={(event) => setSecretKey(event.target.value)}
              autoComplete="new-password"
            />
          )}
        </Field>
        <Field label={t("admin.billing.gateways.credentials.reason")} required>
          {(control) => (
            <Input
              {...control}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={3}
              maxLength={500}
            />
          )}
        </Field>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={busy}>
          {busy
            ? t("admin.billing.gateways.loading")
            : t(
                gateway
                  ? "admin.billing.gateways.credentials.save"
                  : "admin.billing.gateways.create",
              )}
        </Button>
      </div>
    </form>
  );
}
