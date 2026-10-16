"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import {
  gatewayConnectionResultSchema,
  gatewayListSchema,
  gatewayTestStartResponseSchema,
  gatewayTestViewSchema,
  gatewayViewSchema,
  type GatewayTestView,
  type GatewayView,
} from "@wasfa/shared/schemas/admin-billing-gateways";
import { Badge, Button, Field, Input, useToast } from "@wasfa/ui";
import { Check, Copy, ExternalLink, LoaderCircle, PlugZap } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../lib/api-client";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { errorMessage } from "../error-notice";

import { GatewayCredentialsForm } from "./gateway-credentials-form";

const dateText = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(value),
      )
    : "—";
const connectionErrorKeys: Record<string, MessageKey> = {
  auth: "admin.billing.gateways.connection.error.auth",
  unavailable: "admin.billing.gateways.connection.error.unavailable",
  no_credentials: "admin.billing.gateways.connection.error.no_credentials",
};

function CheckItem({ label, done }: { label: string; done: boolean }) {
  return (
    <li className="flex min-w-0 items-start gap-2 text-sm">
      <span
        className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${done ? "bg-success/10 text-success" : "bg-subtle text-text-muted"}`}
        aria-label={done ? "✓" : undefined}
      >
        {done ? <Check size={14} aria-hidden="true" /> : null}
      </span>
      <span>{label}</span>
    </li>
  );
}

function TestPanel({
  gateway,
  canWrite,
  testId,
  onTestChange,
}: {
  gateway: GatewayView;
  canWrite: boolean;
  testId: string | null;
  onTestChange: (id: string) => void;
}) {
  const reauth = useReauth();
  const [amount, setAmount] = useState("1");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<GatewayTestView | null>(null);
  const autoCheck = useRef<string | null>(null);

  useEffect(() => {
    if (!testId) return;
    api(`/admin/billing/gateways/${gateway.key}/test-payments/${testId}`, {
      schema: gatewayTestViewSchema,
    })
      .then(
        (value) => {
          setTest(value);
          if (!canWrite || autoCheck.current === testId) return;
          autoCheck.current = testId;
          return api(`/admin/billing/gateways/${gateway.key}/test-payments/${testId}/check`, {
            method: "POST",
            schema: gatewayTestViewSchema,
          }).then(setTest);
        },
        (reason: unknown) => setError(errorMessage(reason)),
      )
      .catch((reason: unknown) => setError(errorMessage(reason)));
  }, [canWrite, gateway.key, testId]);

  const start = () => {
    if (!canWrite || busy) return;
    const checkoutTab = window.open("about:blank", "_blank");
    if (!checkoutTab) {
      setError(t("admin.billing.gateways.error"));
      return;
    }
    checkoutTab.opener = null;
    setBusy(true);
    setError(null);
    const action = () =>
      api(`/admin/billing/gateways/${gateway.key}/test-payments`, {
        method: "POST",
        body: {
          amountMinor: Number(amount) * 100,
          ...(gateway.mode === "live" ? { confirm } : {}),
        },
        schema: gatewayTestStartResponseSchema,
      });
    reauth
      .run(action)
      .then(
        (result) => {
          onTestChange(result.id);
          checkoutTab.location.href = result.redirectUrl;
        },
        (reason: unknown) => {
          checkoutTab.close();
          setError(errorMessage(reason));
        },
      )
      .finally(() => setBusy(false));
  };

  const check = () => {
    if (!testId || busy) return;
    setBusy(true);
    setError(null);
    api(`/admin/billing/gateways/${gateway.key}/test-payments/${testId}/check`, {
      method: "POST",
      schema: gatewayTestViewSchema,
    })
      .then(setTest, (reason: unknown) => setError(errorMessage(reason)))
      .finally(() => setBusy(false));
  };

  return (
    <section
      className="grid min-w-0 gap-4 rounded-xl border border-border bg-surface p-4 sm:p-6"
      aria-labelledby="gateway-verify-title"
    >
      <div>
        <h2 id="gateway-verify-title" className="text-lg font-semibold">
          {t("admin.billing.gateways.verify.title")}
        </h2>
        <p className="mt-1 text-sm text-text-muted">{t("admin.billing.gateways.verify.intro")}</p>
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,12rem)_auto] sm:items-end">
        <Field label={t("admin.billing.gateways.verify.amount")}>
          {(control) => (
            <Input
              {...control}
              type="number"
              inputMode="numeric"
              min={1}
              max={50}
              step={1}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              disabled={!canWrite}
            />
          )}
        </Field>
        {gateway.mode === "live" ? (
          <Field label={t("admin.billing.gateways.verify.liveConfirm")}>
            {(control) => (
              <Input
                {...control}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                autoComplete="off"
              />
            )}
          </Field>
        ) : null}
        {gateway.mode === "live" ? (
          <p className="text-sm font-medium text-warning sm:col-span-2">
            {t("admin.billing.gateways.verify.liveWarning")}
          </p>
        ) : null}
        <Button
          type="button"
          onClick={start}
          disabled={!canWrite || busy || (gateway.mode === "live" && confirm !== "LIVE")}
        >
          <PlugZap size={16} />
          {t("admin.billing.gateways.verify.start")}
        </Button>
      </div>
      {test ? (
        <div className="grid min-w-0 gap-4 border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              tone={
                test.status === "succeeded"
                  ? "success"
                  : test.status === "mismatch" || test.status === "failed"
                    ? "danger"
                    : "warning"
              }
            >
              {t(`admin.billing.gateways.status.${test.status}`)}
            </Badge>
            <span className="break-all font-mono text-xs text-text-muted">
              {test.providerOrderId}
            </span>
            <span className="text-sm text-text-muted">
              {test.amountMinor / 100} {test.currency}
            </span>
          </div>
          <ul className="grid min-w-0 gap-3 sm:grid-cols-2">
            <CheckItem
              label={t("admin.billing.gateways.verify.checkout")}
              done={test.checklist.checkoutCreated}
            />
            <CheckItem label={t("admin.billing.gateways.verify.paid")} done={test.checklist.paid} />
            <CheckItem
              label={t("admin.billing.gateways.verify.webhook")}
              done={test.checklist.webhookReceived}
            />
            <CheckItem
              label={t("admin.billing.gateways.verify.signature")}
              done={test.checklist.signatureValid}
            />
            <CheckItem
              label={t("admin.billing.gateways.verify.amountMatches")}
              done={test.checklist.amountMatches}
            />
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" onClick={check} disabled={!canWrite || busy}>
              {busy ? <LoaderCircle className="animate-spin" size={16} /> : null}
              {t("admin.billing.gateways.verify.check")}
            </Button>
            <span className="text-sm text-text-muted">
              {t("admin.billing.gateways.credentialsUpdated")}: {dateText(test.statusCheckedAt)}
            </span>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export function BillingGatewaysView({ canWrite }: { canWrite: boolean }) {
  const resource = useResource("/admin/billing/gateways", gatewayListSchema);
  const reauth = useReauth();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [testId, setTestId] = useState<string | null>(null);
  const [mode, setMode] = useState<"test" | "live">("test");
  const [modeConfirm, setModeConfirm] = useState("");
  const [reason, setReason] = useState("");
  const [actionReason, setActionReason] = useState("");
  const [tick, setTick] = useState(0);
  const gateway = resource.status === "ready" ? resource.data.items[0] : undefined;
  const gatewayMode = gateway?.mode;

  useEffect(() => {
    const queryTest = new URLSearchParams(window.location.search).get("test");
    if (queryTest) setTestId(queryTest);
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (gatewayMode) setMode(gatewayMode);
  }, [gatewayMode]);

  const mutate = (path: string, body: unknown, fresh = true) => {
    if (busy) return;
    setBusy(true);
    const action = () => api(path, { method: "PUT", body, schema: gatewayViewSchema });
    (fresh ? reauth.run(action) : action())
      .then(
        () => {
          setReason("");
          setModeConfirm("");
          resource.reload();
          toast({ tone: "success", title: t("admin.billing.gateways.saved") });
        },
        (error: unknown) => toast({ tone: "error", title: errorMessage(error) }),
      )
      .finally(() => setBusy(false));
  };

  const toggleMethod = (method: GatewayView["methods"][number], enabled: boolean) => {
    if (!gateway) return;
    const action = () =>
      api(`/admin/billing/gateways/${gateway.key}/methods/${method.key}`, {
        method: "PUT",
        body: { enabled, reason: actionReason },
        schema: gatewayViewSchema,
      });
    reauth.run(action).then(
      () => {
        setActionReason("");
        resource.reload();
      },
      (error: unknown) => toast({ tone: "error", title: errorMessage(error) }),
    );
  };

  const testConnection = () => {
    if (!gateway || busy) return;
    setBusy(true);
    api(`/admin/billing/gateways/${gateway.key}/test-connection`, {
      method: "POST",
      schema: gatewayConnectionResultSchema,
    })
      .then(
        (result) => {
          resource.reload();
          toast({
            tone: result.ok ? "success" : "error",
            title: t(
              result.ok
                ? "admin.billing.gateways.connection.ok"
                : (connectionErrorKeys[result.errorCode ?? ""] ??
                    "admin.billing.gateways.connection.failed"),
            ),
          });
        },
        (error: unknown) => toast({ tone: "error", title: errorMessage(error) }),
      )
      .finally(() => setBusy(false));
  };

  const copyWebhook = async () => {
    if (!gateway) return;
    await navigator.clipboard.writeText(gateway.webhookUrl);
    toast({ tone: "success", title: t("admin.billing.gateways.copied") });
  };

  if (resource.status === "loading")
    return (
      <div className="mx-auto grid w-full max-w-5xl gap-5 px-4 py-6 sm:px-6">
        <div className="h-8 w-64 animate-pulse rounded bg-subtle" />
        <div className="h-48 animate-pulse rounded-xl bg-subtle" />
      </div>
    );
  if (resource.status === "error")
    return (
      <div role="alert" className="mx-auto max-w-5xl px-4 py-6 text-sm text-danger">
        {errorMessage(resource.error)}
      </div>
    );

  return (
    <main className="mx-auto grid w-full max-w-5xl min-w-0 gap-5 px-4 py-6 sm:px-6 lg:py-8">
      <header className="grid gap-2">
        <h1 className="text-2xl font-bold tracking-tight">{t("admin.billing.gateways.title")}</h1>
        <p className="max-w-3xl text-sm leading-6 text-text-muted">
          {t("admin.billing.gateways.intro")}
        </p>
      </header>
      {!gateway ? (
        <>
          <p className="rounded-xl border border-border bg-surface p-4 text-sm text-text-muted">
            {t("admin.billing.gateways.empty")}
          </p>
          {canWrite ? <GatewayCredentialsForm gateway={null} onSaved={resource.reload} /> : null}
        </>
      ) : (
        <>
          <section className="grid min-w-0 gap-4 rounded-xl border border-border bg-surface p-4 sm:p-6">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold">{t("admin.billing.gateways.provider")}</h2>
                <Badge tone={gateway.mode === "test" ? "info" : "warning"}>
                  {t(`admin.billing.gateways.mode.${gateway.mode}`)}
                </Badge>
                <Badge tone={gateway.enabled ? "success" : "neutral"}>
                  {t(
                    gateway.enabled
                      ? "admin.billing.gateways.enabled"
                      : "admin.billing.gateways.disabled",
                  )}
                </Badge>
              </div>
              <span className="font-mono text-sm">{gateway.key}</span>
            </div>
            <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-text-muted">{t("admin.billing.gateways.merchant")}</dt>
                <dd className="mt-1 break-all font-medium">{gateway.merchantRef ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-text-muted">{t("admin.billing.gateways.keyHint")}</dt>
                <dd className="mt-1 font-mono">{gateway.keyHint ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-text-muted">
                  {t("admin.billing.gateways.credentialsUpdated")}
                </dt>
                <dd className="mt-1">{dateText(gateway.credentialsUpdatedAt)}</dd>
              </div>
            </dl>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={testConnection}
                disabled={!canWrite || busy}
              >
                <PlugZap size={16} />
                {t("admin.billing.gateways.connection.run")}
              </Button>
              <span className="text-sm text-text-muted">
                {gateway.lastTestAt
                  ? `${dateText(gateway.lastTestAt)} · ${t(gateway.lastTestOk ? "admin.billing.gateways.connection.ok" : (connectionErrorKeys[gateway.lastTestError ?? ""] ?? "admin.billing.gateways.connection.failed"))}`
                  : "—"}
              </span>
            </div>
          </section>

          {canWrite ? (
            <GatewayCredentialsForm
              key={gateway.credentialsUpdatedAt ?? "credentials"}
              gateway={gateway}
              onSaved={resource.reload}
            />
          ) : null}

          <section className="grid min-w-0 gap-4 rounded-xl border border-border bg-surface p-4 sm:p-6">
            <div>
              <h2 className="text-lg font-semibold">{t("admin.billing.gateways.mode.change")}</h2>
              <p className="mt-1 text-sm text-text-muted">
                {t("admin.billing.gateways.credentialsUpdated")}: {dateText(gateway.verifiedAt)}
              </p>
            </div>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <Field label={t("admin.billing.gateways.mode.change")}>
                {(control) => (
                  <select
                    {...control}
                    className="min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm"
                    value={mode}
                    onChange={(event) => setMode(event.target.value as "test" | "live")}
                  >
                    <option value="test">{t("admin.billing.gateways.mode.test")}</option>
                    <option value="live">{t("admin.billing.gateways.mode.live")}</option>
                  </select>
                )}
              </Field>
              <Field label={t("admin.billing.gateways.mode.reason")}>
                {(control) => (
                  <Input
                    {...control}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    maxLength={500}
                  />
                )}
              </Field>
              {mode === "live" && gateway.mode !== "live" ? (
                <Field label={t("admin.billing.gateways.mode.confirm")}>
                  {(control) => (
                    <Input
                      {...control}
                      value={modeConfirm}
                      onChange={(event) => setModeConfirm(event.target.value)}
                    />
                  )}
                </Field>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                disabled={
                  !canWrite ||
                  busy ||
                  mode === gateway.mode ||
                  reason.trim().length < 3 ||
                  (mode === "live" && gateway.mode !== "live" && modeConfirm !== "LIVE")
                }
                onClick={() =>
                  mutate(`/admin/billing/gateways/${gateway.key}/mode`, {
                    mode,
                    reason,
                    ...(mode === "live" ? { confirm: modeConfirm } : {}),
                  })
                }
              >
                {t("admin.billing.gateways.mode.change")}
              </Button>
            </div>
          </section>

          <TestPanel
            gateway={gateway}
            canWrite={canWrite && gateway.hasCredentials}
            testId={testId}
            onTestChange={setTestId}
          />

          <section className="grid min-w-0 gap-3 rounded-xl border border-border bg-surface p-4 sm:p-6">
            <h2 className="text-lg font-semibold">{t("admin.billing.gateways.webhook.title")}</h2>
            <p className="text-sm leading-6 text-text-muted">
              {t("admin.billing.gateways.webhook.instruction")}
            </p>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <code dir="ltr" className="min-w-0 flex-1 break-all rounded-lg bg-subtle p-3 text-xs">
                {gateway.webhookUrl}
              </code>
              <Button
                type="button"
                variant="secondary"
                onClick={copyWebhook}
                aria-label={t("admin.billing.gateways.webhook.copy")}
              >
                <Copy size={16} />
                <span className="sr-only">{t("admin.billing.gateways.webhook.copy")}</span>
              </Button>
              <a
                className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-primary underline"
                href={gateway.webhookUrl}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={16} />
                {t("admin.billing.gateways.webhook.title")}
              </a>
            </div>
            <p className="text-sm text-text-muted">
              {t("admin.billing.gateways.webhook.last")}: {dateText(gateway.lastWebhookAt)} ·{" "}
              {gateway.lastWebhookAt
                ? t(
                    gateway.lastWebhookOk
                      ? "admin.billing.gateways.webhook.ok"
                      : "admin.billing.gateways.webhook.bad",
                  )
                : "—"}
            </p>
          </section>

          <section className="grid min-w-0 gap-4 rounded-xl border border-border bg-surface p-4 sm:p-6">
            <h2 className="text-lg font-semibold">{t("admin.billing.gateways.enable")}</h2>
            {gateway.blockers.length ? (
              <ul className="grid gap-2 text-sm text-warning">
                {gateway.blockers.map((blocker) => (
                  <li key={blocker}>{t(`admin.billing.gateways.blocker.${blocker}`)}</li>
                ))}
              </ul>
            ) : null}
            {gateway.blockers.includes("cooldown") && gateway.cooldownEndsAt ? (
              <p className="text-sm text-text-muted">
                {t("admin.billing.gateways.cooldown")}:{" "}
                {Math.max(
                  0,
                  Math.ceil((new Date(gateway.cooldownEndsAt).getTime() - Date.now()) / 1000),
                )}
                s
              </p>
            ) : null}
            <Field label={t("admin.billing.gateways.reason")}>
              {(control) => (
                <Input
                  {...control}
                  value={actionReason}
                  onChange={(event) => setActionReason(event.target.value)}
                  maxLength={500}
                />
              )}
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex min-h-11 items-center gap-3 text-sm font-medium">
                <input
                  type="checkbox"
                  className="size-5 accent-primary"
                  checked={gateway.enabled}
                  disabled={
                    !canWrite ||
                    busy ||
                    actionReason.trim().length < 3 ||
                    (!gateway.enabled && !gateway.canEnable)
                  }
                  onChange={(event) =>
                    mutate(`/admin/billing/gateways/${gateway.key}/enabled`, {
                      enabled: event.target.checked,
                      reason: actionReason,
                    })
                  }
                />
                {t("admin.billing.gateways.enable")}
              </label>
            </div>
          </section>

          <section className="grid min-w-0 gap-3 rounded-xl border border-border bg-surface p-4 sm:p-6">
            <h2 className="text-lg font-semibold">{t("admin.billing.gateways.methods.title")}</h2>
            <Field label={t("admin.billing.gateways.reason")}>
              {(control) => (
                <Input
                  {...control}
                  value={actionReason}
                  onChange={(event) => setActionReason(event.target.value)}
                  maxLength={500}
                />
              )}
            </Field>
            {gateway.methods.map((method) => (
              <label
                key={method.key}
                className="flex min-h-12 min-w-0 items-center justify-between gap-3 border-t border-border py-3 text-sm"
              >
                <span className="min-w-0">
                  <span className="block font-medium">{method.nameAr}</span>
                  <span className="text-text-muted">{method.nameEn}</span>
                </span>
                <input
                  type="checkbox"
                  className="size-5 shrink-0 accent-primary"
                  checked={method.enabled}
                  disabled={
                    !canWrite ||
                    busy ||
                    actionReason.trim().length < 3 ||
                    (!method.enabled && !gateway.enabled)
                  }
                  onChange={(event) => toggleMethod(method, event.target.checked)}
                />
              </label>
            ))}
          </section>
        </>
      )}
      <span className="sr-only" aria-live="polite">
        {tick}
      </span>
    </main>
  );
}
