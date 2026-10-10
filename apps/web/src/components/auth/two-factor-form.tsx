"use client";

import { t } from "@wasfa/shared/i18n";
import {
  twoFactorVerifyBackupCodeSchema,
  twoFactorVerifyTotpSchema,
} from "@wasfa/shared/schemas/auth";
import { normalizeDigits } from "@wasfa/shared/schemas/phone";
import { Button, Field, Input } from "@wasfa/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { api } from "../../lib/api-client";
import { useApiForm } from "../../lib/forms";
import { ErrorNotice } from "../error-notice";

export interface TwoFactorFormProps {
  /** Already vetted by `safeNext`. */
  next: string;
}

function TotpForm({ next, onUseBackup }: TwoFactorFormProps & { onUseBackup: () => void }) {
  const router = useRouter();
  const form = useApiForm({
    schema: twoFactorVerifyTotpSchema,
    initial: { code: "" },
    holdOnSuccess: true,
    submit: async (values) => {
      await api("/auth/two-factor/verify-totp", { method: "POST", body: { code: values.code } });
      router.replace(next);
    },
  });

  return (
    <form
      onSubmit={form.handleSubmit}
      noValidate
      className="flex flex-col gap-5"
      aria-label={t("auth.twoFactor.title")}
    >
      <Field
        label={t("auth.twoFactor.codeLabel")}
        hint={t("auth.twoFactor.codeHint")}
        required
        error={form.errors["code"]}
        announceError={form.submitCount > 0}
      >
        {(control) => (
          <Input
            {...control}
            name="code"
            value={form.values.code}
            onBlur={() => {
              form.blur("code");
            }}
            onChange={(event) => {
              // Digits only; an Arabic keyboard types Arabic-Indic digits.
              form.setValue(
                "code",
                normalizeDigits(event.target.value).replace(/\D/g, "").slice(0, 6),
              );
            }}
            ltr
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            className="text-center text-xl tracking-widest"
          />
        )}
      </Field>
      {form.formError ? <ErrorNotice error={form.formError} /> : null}
      <Button type="submit" size="lg" name="submit" loading={form.submitting}>
        {t("auth.twoFactor.submit")}
      </Button>
      <Button type="button" variant="ghost" name="use-backup" onClick={onUseBackup}>
        {t("auth.twoFactor.useBackup")}
      </Button>
    </form>
  );
}

function BackupForm({ next, onUseTotp }: TwoFactorFormProps & { onUseTotp: () => void }) {
  const router = useRouter();
  const form = useApiForm({
    schema: twoFactorVerifyBackupCodeSchema,
    initial: { code: "" },
    holdOnSuccess: true,
    submit: async (values) => {
      await api("/auth/two-factor/verify-backup-code", {
        method: "POST",
        body: { code: values.code.trim() },
      });
      router.replace(next);
    },
  });

  return (
    <form
      onSubmit={form.handleSubmit}
      noValidate
      className="flex flex-col gap-5"
      aria-label={t("auth.twoFactor.backupTitle")}
    >
      <Field
        label={t("auth.twoFactor.backupLabel")}
        hint={t("auth.twoFactor.backupHint")}
        required
        error={form.errors["code"]}
        announceError={form.submitCount > 0}
      >
        {(control) => (
          <Input
            {...control}
            {...form.bind("code")}
            ltr
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
        )}
      </Field>
      {form.formError ? <ErrorNotice error={form.formError} /> : null}
      <Button type="submit" size="lg" name="submit" loading={form.submitting}>
        {t("auth.twoFactor.submit")}
      </Button>
      <Button type="button" variant="ghost" name="use-totp" onClick={onUseTotp}>
        {t("auth.twoFactor.useApp")}
      </Button>
    </form>
  );
}

/** Second step of a password sign-in for accounts with two-factor authentication. */
export function TwoFactorForm({ next }: TwoFactorFormProps) {
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  return (
    <div className="flex flex-col gap-4">
      {mode === "totp" ? (
        <TotpForm
          next={next}
          onUseBackup={() => {
            setMode("backup");
          }}
        />
      ) : (
        <BackupForm
          next={next}
          onUseTotp={() => {
            setMode("totp");
          }}
        />
      )}
      <Link
        href="/login"
        className="inline-flex min-h-11 items-center justify-center rounded-sm text-base font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
      >
        {t("auth.twoFactor.backToLogin")}
      </Link>
    </div>
  );
}
