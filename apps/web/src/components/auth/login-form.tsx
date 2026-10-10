"use client";

import { t } from "@wasfa/shared/i18n";
import { signInEmailSchema, signInPhoneSchema } from "@wasfa/shared/schemas/auth";
import { Button, Field, Input, PasswordInput, Tab, TabList, TabPanel, Tabs } from "@wasfa/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { api } from "../../lib/api-client";
import { ApiRequestError, errorReason } from "../../lib/api-error";
import { signInResponseSchema, type ProviderStates } from "../../lib/auth-api";
import { useApiForm } from "../../lib/forms";
import { ErrorNotice } from "../error-notice";
import { PhoneInput } from "../forms/phone-input";
import { Notice } from "../notice";
import { Turnstile, useTurnstile } from "../turnstile";

import { ResendVerification } from "./resend-verification";
import { SocialButtons } from "./social-buttons";

/** What the login page was opened with (`?verified=1`, `?reset=1`, `?error=...`), decided on the server. */
export type LoginBanner =
  "verified" | "reset" | "link_expired" | "provider_unavailable" | "social_failed";

export interface LoginFormProps {
  nonce?: string | undefined;
  /** Already vetted by `safeNext`. */
  next: string;
  providers: ProviderStates;
  banner?: LoginBanner | undefined;
}

/**
 * Shared sign-in behaviour of both tabs: Turnstile only appears once the API asked for it (after
 * repeated failures), and a two-factor answer moves on to the code screen.
 */
function useSignIn(next: string) {
  const router = useRouter();
  const ts = useTurnstile();
  const [challenge, setChallenge] = useState(false);

  const signIn = async (path: string, body: Record<string, unknown>): Promise<void> => {
    try {
      const result = await api(path, {
        method: "POST",
        body,
        schema: signInResponseSchema,
        turnstileToken: challenge ? ts.requireToken() : undefined,
      });
      router.replace(
        result.twoFactorRedirect ? `/login/two-factor?next=${encodeURIComponent(next)}` : next,
      );
    } catch (error) {
      const reason = errorReason(error);
      if (reason === "turnstile_required" || reason === "turnstile_failed") setChallenge(true);
      throw error;
    } finally {
      if (challenge) ts.reset();
    }
  };

  return { ts, challenge, signIn };
}

function ForgotPasswordLink() {
  return (
    <Link
      href="/forgot-password"
      className="inline-flex min-h-11 items-center self-start rounded-sm text-base font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
    >
      {t("auth.login.forgot")}
    </Link>
  );
}

function EmailSignIn({ next, nonce }: { next: string; nonce: string | undefined }) {
  const { ts, challenge, signIn } = useSignIn(next);
  const form = useApiForm({
    schema: signInEmailSchema,
    initial: { email: "", password: "" },
    holdOnSuccess: true,
    submit: (values) =>
      signIn("/auth/sign-in/email", { email: values.email, password: values.password }),
  });
  const unverified = errorReason(form.formError) === "email_not_verified";

  return (
    <div className="flex flex-col gap-5">
      <form
        onSubmit={form.handleSubmit}
        noValidate
        className="flex flex-col gap-5"
        aria-label={t("auth.tab.email")}
      >
        <Field
          label={t("auth.field.email")}
          required
          error={form.errors["email"]}
          announceError={form.submitCount > 0}
        >
          {(control) => (
            <Input
              {...control}
              {...form.bind("email")}
              type="email"
              ltr
              inputMode="email"
              autoComplete="username"
            />
          )}
        </Field>
        <Field
          label={t("auth.field.password")}
          required
          error={form.errors["password"]}
          announceError={form.submitCount > 0}
        >
          {(control) => (
            <PasswordInput
              {...control}
              {...form.bind("password")}
              autoComplete="current-password"
            />
          )}
        </Field>
        <ForgotPasswordLink />
        {challenge ? <Turnstile nonce={nonce} {...ts.widgetProps} /> : null}
        {form.formError ? <ErrorNotice error={form.formError} /> : null}
        <Button type="submit" size="lg" name="submit" loading={form.submitting}>
          {t("auth.login.submit")}
        </Button>
      </form>
      {/* Outside the sign-in form: forms cannot nest. */}
      {unverified ? (
        <div className="rounded-md border border-border p-4">
          <ResendVerification email={form.values.email.trim()} nonce={nonce} />
        </div>
      ) : null}
    </div>
  );
}

