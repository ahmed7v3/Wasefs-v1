"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import {
  adminWhatsappCommandResponseSchema,
  adminWhatsappStatusSchema,
  type AdminWhatsappPairing,
  type AdminWhatsappStatus,
} from "@wasfa/shared/schemas/admin";
import { phoneNumberSchema } from "@wasfa/shared/schemas/auth";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Checkbox,
  Field,
  Skeleton,
  Spinner,
  useToast,
  type BadgeTone,
} from "@wasfa/ui";
import { Copy, Link2Off } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";

import { formatRelativeTime } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { useApiForm } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";
import { PhoneInput } from "../forms/phone-input";
import { Notice } from "../notice";

import { ConfirmDialog } from "./confirm-dialog";
import { CustomerMessagesCard } from "./customer-messages-card";

/** While a pairing is in progress the page asks the API this often; otherwise it only keeps the status fresh. */
export const PAIRING_POLL_MS = 2_000;
export const IDLE_POLL_MS = 15_000;

const BRIDGE_TONES: Record<AdminWhatsappStatus["bridge"]["status"], BadgeTone> = {
  connected: "success",
  connecting: "info",
  disconnected: "warning",
  logged_out: "warning",
  down: "danger",
};

const BRIDGE_LABELS = {
  connected: "admin.whatsapp.status.connected",
  connecting: "admin.whatsapp.status.connecting",
  disconnected: "admin.whatsapp.status.disconnected",
  logged_out: "admin.whatsapp.status.logged_out",
  down: "admin.whatsapp.status.down",
} as const satisfies Record<AdminWhatsappStatus["bridge"]["status"], MessageKey>;

const BRIDGE_HELP = {
  connected: "admin.whatsapp.status.help.connected",
  connecting: "admin.whatsapp.status.help.connecting",
  disconnected: "admin.whatsapp.status.help.disconnected",
  logged_out: "admin.whatsapp.status.help.logged_out",
  down: "admin.whatsapp.status.help.down",
} as const satisfies Record<AdminWhatsappStatus["bridge"]["status"], MessageKey>;

const UNAVAILABLE_MESSAGES = {
  disabled: "admin.whatsapp.status.unavailable.disabled",
  not_configured: "admin.whatsapp.status.unavailable.not_configured",
  bridge_down: "admin.whatsapp.status.unavailable.bridge_down",
} as const satisfies Record<NonNullable<AdminWhatsappStatus["unavailableReason"]>, MessageKey>;

const PAIRING_ERRORS = {
  pairing_request_failed: "admin.whatsapp.pairing.error.pairing_request_failed",
  connection_closed: "admin.whatsapp.pairing.error.connection_closed",
  timeout: "admin.whatsapp.pairing.error.timeout",
  unlink_failed: "admin.whatsapp.pairing.error.unlink_failed",
} as const satisfies Record<NonNullable<AdminWhatsappPairing["reason"]>, MessageKey>;

const STEPS = [
  "admin.whatsapp.pairing.step1",
  "admin.whatsapp.pairing.step2",
  "admin.whatsapp.pairing.step3",
  "admin.whatsapp.pairing.step4",
  "admin.whatsapp.pairing.step5",
] as const satisfies readonly MessageKey[];

/** The bridge is still working on the last command: asked for, or a code is out and valid. */
export function isPairingActive(pairing: AdminWhatsappPairing | null, now: number): boolean {
  if (!pairing) return false;
  if (pairing.state === "requested") return true;
  return (
    pairing.state === "code" &&
    pairing.expiresAt !== undefined &&
    Date.parse(pairing.expiresAt) > now
  );
}

