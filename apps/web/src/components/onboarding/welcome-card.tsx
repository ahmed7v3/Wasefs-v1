"use client";

import { t } from "@wasfa/shared/i18n";
import { ACCOUNT_TYPES, ORG_TYPES, PROFESSIONS, type AccountType } from "@wasfa/shared/identity";
import { onboardingStateSchema } from "@wasfa/shared/schemas/onboarding";
import { orgDetailsSchema } from "@wasfa/shared/schemas/org";
import { personNameSchema } from "@wasfa/shared/schemas/user";
import { Button, Field, Input, Select, cn } from "@wasfa/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";

import { api } from "../../lib/api-client";
import { useApiForm } from "../../lib/forms";
import { label } from "../../lib/labels";
import { ErrorNotice } from "../error-notice";
import { PhoneVerification } from "../phone-verification";

import { CountryOptions, OptionalLabel } from "./steps";

import type { OnboardingState } from "@wasfa/shared/schemas/onboarding";

const ORG_FIELDS = {
  name: "orgName",
  type: "orgType",
  country: "orgCountry",
  city: "orgCity",
} as const;

/** The one screen's form: the organization fields are flat strings that may start empty. */
const welcomeForm = z
  .object({
    name: personNameSchema,
    accountType: z.enum(ACCOUNT_TYPES),
    profession: z.string(),
    orgName: z.string(),
    orgType: z.string(),
    orgCountry: z.string(),
    orgCity: z.string(),
  })
  .superRefine((values, context) => {
    if (values.accountType !== "organization") return;
    const parsed = orgDetailsSchema.safeParse({
      name: values.orgName,
      type: values.orgType,
      country: values.orgCountry,
      city: values.orgCity.trim() === "" ? undefined : values.orgCity,
    });
    if (parsed.success) return;
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "");
      if (!(field in ORG_FIELDS)) continue;
      const key = ORG_FIELDS[field as keyof typeof ORG_FIELDS];
      const blank = values[key].trim() === "";
      context.addIssue({
        code: "custom",
        path: [key],
        message: blank ? "form.required" : "form.invalid",
      });
    }
  });

export interface WelcomeCardProps {
  /** `GET /onboarding`, rendered by the server. */
  initial: OnboardingState;
  nonce?: string | undefined;
}

const SEGMENT =
  "min-h-11 flex-1 rounded-md px-4 text-base font-semibold transition-colors duration-150 " +
  "focus-visible:outline-none focus-visible:shadow-focus";

/**
 * The whole onboarding on one screen (docs/WA-SIGNUP.md section 4): name, for me / for an
 * organization, optional profession chips, and one button. The phone block appears only when the
 * server says the phone is still required (email and Google sign-ups); the free plan is automatic.
 */
