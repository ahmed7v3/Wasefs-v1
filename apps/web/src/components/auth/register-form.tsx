"use client";

import { t } from "@wasfa/shared/i18n";
import { signUpEmailSchema, signUpPhoneSchema } from "@wasfa/shared/schemas/auth";
import {
  Button,
  Checkbox,
  Field,
  Input,
  PasswordInput,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from "@wasfa/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { z } from "zod";

import { api } from "../../lib/api-client";
import { REFERRAL_COOKIE, normalizeReferralCode } from "../../lib/attribution-cookies";
import { PENDING_EMAIL_KEY, VERIFIED_CALLBACK, type ProviderStates } from "../../lib/auth-api";
import { readBrowserCookie } from "../../lib/browser-cookies";
import { useApiForm, type ApiForm } from "../../lib/forms";
import { ErrorNotice } from "../error-notice";
import { ErrorSummary } from "../forms/error-summary";
import { PhoneInput } from "../forms/phone-input";
import { TermsCheckbox } from "../forms/terms-checkbox";
import { Turnstile, useTurnstile } from "../turnstile";

import { SocialButtons } from "./social-buttons";

/** The terms box exists only in the browser; its message is a `form.*` key (see `zodIssueMessage`). */
const terms = z.boolean().refine((accepted) => accepted, { message: "form.termsRequired" });

const emailRegistration = signUpEmailSchema.extend({ terms });
const phoneRegistration = signUpPhoneSchema.extend({ terms });

export interface RegisterFormProps {
  nonce?: string | undefined;
  /** From `GET /auth/providers`; Google (when offered) leads the form. */
  providers?: ProviderStates | undefined;
  /** Already vetted by `safeNext`; where the provider sends the user back. */
  next?: string | undefined;
  /** The invite code from `?ref=` (already normalised), or the cookie's once the page is in the browser. */
  initialReferralCode?: string | undefined;
}

/** The optional invite code, sent only when filled. The API ignores an unknown one: it never blocks a sign-up. */
function referralBody(value: string | undefined): { referralCode?: string } {
  const code = value?.trim().toUpperCase();
  return code ? { referralCode: code } : {};
}

function ReferralField({
  error,
  announce,
  bind,
}: {
  error: string | undefined;
  announce: boolean;
  bind: ReturnType<ApiForm<typeof emailRegistration>["bind"]>;
}) {
  return (
    <Field
      label={
        <>
          {t("auth.field.referral")}{" "}
          <span className="text-sm font-normal text-text-muted">{t("ui.optional")}</span>
        </>
      }
      hint={t("auth.field.referralHint")}
      error={error}
      announceError={announce}
    >
      {(control) => <Input {...control} {...bind} ltr autoComplete="off" spellCheck={false} />}
    </Field>
  );
}

function EmailRegistration({ nonce, initialReferralCode = "" }: RegisterFormProps) {
  const router = useRouter();
  const ts = useTurnstile();
  const form = useApiForm({
    schema: emailRegistration,
    initial: {
      name: "",
      email: "",
      password: "",
      referralCode: initialReferralCode,
      terms: false,
      // Never pre-checked (GROWTH §2.3): marketing mail needs a deliberate tick.
      marketingOptIn: false,
    },
    holdOnSuccess: true,
    submit: async (values) => {
      try {
        await api("/auth/sign-up/email", {
          method: "POST",
          body: {
            name: values.name,
            email: values.email,
            password: values.password,
            callbackURL: VERIFIED_CALLBACK,
            ...referralBody(values.referralCode),
            ...(values.marketingOptIn ? { marketingOptIn: true } : {}),
          },
          turnstileToken: ts.requireToken(),
        });
      } catch (error) {
        ts.reset();
        throw error;
      }
      // The address waits in this tab's storage for the resend button; it never goes into the URL.
      try {
        sessionStorage.setItem(PENDING_EMAIL_KEY, values.email);
      } catch {
        /* storage blocked: the verify screen asks for the address instead */
      }
      router.replace("/verify-email");
    },
  });

  return (
    <form
      onSubmit={form.handleSubmit}
      noValidate
      className="flex flex-col gap-5"
      aria-label={t("auth.tab.email")}
    >
      <ErrorSummary
        errors={form.errors}
        focusKey={form.submitCount}
        labels={{
          name: t("auth.field.name"),
          email: t("auth.field.email"),
          password: t("auth.field.password"),
          referralCode: t("auth.field.referral"),
          terms: t("auth.terms.label"),
        }}
      />
      <Field
        label={t("auth.field.name")}
        required
        error={form.errors["name"]}
        announceError={form.submitCount > 0}
      >
        {(control) => <Input {...control} {...form.bind("name")} autoComplete="name" />}
      </Field>
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
            autoComplete="email"
          />
        )}
      </Field>
      <Field
        label={t("auth.field.password")}
        hint={t("form.passwordHint")}
        required
        error={form.errors["password"]}
        announceError={form.submitCount > 0}
      >
        {(control) => (
          <PasswordInput {...control} {...form.bind("password")} autoComplete="new-password" />
        )}
      </Field>
      <ReferralField
        error={form.errors["referralCode"]}
        announce={form.submitCount > 0}
        bind={form.bind("referralCode")}
      />
      <TermsCheckbox
        {...form.bindCheckbox("terms")}
        error={form.errors["terms"]}
        announceError={form.submitCount > 0}
      />
      <Checkbox {...form.bindCheckbox("marketingOptIn")} label={t("growth.consent.label")} />
      <Turnstile nonce={nonce} {...ts.widgetProps} />
      {form.formError ? <ErrorNotice error={form.formError} /> : null}
      <Button type="submit" size="lg" name="submit" loading={form.submitting}>
        {t("auth.register.submit")}
      </Button>
    </form>
  );
}