/** `2:05` for 125 000 ms. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1_000));
  const seconds = String(total % 60).padStart(2, "0");
  return `${Math.floor(total / 60)}:${seconds}`;
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [intervalMs]);
  return now;
}

const linkFormSchema = z.object({ phoneNumber: phoneNumberSchema });

export function WhatsappView({ canWrite }: { canWrite: boolean }) {
  const resource = useResource("/admin/whatsapp", adminWhatsappStatusSchema);
  const now = useNow(1_000);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const status = resource.status === "ready" ? resource.data : null;
  const active = isPairingActive(status?.pairing ?? null, now);
  const reload = resource.reload;

  // Fast while the bridge is busy with a command, slow otherwise (the heartbeat still moves).
  useEffect(() => {
    const timer = setInterval(reload, active ? PAIRING_POLL_MS : IDLE_POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [active, reload]);

  if (resource.status === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <p className="sr-only" role="status">
          {t("ui.loading")}
        </p>
        {Array.from({ length: 3 }, (_, index) => (
          <Card key={index} elevation="flat" className="flex flex-col gap-3">
            <Skeleton className="h-7 w-1/3" />
            <Skeleton className="h-11 w-full" />
          </Card>
        ))}
      </div>
    );
  }
  if (resource.status === "error") {
    return <ErrorNotice error={resource.error} onRetry={resource.reload} />;
  }

  const data = resource.data;
  const pairing = data.pairing && data.pairing.id !== dismissed ? data.pairing : null;
  const linked = ["connected", "connecting", "disconnected"].includes(data.bridge.status);

  return (
    <div className="flex flex-col gap-5">
      {canWrite ? null : (
        <p className="text-base text-text-muted">{t("admin.whatsapp.readOnlyNote")}</p>
      )}
      <StatusCard
        status={data}
        now={now}
        canUnlink={canWrite && linked}
        onChanged={resource.reload}
      />
      {pairing ? (
        <PairingCard
          pairing={pairing}
          now={now}
          onDismiss={() => {
            setDismissed(pairing.id);
          }}
        />
      ) : null}
      {canWrite && !linked && !isPairingActive(pairing, now) ? (
        <LinkCard bridgeDown={data.bridge.status === "down"} onQueued={resource.reload} />
      ) : null}
      <VerificationCard
        enabled={data.phoneVerification === "whatsapp_inbound"}
        canWrite={canWrite}
        onChanged={resource.reload}
      />
      <CustomerMessagesCard
        value={data.customerMessages}
        canWrite={canWrite}
        onChanged={resource.reload}
      />
      <p className="text-base text-text-muted">
        {t("admin.whatsapp.agentLink.lead")}{" "}
        <Link href="/admin/whatsapp/agent" className="font-semibold text-primary underline">
          {t("admin.whatsapp.agentLink.link")}
        </Link>
      </p>
    </div>
  );
}

function StatusCard({
  status,
  now,
  canUnlink,
  onChanged,
}: {
  status: AdminWhatsappStatus;
  now: number;
  canUnlink: boolean;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const state = status.bridge.status;

  const unlink = async (): Promise<void> => {
    await api("/admin/whatsapp/unlink", {
      method: "POST",
      schema: adminWhatsappCommandResponseSchema,
    });
    toast({ tone: "success", title: t("admin.whatsapp.unlink.sent") });
    onChanged();
  };

  return (
    <Card elevation="flat" padding="compact" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle>{t("admin.whatsapp.status.title")}</CardTitle>
          <p className="text-sm text-text-muted">{t(BRIDGE_HELP[state])}</p>
        </div>
        <Badge tone={BRIDGE_TONES[state]}>{t(BRIDGE_LABELS[state])}</Badge>
      </div>

      <dl className="grid gap-3 text-base sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-text-muted">{t("admin.whatsapp.status.number")}</dt>
          <dd>
            {status.number ? (
              <>
                <bdi dir="ltr" className="font-mono">
                  {status.number}
                </bdi>
                {status.numberSource ? (
                  <span className="text-sm text-text-muted">
                    {" "}
                    ({t(`admin.whatsapp.status.source.${status.numberSource}`)})
                  </span>
                ) : null}
              </>
            ) : (
              t("admin.whatsapp.status.noNumber")
            )}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-text-muted">{t("admin.whatsapp.status.lastBeat")}</dt>
          <dd>
            {status.bridge.lastBeatAt
              ? formatRelativeTime(status.bridge.lastBeatAt, now)
              : t("admin.whatsapp.status.noBeat")}
          </dd>
        </div>
      </dl>

      <Notice tone={status.available ? "success" : "warning"}>
        {status.available
          ? t("admin.whatsapp.status.available")
          : t(UNAVAILABLE_MESSAGES[status.unavailableReason ?? "bridge_down"])}
      </Notice>

      {canUnlink ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="danger"
            name="unlink-whatsapp"
            onClick={() => {
              setConfirming(true);
            }}
          >
            <Link2Off aria-hidden className="size-5" />
            {t("admin.whatsapp.unlink.button")}
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("admin.whatsapp.unlink.title")}
        description={t("admin.whatsapp.unlink.body")}
        confirmLabel={t("admin.whatsapp.unlink.confirm")}
        tone="danger"
        onConfirm={unlink}
      />
    </Card>
  );
}

function LinkCard({ bridgeDown, onQueued }: { bridgeDown: boolean; onQueued: () => void }) {
  const reauth = useReauth();
  const form = useApiForm({
    schema: linkFormSchema,
    initial: { phoneNumber: "" },
    submit: async ({ phoneNumber }) => {
      await reauth.run(() =>
        api("/admin/whatsapp/link", {
          method: "POST",
          body: { number: phoneNumber },
          schema: adminWhatsappCommandResponseSchema,
        }),
      );
      onQueued();
    },
  });

  return (
    <Card elevation="flat" padding="compact" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <CardTitle>{t("admin.whatsapp.link.title")}</CardTitle>
        <p className="text-sm text-text-muted">{t("admin.whatsapp.link.lead")}</p>
      </div>
      {bridgeDown ? <Notice tone="warning">{t("admin.whatsapp.link.blockedDown")}</Notice> : null}
      <form
        aria-label={t("admin.whatsapp.link.title")}
        onSubmit={form.handleSubmit}
        noValidate
        className="flex flex-col gap-4"
      >
        <Field
          label={t("admin.whatsapp.link.numberLabel")}
          hint={t("admin.whatsapp.link.numberHint")}
          required
          error={form.errors["phoneNumber"]}
          announceError={form.submitCount > 0}
        >
          {(control) => (
            <PhoneInput
              {...control}
              name="phoneNumber"
              disabled={bridgeDown}
              onChange={(value) => {
                form.setValue("phoneNumber", value);
              }}
              onBlur={() => {
                form.blur("phoneNumber");
              }}
            />
          )}
        </Field>
        {form.formError ? <ErrorNotice error={form.formError} supportHref={null} /> : null}
        <div className="flex justify-end">
          <Button
            type="submit"
            name="link-whatsapp"
            loading={form.submitting}
            disabled={bridgeDown}
          >
            {t("admin.whatsapp.link.submit")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PairingCard({
  pairing,
  now,
  onDismiss,
}: {
  pairing: AdminWhatsappPairing;
  now: number;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const expiresAt = pairing.expiresAt ? Date.parse(pairing.expiresAt) : null;
  const expired = pairing.state === "code" && expiresAt !== null && expiresAt <= now;

  const copy = (code: string) => {
    navigator.clipboard.writeText(code).then(
      () => {
        setCopied(true);
      },
      () => {
        // Clipboard blocked: the code is on screen and selectable.
      },
    );
  };

  if (pairing.state === "requested") {
    return (
      <Card elevation="flat" padding="compact" className="flex items-center gap-3" aria-busy="true">
        <Spinner decorative />
        <p role="status" className="text-base text-text">
          {t("admin.whatsapp.pairing.requested")}
        </p>
      </Card>
    );
  }

  if (pairing.state === "code" && pairing.code && !expired) {
    const code = pairing.code;
    return (
      <Card elevation="flat" padding="compact" className="flex flex-col gap-4">
        <CardTitle>{t("admin.whatsapp.pairing.title", { number: pairing.number ?? "" })}</CardTitle>
        <div className="flex flex-col items-center gap-3 rounded-lg bg-primary-soft p-5">
          <p className="text-sm text-text-muted">{t("admin.whatsapp.pairing.codeLabel")}</p>
          <p
            dir="ltr"
            data-testid="pairing-code"
            className="select-all font-mono text-4xl font-bold tracking-widest text-primary sm:text-5xl"
          >
            {`${code.slice(0, 4)}-${code.slice(4)}`}
          </p>
          <Button
            type="button"
            variant="secondary"
            name="copy-pairing-code"
            onClick={() => {
              copy(code);
            }}
          >
            <Copy aria-hidden className="size-4" />
            {copied ? t("common.copied") : t("admin.whatsapp.pairing.copy")}
          </Button>
          {expiresAt !== null ? (
            <p role="timer" className="text-sm tabular-nums text-text-muted">
              {t("admin.whatsapp.pairing.expiresIn", { time: formatCountdown(expiresAt - now) })}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="font-heading text-lg font-semibold text-text">
            {t("admin.whatsapp.pairing.stepsTitle")}
          </h3>
          <ol className="flex list-decimal flex-col gap-2 ps-6 text-base text-text">
            {STEPS.map((step) => (
              <li key={step}>{t(step)}</li>
            ))}
          </ol>
        </div>
      </Card>
    );
  }

  const outcome = outcomeOf(pairing, expired);
  return (
    <div className="flex flex-col gap-3">
      <Notice tone={outcome.tone}>{outcome.message}</Notice>
      <div className="flex justify-end">
        <Button type="button" variant="ghost" name="dismiss-pairing" onClick={onDismiss}>
          {t("admin.whatsapp.pairing.dismiss")}
        </Button>
      </div>
    </div>
  );
}

function outcomeOf(
  pairing: AdminWhatsappPairing,
  expired: boolean,
): { tone: "success" | "warning"; message: string } {
  if (expired) return { tone: "warning", message: t("admin.whatsapp.pairing.expired") };
  switch (pairing.state) {
    case "linked":
      return { tone: "success", message: t("admin.whatsapp.pairing.linked") };
    case "unlinked":
      return { tone: "success", message: t("admin.whatsapp.pairing.unlinked") };
    case "already_linked":
      return { tone: "warning", message: t("admin.whatsapp.pairing.alreadyLinked") };
    default:
      return {
        tone: "warning",
        message: t(PAIRING_ERRORS[pairing.reason ?? "pairing_request_failed"]),
      };
  }
}

function VerificationCard({
  enabled,
  canWrite,
  onChanged,
}: {
  enabled: boolean;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const reauth = useReauth();
  const { toast } = useToast();
  const [confirmingOff, setConfirmingOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  const apply = async (next: boolean): Promise<void> => {
    await reauth.run(() =>
      api("/admin/whatsapp/verification", {
        method: "PUT",
        body: { enabled: next },
        schema: adminWhatsappStatusSchema,
      }),
    );
    toast({
      tone: "success",
      title: t(next ? "admin.whatsapp.verification.onDone" : "admin.whatsapp.verification.offDone"),
    });
    onChanged();
  };

  const turnOn = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      await apply(true);
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card elevation="flat" padding="compact" className="flex flex-col gap-3">
      <CardTitle>{t("admin.whatsapp.verification.title")}</CardTitle>
      <Checkbox
        role="switch"
        name="phone-verification"
        label={t("admin.whatsapp.verification.label")}
        checked={enabled}
        disabled={!canWrite || busy}
        onChange={(event) => {
          if (event.target.checked) void turnOn();
          else setConfirmingOff(true);
        }}
      />
      <p className="text-sm text-text-muted">{t("admin.whatsapp.verification.hint")}</p>
      {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}
      <ConfirmDialog
        open={confirmingOff}
        onOpenChange={setConfirmingOff}
        title={t("admin.whatsapp.verification.offTitle")}
        description={t("admin.whatsapp.verification.offBody")}
        confirmLabel={t("admin.whatsapp.verification.offConfirm")}
        tone="danger"
        onConfirm={() => apply(false)}
      />
    </Card>
  );
}
