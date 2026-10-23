"use client";

import { hasMessage, t, type MessageKey } from "@wasfa/shared/i18n/public";
import { useCallback, useRef, useState } from "react";

import { ApiRequestError, errorReason, fieldPaths } from "./api-error";

import type { ChangeEvent, FocusEvent, FormEvent } from "react";
import type { z } from "zod";

/*
 * Client side of DESIGN-SYSTEM §6: the browser runs the SAME shared zod schema as the API, so the
 * messages are instant and specific; the server stays the authority and its `VALIDATION_FAILED`
 * field paths are mapped back onto the same inputs.
 */

/** The parts of a zod issue the message mapping reads (kept loose so zod's union stays assignable). */
export interface IssueLike {
  code: string;
  path: readonly PropertyKey[];
  message: string;
  minimum?: number | bigint | undefined;
  maximum?: number | bigint | undefined;
  format?: string | undefined;
}

const PHONE_FIELDS = new Set(["phoneNumber", "phone"]);

function isBlank(input: unknown): boolean {
  return (
    input === undefined || input === null || (typeof input === "string" && input.trim() === "")
  );
}

function isFormKey(value: string): value is MessageKey {
  return value.startsWith("form.") && hasMessage(value);
}

/**
 * Which message explains a zod issue. `input` is what the user typed in that field: an empty field
 * is "required" whatever rule happened to fire first (an empty email fails the email format, but the
 * useful thing to say is that it is missing). A schema can also name its message directly by passing
 * a `form.*` key as the issue message (used for the terms checkbox).
 */
export function zodIssueMessage(issue: IssueLike, input?: unknown): MessageKey {
  if (issue.code === "custom" && isFormKey(issue.message)) return issue.message;
  if (issue.code !== "too_big" && isBlank(input)) return "form.required";
  switch (issue.code) {
    case "too_small":
      return "form.tooShort";
    case "too_big":
      return "form.tooLong";
    case "invalid_format": {
      const field = String(issue.path[issue.path.length - 1] ?? "");
      if (issue.format === "email") return "form.invalidEmail";
      if (PHONE_FIELDS.has(field)) return "form.invalidPhone";
      if (field === "code") return "form.invalidCode";
      return "form.invalid";
    }
    case "invalid_type":
      return "form.required";
    default:
      return "form.invalid";
  }
}

/** The finished, translated text for one issue. */
export function describeIssue(issue: IssueLike, input?: unknown): string {
  return t(zodIssueMessage(issue, input), {
    min: Number(issue.minimum ?? 0),
    max: Number(issue.maximum ?? 0),
  });
}

function valueAt(values: unknown, path: readonly PropertyKey[]): unknown {
  let current: unknown = values;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

/** First message per dotted field path; empty when the values satisfy the schema. */
export function validateValues(schema: z.ZodType, values: unknown): Record<string, string> {
  const result = schema.safeParse(values);
  if (result.success) return {};
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join(".");
    if (path === "" || Object.hasOwn(errors, path)) continue;
    errors[path] = describeIssue(issue, valueAt(values, issue.path));
  }
  return errors;
}

/** Messages for server complaints the client schema could not have caught on its own. */
const SERVER_REASON_MESSAGES: Record<string, MessageKey> = {
  password_compromised: "form.passwordCompromised",
  email_domain_blocked: "form.emailDomainBlocked",
};

/**
 * Maps a server `VALIDATION_FAILED` onto field messages: the client schema's own message when it
 * also rejects the value, else the reason the server gave, else the generic "invalid value".
 * Returns `null` when the error does not point at any known field (it is then a form-level error).
 */
export function serverFieldErrors(
  error: unknown,
  schema: z.ZodType,
  values: unknown,
  knownFields: readonly string[],
): Record<string, string> | null {
  if (!(error instanceof ApiRequestError) || error.code !== "VALIDATION_FAILED") return null;
  const fields = fieldPaths(error).filter((field) => knownFields.includes(field));
  if (fields.length === 0) return null;
  const client = validateValues(schema, values);
  const reason = errorReason(error);
  const reasonKey = reason ? SERVER_REASON_MESSAGES[reason] : undefined;
  const mapped: Record<string, string> = {};
  for (const field of fields) {
    mapped[field] = client[field] ?? (reasonKey ? t(reasonKey) : t("form.invalid"));
  }
  return mapped;
}

/** Any thrown value as an `ApiRequestError`, so a form always has one kind of error to show. */
export function toApiError(error: unknown): ApiRequestError {
  return error instanceof ApiRequestError
    ? error
    : new ApiRequestError("INTERNAL", t("error.INTERNAL"));
}

function focusField(form: HTMLFormElement, name: string): void {
  const element = form.elements.namedItem(name);
  if (element instanceof HTMLElement) element.focus();
}

/** The summary shows from this many invalid fields on (DESIGN-SYSTEM §6.4: "more than 3"). */
export const SUMMARY_THRESHOLD = 3;

