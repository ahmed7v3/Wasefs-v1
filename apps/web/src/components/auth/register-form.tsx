"use client";

import { t } from "@wasfa/shared/i18n";
import { signUpEmailSchema, signUpPhoneSchema } from "@wasfa/shared/schemas/auth";
import { Button, Field, Input, PasswordInput, Tab, TabList, TabPanel, Tabs } from "@wasfa/ui";
import { useRouter } from "next/navigation";
import { z } from "zod";

import { api } from "../../lib/api-client";
import { PENDING_EMAIL_KEY, VERIFIED_CALLBACK } from "../../lib/auth-api";
import { useApiForm } from "../../lib/forms";
import { ErrorNotice } from "../error-notice";
import { ErrorSummary } from "../forms/error-summary";
import { PhoneInput } from "../forms/phone-input";
import { TermsCheckbox } from "../forms/terms-checkbox";
import { Turnstile, useTurnstile } from "../turnstile";

/** The terms box exists only in the browser; its message is a `form.*` key (see `zodIssueMessage`). */
const terms = z.boolean().refine((accepted) => accepted, { message: "form.termsRequired" });

const emailRegistration = signUpEmailSchema.extend({ terms });
const phoneRegistration = signUpPhoneSchema.extend({ terms });

export interface RegisterFormProps {
  nonce?: string | undefined;
}

function EmailRegistration({ nonce }: RegisterFormProps) {
  const router = useRouter();
  const ts = useTurnstile();
  const form = useApiForm({
    schema: emailRegistration,
    initial: { name: "", email: "", password: "", terms: false },
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
      <TermsCheckbox
        {...form.bindCheckbox("terms")}
        error={form.errors["terms"]}
        announceError={form.submitCount > 0}
      />
      <Turnstile nonce={nonce} {...ts.widgetProps} />
      {form.formError ? <ErrorNotice error={form.formError} /> : null}
      <Button type="submit" size="lg" name="submit" loading={form.submitting}>
        {t("auth.register.submit")}
      </Button>
    </form>
  );
}

function PhoneRegistration({ nonce }: RegisterFormProps) {
  const router = useRouter();
  const ts = useTurnstile();
  const form = useApiForm({
    schema: phoneRegistration,
    initial: { name: "", phoneNumber: "", password: "", terms: false },
    holdOnSuccess: true,
    submit: async (values) => {
      try {
        await api("/auth/sign-up/phone-number", {
          method: "POST",
          body: { name: values.name, phoneNumber: values.phoneNumber, password: values.password },
          turnstileToken: ts.requireToken(),
        });
      } catch (error) {
        ts.reset();
        throw error;
      }
      // Phone sign-up signs the person in; the number itself is verified during onboarding.
      router.replace("/onboarding");
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
      <TermsCheckbox
        {...form.bindCheckbox("terms")}
        error={form.errors["terms"]}
        announceError={form.submitCount > 0}
      />
      <Turnstile nonce={nonce} {...ts.widgetProps} />
      {form.formError ? <ErrorNotice error={form.formError} /> : null}
      <Button type="submit" size="lg" name="submit" loading={form.submitting}>
        {t("auth.register.submit")}
      </Button>
    </form>
  );
}

export function RegisterForm({ nonce }: RegisterFormProps) {
  return (
    <Tabs defaultValue="email">
      <TabList aria-label={t("auth.register.methodLabel")}>
        <Tab value="email">{t("auth.tab.email")}</Tab>
        <Tab value="phone">{t("auth.tab.phone")}</Tab>
      </TabList>
      <TabPanel value="email">
        <EmailRegistration nonce={nonce} />
      </TabPanel>
      <TabPanel value="phone">
        <PhoneRegistration nonce={nonce} />
      </TabPanel>
    </Tabs>
  );
}