function PhoneSignIn({ next, nonce }: { next: string; nonce: string | undefined }) {
  const { ts, challenge, signIn } = useSignIn(next);
  const form = useApiForm({
    schema: signInPhoneSchema,
    initial: { phoneNumber: "", password: "" },
    holdOnSuccess: true,
    submit: (values) =>
      signIn("/auth/sign-in/phone-number", {
        phoneNumber: values.phoneNumber,
        password: values.password,
      }),
  });

  return (
    <form
      onSubmit={form.handleSubmit}
      noValidate
      className="flex flex-col gap-5"
      aria-label={t("auth.tab.phone")}
    >
      <Field
        label={t("auth.field.phone")}
        required
        error={form.errors["phoneNumber"]}
        announceError={form.submitCount > 0}
      >
        {(control) => (
          <PhoneInput
            {...control}
            name="phoneNumber"
            onChange={(value) => {
              form.setValue("phoneNumber", value);
            }}
            onBlur={() => {
              form.blur("phoneNumber");
            }}
          />
        )}
      </Field>
      <Field
        label={t("auth.field.password")}
        required
        error={form.errors["password"]}
        announceError={form.submitCount > 0}
      >
        {(control) => (
          <PasswordInput {...control} {...form.bind("password")} autoComplete="current-password" />
        )}
      </Field>
      <ForgotPasswordLink />
      {challenge ? <Turnstile nonce={nonce} {...ts.widgetProps} /> : null}
      {form.formError ? <ErrorNotice error={form.formError} /> : null}
      <Button type="submit" size="lg" name="submit" loading={form.submitting}>
        {t("auth.login.submit")}
      </Button>
    </form>
  );
}

function BannerNotice({ banner, nonce }: { banner: LoginBanner; nonce: string | undefined }) {
  switch (banner) {
    case "verified":
      return <Notice tone="success">{t("auth.login.verifiedBanner")}</Notice>;
    case "reset":
      return <Notice tone="success">{t("auth.login.resetBanner")}</Notice>;
    case "link_expired":
      return (
        <div className="flex flex-col gap-3">
          <ErrorNotice
            error={
              new ApiRequestError("VALIDATION_FAILED", "", undefined, 0, {
                reason: "invalid_token",
              })
            }
          />
          <ResendVerification nonce={nonce} />
        </div>
      );
    case "provider_unavailable":
    case "social_failed":
      return (
        <ErrorNotice
          error={new ApiRequestError("VALIDATION_FAILED", "", undefined, 0, { reason: banner })}
        />
      );
  }
}

export function LoginForm({ nonce, next, providers, banner }: LoginFormProps) {
  return (
    <div className="flex flex-col gap-6">
      {banner ? <BannerNotice banner={banner} nonce={nonce} /> : null}
      <Tabs defaultValue="email">
        <TabList aria-label={t("auth.login.methodLabel")}>
          <Tab value="email">{t("auth.tab.email")}</Tab>
          <Tab value="phone">{t("auth.tab.phone")}</Tab>
        </TabList>
        <TabPanel value="email">
          <EmailSignIn next={next} nonce={nonce} />
        </TabPanel>
        <TabPanel value="phone">
          <PhoneSignIn next={next} nonce={nonce} />
        </TabPanel>
      </Tabs>
      <SocialButtons providers={providers} next={next} />
    </div>
  );
}