export interface UseApiFormOptions<S extends z.ZodType<object, object>> {
  /** The shared schema (or an extension of it with client-only fields such as the terms checkbox). */
  schema: S;
  initial: z.input<S>;
  /** Receives the parsed values. Throw (the `api` client does) to show the error. */
  submit: (values: z.output<S>) => Promise<void>;
  /** Keep the button busy after success: the submit navigates away and re-enabling it would flicker. */
  holdOnSuccess?: boolean;
}

export interface ApiForm<S extends z.ZodType<object, object>> {
  values: z.input<S>;
  setValue: <K extends keyof z.input<S> & string>(name: K, value: z.input<S>[K]) => void;
  /** Props for a text-like control: `name`, `value`, `onChange`, `onBlur`. */
  bind: (name: keyof z.input<S> & string) => {
    name: string;
    value: string;
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
    onBlur: (event: FocusEvent<HTMLInputElement | HTMLSelectElement>) => void;
  };
  /** Props for a checkbox. */
  bindCheckbox: (name: keyof z.input<S> & string) => {
    name: string;
    checked: boolean;
    onChange: (event: ChangeEvent<HTMLInputElement>) => void;
    onBlur: () => void;
  };
  /** Message per dotted field path. */
  errors: Record<string, string>;
  /** A failure that is not about one field (wrong password, rate limit, network). */
  formError: ApiRequestError | null;
  setFormError: (error: ApiRequestError | null) => void;
  submitting: boolean;
  /** Counts failed submits so the error summary can take focus every time. */
  submitCount: number;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** Re-validates one field (use after changing a value that has no `blur`, e.g. a phone picker). */
  blur: (name: string) => void;
}

export function useApiForm<S extends z.ZodType<object, object>>({
  schema,
  initial,
  submit,
  holdOnSuccess = false,
}: UseApiFormOptions<S>): ApiForm<S> {
  const [values, setValues] = useState<z.input<S>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<ApiRequestError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitCount, setSubmitCount] = useState(0);
  const inFlight = useRef(false);
  const knownFields = Object.keys(initial);

  /** Re-checks one field against `next`: sets or clears just its message. */
  const revalidate = useCallback(
    (name: string, next: z.input<S>) => {
      const all = validateValues(schema, next);
      setErrors((current) => {
        const rest = Object.fromEntries(Object.entries(current).filter(([key]) => key !== name));
        const message = all[name];
        return message === undefined ? rest : { ...rest, [name]: message };
      });
    },
    [schema],
  );

  const setValue = useCallback(
    <K extends keyof z.input<S> & string>(name: K, value: z.input<S>[K]) => {
      const next = { ...values, [name]: value } as z.input<S>;
      setValues(next);
      // Only a field that already shows an error is re-judged while typing: no scolding mid-word.
      if (Object.hasOwn(errors, name)) revalidate(name, next);
    },
    [values, errors, revalidate],
  );

  const blur = useCallback(
    (name: string) => {
      // A field the user never typed in is not an error yet.
      const raw = valueAt(values, [name]);
      if (isBlank(raw) && !Object.hasOwn(errors, name)) return;
      revalidate(name, values);
    },
    [values, errors, revalidate],
  );

  const bind: ApiForm<S>["bind"] = (name) => ({
    name,
    value: String(valueAt(values, [name]) ?? ""),
    onChange: (event) => {
      setValue(name, event.target.value as z.input<S>[typeof name]);
    },
    onBlur: () => {
      blur(name);
    },
  });

  const bindCheckbox: ApiForm<S>["bindCheckbox"] = (name) => ({
    name,
    checked: valueAt(values, [name]) === true,
    onChange: (event) => {
      setValue(name, event.target.checked as z.input<S>[typeof name]);
    },
    onBlur: () => {
      /* validated on submit and when toggled */
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (inFlight.current) return;
    const form = event.currentTarget;

    const invalid = validateValues(schema, values);
    const invalidNames = Object.keys(invalid);
    if (invalidNames.length > 0) {
      setSubmitCount((count) => count + 1);
      setErrors(invalid);
      setFormError(null);
      // Past the threshold the summary takes focus; otherwise the first bad field does.
      const first = invalidNames[0];
      if (first !== undefined && invalidNames.length <= SUMMARY_THRESHOLD) {
        requestAnimationFrame(() => {
          focusField(form, first);
        });
      }
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    setFormError(null);
    setErrors({});
    void (async () => {
      let succeeded = false;
      try {
        await submit(schema.parse(values));
        succeeded = true;
      } catch (error) {
        const mapped = serverFieldErrors(error, schema, values, knownFields);
        if (mapped) {
          setSubmitCount((count) => count + 1);
          setErrors(mapped);
          const names = Object.keys(mapped);
          const first = names[0];
          if (first !== undefined && names.length <= SUMMARY_THRESHOLD) {
            requestAnimationFrame(() => {
              focusField(form, first);
            });
          }
        } else {
          setFormError(toApiError(error));
        }
      } finally {
        inFlight.current = false;
        if (!(succeeded && holdOnSuccess)) setSubmitting(false);
      }
    })();
  };

  return {
    values,
    setValue,
    bind,
    bindCheckbox,
    errors,
    formError,
    setFormError,
    submitting,
    submitCount,
    handleSubmit,
    blur,
  };
}
