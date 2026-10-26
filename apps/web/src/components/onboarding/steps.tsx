"use client";

import { t } from "@wasfa/shared/i18n";
import {
  ACCOUNT_TYPES,
  ORG_TYPES,
  PROFESSIONS,
  USAGE_INTENTS,
  type AccountType,
} from "@wasfa/shared/identity";
import {
  ONBOARDING_STEP_SCHEMAS,
  type OnboardingInputStep,
  type OnboardingState,
} from "@wasfa/shared/schemas/onboarding";
import { citySchema, countryCodeSchema } from "@wasfa/shared/schemas/org";
import { Button, Checkbox, Field, Input, Select, buttonStyles } from "@wasfa/ui";
import { Building2, ExternalLink, User } from "lucide-react";
import { z } from "zod";

import { useApiForm } from "../../lib/forms";
import { COUNTRY_CODES, label } from "../../lib/labels";
import { ErrorNotice } from "../error-notice";
import { Notice } from "../notice";
import { PhoneVerification } from "../phone-verification";

import { useStepAction } from "./use-step-action";
import { ChoiceCard, GroupError, StepActions } from "./wizard-parts";

import type { CatalogResponse } from "@wasfa/shared/schemas/billing";
import type { FormEventHandler, ReactNode } from "react";

export interface SubmitOptions {
  /** Where to go when this answer finishes onboarding (default: the dashboard). */
  next?: string | undefined;
  /** What the "finishing" spinner says meanwhile (default: the generic loading text). */
  doneMessage?: string | undefined;
}

export interface StepProps {
  state: OnboardingState;
  /** Sends one step's answer; resolves also when the server refused it with a `CONFLICT` (the wizard shows that). */
  submit: (step: OnboardingInputStep, body: unknown, options?: SubmitOptions) => Promise<void>;
  /** Back (absent on the first step) and the label of the primary button. */
  onBack: (() => void) | undefined;
  submitLabel: string;
  nonce: string | undefined;
  freeMonthlyAnalyses: number;
  /** The public catalog, or null when the API could not answer. Only the plan step reads it. */
  catalog: CatalogResponse | null;
  facebookUrl: string | null;
}

/** Empty text means "left blank": the shared schema wants the key absent or a real city. */
const optionalCity = z
  .string()
  .transform((value) => (value.trim() === "" ? undefined : value))
  .pipe(citySchema.optional());

const ACCOUNT_ICONS: Record<AccountType, ReactNode> = {
  individual: <User />,
  organization: <Building2 />,
};

function StepForm({
  onSubmit,
  children,
}: {
  onSubmit: FormEventHandler<HTMLFormElement>;
  children: ReactNode;
}) {
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {children}
    </form>
  );
}

function OptionalLabel({ children }: { children: ReactNode }) {
  return (
    <>
      {children} <span className="text-sm font-normal text-text-muted">{t("ui.optional")}</span>
    </>
  );
}

export function AccountTypeStep({ state, submit, onBack, submitLabel }: StepProps) {
  const form = useApiForm({
    schema: ONBOARDING_STEP_SCHEMAS.account_type,
    initial: { accountType: state.answers.accountType },
    submit: (values) => submit("account_type", values),
  });
  return (
    <StepForm onSubmit={form.handleSubmit}>
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">{t("onboarding.step.account_type.title")}</legend>
        {ACCOUNT_TYPES.map((type) => (
          <ChoiceCard
            key={type}
            name="accountType"
            value={type}
            checked={form.values.accountType === type}
            onChange={() => {
              form.setValue("accountType", type);
            }}
            icon={ACCOUNT_ICONS[type]}
            title={t(`accountType.${type}`)}
            description={t(`accountType.${type}.desc`)}
          />
        ))}
      </fieldset>
      {form.formError ? <ErrorNotice error={form.formError} /> : null}
      <StepActions onBack={onBack} submitLabel={submitLabel} loading={form.submitting} />
    </StepForm>
  );
}