export function WelcomeCard({ initial, nonce }: WelcomeCardProps) {
  const router = useRouter();
  const [answers, setAnswers] = useState(initial.answers);
  const phoneReady = answers.phoneVerified || answers.phoneSkippable;

  const form = useApiForm({
    schema: welcomeForm,
    initial: {
      name: answers.name,
      accountType: answers.accountType,
      profession: answers.profession ?? "",
      orgName: answers.organization?.name ?? "",
      orgType: answers.organization?.type ?? "",
      orgCountry: answers.organization?.country ?? "",
      orgCity: answers.organization?.city ?? "",
    },
    holdOnSuccess: true,
    submit: async (values) => {
      const organization = values.accountType === "organization";
      const state = await api("/onboarding/welcome", {
        method: "PUT",
        body: {
          name: values.name,
          accountType: values.accountType,
          ...(organization
            ? {
                organization: {
                  name: values.orgName,
                  type: values.orgType,
                  country: values.orgCountry,
                  ...(values.orgCity.trim() === "" ? {} : { city: values.orgCity }),
                },
              }
            : {}),
          ...(values.profession === "" ? {} : { profession: values.profession }),
        },
        schema: onboardingStateSchema,
      });
      router.replace("/dashboard");
      router.refresh();
      return void state;
    },
  });

  const refreshAnswers = () => {
    api("/onboarding", { schema: onboardingStateSchema })
      .then((state) => {
        setAnswers(state.answers);
      })
      .catch(() => {
        // The card keeps its last state; submitting still reports what the server says.
      });
  };

  const accountType = form.values.accountType;
  const choose = (type: AccountType) => {
    form.setValue("accountType", type);
  };

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-bold text-primary">
          {t("welcome.title", { name: form.values.name.trim().split(/\s+/)[0] ?? "" })}
        </h1>
        <p className="text-lg text-text-muted">{t("welcome.lead")}</p>
      </header>

      <Field
        label={t("auth.field.name")}
        required
        error={form.errors["name"]}
        announceError={form.submitCount > 0}
      >
        {(control) => <Input {...control} {...form.bind("name")} autoComplete="name" />}
      </Field>

      <div
        role="radiogroup"
        aria-label={t("welcome.accountType")}
        className="flex gap-1 rounded-lg bg-primary-soft p-1"
      >
        {ACCOUNT_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={accountType === type}
            name={`account-type-${type}`}
            onClick={() => {
              choose(type);
            }}
            className={cn(
              SEGMENT,
              accountType === type
                ? "bg-surface text-primary shadow-sm"
                : "text-text-muted hover:text-primary",
            )}
          >
            {t(type === "individual" ? "welcome.forMe" : "welcome.forOrg")}
          </button>
        ))}
      </div>

      {accountType === "organization" ? (
        <div className="flex flex-col gap-4">
          <Field
            label={t("onboarding.org.name")}
            required
            error={form.errors["orgName"]}
            announceError={form.submitCount > 0}
          >
            {(control) => (
              <Input {...control} {...form.bind("orgName")} autoComplete="organization" />
            )}
          </Field>
          <Field
            label={t("onboarding.org.type")}
            required
            error={form.errors["orgType"]}
            announceError={form.submitCount > 0}
          >
            {(control) => (
              <Select {...control} {...form.bind("orgType")}>
                <option value="">{t("ui.select")}</option>
                {ORG_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {label("orgType", type)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label={t("field.country")}
            required
            error={form.errors["orgCountry"]}
            announceError={form.submitCount > 0}
          >
            {(control) => (
              <Select {...control} {...form.bind("orgCountry")} autoComplete="country">
                <CountryOptions current={form.values.orgCountry} />
              </Select>
            )}
          </Field>
          <Field
            label={<OptionalLabel>{t("field.city")}</OptionalLabel>}
            error={form.errors["orgCity"]}
            announceError={form.submitCount > 0}
          >
            {(control) => (
              <Input {...control} {...form.bind("orgCity")} autoComplete="address-level2" />
            )}
          </Field>
        </div>
      ) : null}

      <fieldset className="flex flex-col gap-3">
        <legend className="text-base font-semibold text-text">
          <OptionalLabel>{t("welcome.profession")}</OptionalLabel>
        </legend>
        <div className="flex flex-wrap gap-2">
          {PROFESSIONS.map((profession) => {
            const selected = form.values.profession === profession;
            return (
              <button
                key={profession}
                type="button"
                aria-pressed={selected}
                name={`profession-${profession}`}
                onClick={() => {
                  form.setValue("profession", selected ? "" : profession);
                }}
                className={cn(
                  "min-h-11 rounded-full border px-4 text-base transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:shadow-focus",
                  selected
                    ? "border-primary bg-primary text-on-primary"
                    : "border-border bg-surface text-text hover:bg-primary-soft",
                )}
              >
                {label("profession", profession)}
              </button>
            );
          })}
        </div>
      </fieldset>

      {phoneReady ? null : (
        <section className="flex flex-col gap-3" aria-label={t("welcome.phone")}>
          <h2 className="text-base font-semibold text-text">{t("welcome.phone")}</h2>
          <PhoneVerification
            nonce={nonce}
            onVerified={() => {
              setAnswers((current) => ({ ...current, phoneVerified: true }));
            }}
            onUnavailable={refreshAnswers}
          />
        </section>
      )}

      {form.formError ? <ErrorNotice error={form.formError} /> : null}
      <Button
        type="submit"
        size="lg"
        name="start"
        loading={form.submitting}
        disabled={!phoneReady}
        className="w-full"
      >
        {t("welcome.start")}
      </Button>
    </form>
  );
}