function PhoneRegistration({ nonce, initialReferralCode = "" }: RegisterFormProps) {
  const router = useRouter();
  const ts = useTurnstile();
  const form = useApiForm({
    schema: phoneRegistration,
    initial: {
      name: "",
      phoneNumber: "",
      password: "",
      referralCode: initialReferralCode,
      terms: false,
      // Never pre-checked (GROWTH §2.3): marketing mail needs a deliberate tick.
      marketingOptIn: false,
    },
    holdOnSuccess: true,
    submit: async (values) => {
      try {
        await api("/auth/sign-up/phone-number", {
          method: "POST",
          body: {
            name: values.name,
            phoneNumber: values.phoneNumber,
            password: values.password,
            ...referralBody(values.referralCode),
            ...(values.marketingOptIn ? { marketingOptIn: true } : {}),
          },
          turnstileToken: ts.requireToken(),
        });
      } catch (error) {
        ts.reset();
        throw error;
      }
      // Phone sign-up signs the person in; the number itself is verified during onboarding.
      router.replace("/welcome");
    },
  });

  return (
    <form
      onSubmit={form.handleSubmit}
      noValidate
      className="flex flex-col gap-5"
      aria-label={t("auth.tab.phone")}
    >
      <ErrorSummary
        errors={form.errors}
        focusKey={form.submitCount}
        labels={{
          name: t("auth.field.name"),
          phoneNumber: t("auth.field.phone"),
          password: t("auth.field.password"),
          referralCode: t("auth.field.referral"),
          terms: t("auth.terms.label"),
        }}
      />
      <Field
        label={t("auth.field.name")}
        required
        error={form.errors["name"]}
        announceError={form.submitCount > 0}
      >
        {(control) => <Input {...control} {...form.bind("name")} autoComplete="name" />}
      </Field>
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
        hint={t("form.passwordHint")}
        required
        error={form.errors["password"]}
        announceError={form.submitCount > 0}
      >
        {(control) => (
          <PasswordInput {...control} {...form.bind("password")} autoComplete="new-password" />
        )}
      </Field>
      <ReferralField
        error={form.errors["referralCode"]}
        announce={form.submitCount > 0}
        bind={form.bind("referralCode")}
      />
      <TermsCheckbox
        {...form.bindCheckbox("terms")}
        error={form.errors["terms"]}
        announceError={form.submitCount > 0}
      />
      <Checkbox {...form.bindCheckbox("marketingOptIn")} label={t("growth.consent.label")} />
      <Turnstile nonce={nonce} {...ts.widgetProps} />
      {form.formError ? <ErrorNotice error={form.formError} /> : null}
      <Button type="submit" size="lg" name="submit" loading={form.submitting}>
        {t("auth.register.submit")}
      </Button>
    </form>
  );
}

export function RegisterForm({
  nonce,
  initialReferralCode = "",
  providers = [],
  next = "/dashboard",
}: RegisterFormProps) {
  // The invite link `/r/<code>` also left the code in a cookie: pick it up once in the browser. Changing
  // the key remounts the two forms with it before anything was typed.
  const [referral, setReferral] = useState(initialReferralCode);
  useEffect(() => {
    if (initialReferralCode !== "") return;
    const remembered = normalizeReferralCode(readBrowserCookie(REFERRAL_COOKIE));
    if (remembered !== null) setReferral(remembered);
  }, [initialReferralCode]);

  return (
    <div className="flex flex-col gap-6">
      <SocialButtons providers={providers} next={next} mode="signup" />
      <Tabs defaultValue="email">
        <TabList aria-label={t("auth.register.methodLabel")}>
          <Tab value="email">{t("auth.tab.email")}</Tab>
          <Tab value="phone">{t("auth.tab.phone")}</Tab>
        </TabList>
        <TabPanel value="email">
          <EmailRegistration key={referral} nonce={nonce} initialReferralCode={referral} />
        </TabPanel>
        <TabPanel value="phone">
          <PhoneRegistration key={referral} nonce={nonce} initialReferralCode={referral} />
        </TabPanel>
      </Tabs>
    </div>
  );
}