export function PhoneStep({ state, submit, onBack, nonce }: StepProps) {
  const { answers } = state;
  const action = useStepAction<undefined>(() => submit("phone", {}));
  return (
    <div className="flex flex-col gap-5">
      {answers.phoneVerified ? (
        <Notice tone="success">
          <p className="font-semibold">{t("phone.verified.title")}</p>
          {answers.phone ? (
            <p>
              <bdi dir="ltr">{answers.phone}</bdi>
            </p>
          ) : null}
        </Notice>
      ) : (
        <PhoneVerification
          nonce={nonce}
          onVerified={() => {
            action.start(undefined);
          }}
        />
      )}
      {action.busy ? (
        <p role="status" className="text-base text-text-muted">
          {t("onboarding.step.phone.verifiedContinue")}
        </p>
      ) : null}
      {answers.phoneSkippable && !answers.phoneVerified ? (
        <Notice>{t("onboarding.step.phone.skipNote")}</Notice>
      ) : null}
      {action.error ? (
        <ErrorNotice
          error={action.error}
          onRetry={() => {
            action.start(undefined);
          }}
        />
      ) : null}
      <StepActions onBack={onBack} submitLabel="">
        {answers.phoneVerified ? (
          <Button
            type="button"
            size="lg"
            name="next"
            loading={action.busy}
            onClick={() => {
              action.start(undefined);
            }}
          >
            {t("common.next")}
          </Button>
        ) : answers.phoneSkippable ? (
          <Button
            type="button"
            variant="secondary"
            name="skip-phone"
            loading={action.busy}
            onClick={() => {
              action.start(undefined);
            }}
          >
            {t("onboarding.step.phone.skip")}
          </Button>
        ) : (
          <span />
        )}
      </StepActions>
    </div>
  );
}

export function NameStep({ state, submit, onBack, submitLabel }: StepProps) {
  const form = useApiForm({
    schema: ONBOARDING_STEP_SCHEMAS.name,
    initial: { name: state.answers.name },
    submit: (values) => submit("name", values),
  });
  return (
    <StepForm onSubmit={form.handleSubmit}>
      <Field
        label={t("auth.field.name")}
        required
        error={form.errors["name"]}
        announceError={form.submitCount > 0}
      >
        {(control) => <Input {...control} {...form.bind("name")} autoComplete="name" />}
      </Field>
      {form.formError ? <ErrorNotice error={form.formError} /> : null}
      <StepActions onBack={onBack} submitLabel={submitLabel} loading={form.submitting} />
    </StepForm>
  );
}

/** The shared organization schema, with the two selects typed as text so they can start empty. */
const organizationForm = ONBOARDING_STEP_SCHEMAS.organization.extend({
  type: z.string().pipe(z.enum(ORG_TYPES)),
  country: z.string().pipe(countryCodeSchema),
  city: optionalCity,
});

function CountryOptions({ current }: { current: string }) {
  const known = (COUNTRY_CODES as readonly string[]).includes(current);
  const codes: readonly string[] =
    current === "" || known ? COUNTRY_CODES : [current, ...COUNTRY_CODES];
  return (
    <>
      <option value="">{t("ui.select")}</option>
      {codes.map((code) => (
        <option key={code} value={code}>
          {label("country", code)}
        </option>
      ))}
    </>
  );
}

