"use client";

import { t } from "@wasfa/shared/i18n";
import { twoFactorEnableSchema, twoFactorVerifyTotpSchema } from "@wasfa/shared/schemas/auth";
import { Badge, Button, Card, Field, Input, PasswordInput, useToast } from "@wasfa/ui";
import { ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";

import { api } from "../../lib/api-client";
import { useApiForm } from "../../lib/forms";
import { useQrCode } from "../../lib/use-qr-code";
import { ErrorNotice } from "../error-notice";

import { BackupCodes } from "./backup-codes";
import { PasswordConfirmDialog } from "./password-confirm-dialog";

const enableResponseSchema = z.object({
  totpURI: z.string().min(1),
  backupCodes: z.array(z.string()).min(1),
});
const backupCodesResponseSchema = z.object({ backupCodes: z.array(z.string()).min(1) });

type Phase =
  | { kind: "idle" }
  | { kind: "password" }
  | { kind: "scan"; totpURI: string; backupCodes: string[] }
  // Backup codes are held only here, only until the user confirms they saved them.
  | { kind: "codes"; codes: string[]; setUp: boolean };

type Dialogs = "none" | "disable" | "regenerate";

/** The manual key inside a `otpauth://` URI, shown beside the QR for people who cannot scan. */
export function secretFromUri(uri: string): string {
  try {
    return new URL(uri).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

function PasswordStep({
  onStarted,
  onCancel,
}: {
  onStarted: (phase: Phase) => void;
  onCancel: () => void;
}) {
  const form = useApiForm({
    schema: twoFactorEnableSchema,
    initial: { password: "" },
    submit: async (values) => {
      const result = await api("/auth/two-factor/enable", {
        method: "POST",
        body: values,
        schema: enableResponseSchema,
      });
      onStarted({ kind: "scan", totpURI: result.totpURI, backupCodes: result.backupCodes });
    },
  });
  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex max-w-md flex-col gap-4">
      <Field
        label={t("auth.field.password")}
        hint={t("account.twoFactor.passwordHint")}
        required
        error={form.errors["password"]}
        announceError={form.submitCount > 0}
      >
        {(control) => (
          <PasswordInput {...control} {...form.bind("password")} autoComplete="current-password" />
        )}
      </Field>
      {form.formError ? <ErrorNotice error={form.formError} /> : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" name="start-two-factor" loading={form.submitting}>
          {t("account.twoFactor.start")}
        </Button>
        <Button type="button" variant="ghost" name="cancel-two-factor" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}

function ScanStep({
  totpURI,
  onConfirmed,
  onCancel,
}: {
  totpURI: string;
  onConfirmed: () => void;
  onCancel: () => void;
}) {
  const qr = useQrCode(totpURI);
  const secret = secretFromUri(totpURI);
  const form = useApiForm({
    schema: twoFactorVerifyTotpSchema.pick({ code: true }),
    initial: { code: "" },
    submit: async (values) => {
      await api("/auth/two-factor/verify-totp", { method: "POST", body: values });
      onConfirmed();
    },
  });
  return (
    <div className="flex max-w-md flex-col gap-4">
      <p className="text-base text-text">{t("account.twoFactor.scan")}</p>
      {qr ? (
        <div className="flex justify-center rounded-lg bg-white p-2">
          {/* A data: URL image: next/image has nothing to optimise here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt={t("account.twoFactor.qrAlt")} width={208} height={208} />
        </div>
      ) : null}
      {secret ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-text-muted">{t("account.twoFactor.manual")}</p>
          <p
            dir="ltr"
            className="select-all break-all rounded-md bg-primary-soft px-3 py-2 text-start font-mono text-base text-text"
          >
            {secret}
          </p>
        </div>
      ) : null}
      <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-4">
        <Field
          label={t("account.twoFactor.codeLabel")}
          required
          error={form.errors["code"]}
          announceError={form.submitCount > 0}
        >
          {(control) => (
            <Input
              {...control}
              {...form.bind("code")}
              ltr
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
            />
          )}
        </Field>
        {form.formError ? <ErrorNotice error={form.formError} /> : null}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" name="confirm-two-factor" loading={form.submitting}>
            {t("account.twoFactor.confirm")}
          </Button>
          <Button type="button" variant="ghost" name="cancel-two-factor" onClick={onCancel}>
            {t("account.twoFactor.cancel")}
          </Button>
        </div>
      </form>
    </div>
  );
}

export interface TwoFactorPanelProps {
  enabled: boolean;
}

/**
 * Two-step verification: turn on (password, then QR and a first code, then the backup codes once),
 * turn off, and regenerate the backup codes. The server is the only source of truth for the secret
 * and the codes; this component keeps the codes in state only until the user confirms they saved them.
 */
export function TwoFactorPanel({ enabled: initiallyEnabled }: TwoFactorPanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dialog, setDialog] = useState<Dialogs>("none");

  const closeDialog = () => {
    setDialog("none");
  };

  return (
    <Card className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center gap-3">
        <ShieldCheck aria-hidden className="size-6 text-primary" />
        <h2 className="font-heading text-xl font-semibold text-text">
          {t("account.twoFactor.title")}
        </h2>
        <Badge tone={enabled ? "success" : "neutral"}>
          {enabled ? t("account.twoFactor.on") : t("account.twoFactor.off")}
        </Badge>
      </header>

      {phase.kind === "idle" ? (
        <>
          <p className="text-base text-text-muted">{t("account.twoFactor.lead")}</p>
          <div className="flex flex-wrap gap-3">
            {enabled ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  name="regenerate-codes"
                  onClick={() => {
                    setDialog("regenerate");
                  }}
                >
                  {t("account.twoFactor.regenerate")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  name="disable-two-factor"
                  onClick={() => {
                    setDialog("disable");
                  }}
                >
                  {t("account.twoFactor.disable")}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                name="enable-two-factor"
                onClick={() => {
                  setPhase({ kind: "password" });
                }}
              >
                {t("account.twoFactor.enable")}
              </Button>
            )}
          </div>
        </>
      ) : null}

      {phase.kind === "password" ? (
        <PasswordStep
          onStarted={setPhase}
          onCancel={() => {
            setPhase({ kind: "idle" });
          }}
        />
      ) : null}

      {phase.kind === "scan" ? (
        <ScanStep
          totpURI={phase.totpURI}
          onConfirmed={() => {
            setPhase({ kind: "codes", codes: phase.backupCodes, setUp: true });
            setEnabled(true);
          }}
          onCancel={() => {
            setPhase({ kind: "idle" });
          }}
        />
      ) : null}

      {phase.kind === "codes" ? (
        <BackupCodes
          codes={phase.codes}
          onDone={() => {
            setPhase({ kind: "idle" });
            if (phase.setUp) toast({ tone: "success", title: t("account.twoFactor.enabledDone") });
            router.refresh();
          }}
        />
      ) : null}

      <PasswordConfirmDialog
        open={dialog === "disable"}
        title={t("account.twoFactor.disableTitle")}
        description={t("account.twoFactor.disableBody")}
        confirmLabel={t("account.twoFactor.disable")}
        confirmVariant="danger"
        onClose={closeDialog}
        onConfirm={async (password) => {
          await api("/auth/two-factor/disable", { method: "POST", body: { password } });
          setEnabled(false);
          closeDialog();
          toast({ tone: "success", title: t("account.twoFactor.disabledDone") });
          router.refresh();
        }}
      />
      <PasswordConfirmDialog
        open={dialog === "regenerate"}
        title={t("account.twoFactor.regenerateTitle")}
        description={t("account.twoFactor.regenerateBody")}
        confirmLabel={t("account.twoFactor.regenerate")}
        onClose={closeDialog}
        onConfirm={async (password) => {
          const result = await api("/auth/two-factor/generate-backup-codes", {
            method: "POST",
            body: { password },
            schema: backupCodesResponseSchema,
          });
          closeDialog();
          setPhase({ kind: "codes", codes: result.backupCodes, setUp: false });
        }}
      />
    </Card>
  );
}