export function OrganizationStep({ state, submit, onBack, submitLabel }: StepProps) {
  const org = state.answers.organization;
  const form = useApiForm({
    schema: organizationForm,
    initial: {
      name: org?.name ?? "",
      type: org?.type ?? "",
      country: org?.country ?? "",
      city: org?.city ?? "",
    },
    submit: (values) => submit("organization", values),
  });
  return (
    <StepForm onSubmit={form.handleSubmit}>
      <Field
        label={t("onboarding.org.name")}
        required
        error={form.errors["name"]}
        announceError={form.submitCount > 0}
      >
        {(control) => <Input {...control} {...form.bind("name")} autoComplete="organization" />}
      </Field>
      <Field
        label={t("onboarding.org.type")}
        required
        error={form.errors["type"]}
        announceError={form.submitCount > 0}
      >
        {(control) => (
          <Select {...control} {...form.bind("type")}>
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
        error={form.errors["country"]}
        announceError={form.submitCount > 0}
      >
        {(control) => (
          <Select {...control} {...form.bind("country")} autoComplete="country">
            <CountryOptions current={form.values.country} />
          </Select>
        )}
      </Field>
      <Field
        label={<OptionalLabel>{t("field.city")}</OptionalLabel>}
        error={form.errors["city"]}
        announceError={form.submitCount > 0}
      >
        {(control) => <Input {...control} {...form.bind("city")} autoComplete="address-level2" />}
      </Field>
      {form.formError ? <ErrorNotice error={form.formError} /> : null}
      <StepActions onBack={onBack} submitLabel={submitLabel} loading={form.submitting} />
    </StepForm>
  );
}

const professionIntentForm = ONBOARDING_STEP_SCHEMAS.profession_intent.extend({
  profession: z.string().pipe(z.enum(PROFESSIONS)),
  country: z.string().pipe(countryCodeSchema),
  city: optionalCity,
});

export function ProfessionIntentStep({ state, submit, onBack, submitLabel }: StepProps) {
  const { answers } = state;
  const form = useApiForm({
    schema: professionIntentForm,
    initial: {
      profession: answers.profession ?? "",
      usageIntent: [...answers.usageIntent],
      country: answers.country ?? "",
      city: answers.city ?? "",
    },
    submit: (values) => submit("profession_intent", values),
  });
  const intents = form.values.usageIntent;
  return (
    <StepForm onSubmit={form.handleSubmit}>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-base font-semibold text-text">
          {t("onboarding.profession.legend")}
          <span className="ms-1 text-sm font-normal text-text-muted">{t("ui.required")}</span>
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {PROFESSIONS.map((profession) => (
            <ChoiceCard
              key={profession}
              name="profession"
              value={profession}
              checked={form.values.profession === profession}
              onChange={() => {
                form.setValue("profession", profession);
              }}
              title={label("profession", profession)}
            />
          ))}
        </div>
        {form.errors["profession"] ? <GroupError>{form.errors["profession"]}</GroupError> : null}
      </fieldset>

      <fieldset className="flex flex-col gap-1">
        <legend className="text-base font-semibold text-text">
          {t("onboarding.intent.legend")}
          <span className="ms-1 text-sm font-normal text-text-muted">{t("ui.required")}</span>
        </legend>
        <p className="text-sm text-text-muted">{t("onboarding.intent.hint")}</p>
        {USAGE_INTENTS.map((intent) => (
          <Checkbox
            key={intent}
            name="usageIntent"
            value={intent}
            label={label("usageIntent", intent)}
            checked={intents.includes(intent)}
            onChange={(event) => {
              form.setValue(
                "usageIntent",
                event.target.checked
                  ? [...intents, intent]
                  : intents.filter((item) => item !== intent),
              );
            }}
          />
        ))}
        {form.errors["usageIntent"] ? <GroupError>{t("form.required")}</GroupError> : null}
      </fieldset>

      <Field
        label={t("field.country")}
        required
        error={form.errors["country"]}
        announceError={form.submitCount > 0}
      >
        {(control) => (
          <Select {...control} {...form.bind("country")} autoComplete="country">
            <CountryOptions current={form.values.country} />
          </Select>
        )}
      </Field>
      <Field
        label={<OptionalLabel>{t("field.city")}</OptionalLabel>}
        error={form.errors["city"]}
        announceError={form.submitCount > 0}
      >
        {(control) => <Input {...control} {...form.bind("city")} autoComplete="address-level2" />}
      </Field>
      {form.formError ? <ErrorNotice error={form.formError} /> : null}
      <StepActions onBack={onBack} submitLabel={submitLabel} loading={form.submitting} />
    </StepForm>
  );
}

export function SocialStep({ submit, onBack, submitLabel, facebookUrl }: StepProps) {
  const action = useStepAction<boolean>((followed) => submit("social_follow", { followed }));
  return (
    <div className="flex flex-col gap-5">
      {action.error ? <ErrorNotice error={action.error} /> : null}
      <StepActions onBack={onBack} submitLabel={submitLabel}>
        {facebookUrl ? (
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
            <Button
              type="button"
              variant="ghost"
              name="skip-social"
              loading={action.busy}
              onClick={() => {
                action.start(false);
              }}
            >
              {t("onboarding.social.skip")}
            </Button>
            {/* The link opens in a new tab while the click also records the answer. */}
            <a
              href={facebookUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonStyles({ size: "lg" })}
              onClick={() => {
                action.start(true);
              }}
            >
              <ExternalLink aria-hidden className="size-5" />
              {t("onboarding.social.follow")}
            </a>
          </div>
        ) : (
          <Button
            type="button"
            size="lg"
            name="next"
            loading={action.busy}
            onClick={() => {
              action.start(false);
            }}
          >
            {submitLabel}
          </Button>
        )}
      </StepActions>
    </div>
  );
}
