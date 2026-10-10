import { t } from "@wasfa/shared/i18n";
import {
  signInEmailSchema,
  signInPhoneSchema,
  signUpEmailSchema,
  twoFactorVerifyTotpSchema,
} from "@wasfa/shared/schemas/auth";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ApiRequestError } from "../src/lib/api-error";
import { serverFieldErrors, validateValues, zodIssueMessage } from "../src/lib/forms";

function firstIssue(schema: z.ZodType, value: unknown) {
  const result = schema.safeParse(value);
  if (result.success) throw new Error("expected a validation failure");
  const issue = result.error.issues[0];
  if (!issue) throw new Error("no issue");
  return issue;
}

describe("zodIssueMessage", () => {
  it("says 'required' for empty and missing values, whichever rule fired", () => {
    const empty = firstIssue(signInEmailSchema, { email: "", password: "x" });
    expect(zodIssueMessage(empty, "")).toBe("form.required");
    expect(zodIssueMessage(empty, "   ")).toBe("form.required");
    expect(zodIssueMessage(empty, undefined)).toBe("form.required");
  });

  it("maps a bad email format", () => {
    const issue = firstIssue(signInEmailSchema, { email: "not-an-email", password: "x" });
    expect(zodIssueMessage(issue, "not-an-email")).toBe("form.invalidEmail");
  });

  it("maps a phone that is not E.164", () => {
    const issue = firstIssue(signInPhoneSchema, { phoneNumber: "0101", password: "x" });
    expect(zodIssueMessage(issue, "0101")).toBe("form.invalidPhone");
  });

  it("maps a short password and an overlong name", () => {
    const short = firstIssue(signUpEmailSchema, {
      name: "Sara",
      email: "a@b.co",
      password: "short",
    });
    expect(zodIssueMessage(short, "short")).toBe("form.tooShort");

    const long = firstIssue(signUpEmailSchema, {
      name: "x".repeat(101),
      email: "a@b.co",
      password: "long enough password",
    });
    expect(zodIssueMessage(long, "x".repeat(101))).toBe("form.tooLong");
  });

  it("maps a malformed one-time code", () => {
    const issue = firstIssue(twoFactorVerifyTotpSchema, { code: "12ab" });
    expect(zodIssueMessage(issue, "12ab")).toBe("form.invalidCode");
  });

  it("falls back to the generic message", () => {
    const issue = firstIssue(z.object({ n: z.number() }), { n: "x" });
    expect(zodIssueMessage({ ...issue, code: "something_else" }, "x")).toBe("form.invalid");
  });

  it("lets a schema name its own form.* message, and ignores other custom messages", () => {
    const schema = z.object({
      terms: z.boolean().refine((accepted) => accepted, { message: "form.termsRequired" }),
      other: z.string().refine(() => false, { message: "not a key" }),
    });
    const result = schema.safeParse({ terms: false, other: "x" });
    expect(result.success).toBe(false);
    const [terms, other] = result.error?.issues ?? [];
    if (!terms || !other) throw new Error("expected two issues");
    expect(zodIssueMessage(terms, false)).toBe("form.termsRequired");
    expect(zodIssueMessage(other, "x")).toBe("form.invalid");
  });
});

describe("validateValues", () => {
  it("returns the first translated message per field, and nothing for valid values", () => {
    const errors = validateValues(signUpEmailSchema, { name: "", email: "nope", password: "abc" });
    expect(errors).toEqual({
      name: t("form.required"),
      email: t("form.invalidEmail"),
      password: t("form.tooShort", { min: 10, max: 0 }),
    });
    expect(
      validateValues(signUpEmailSchema, {
        name: "Sara",
        email: "sara@example.com",
        password: "a long enough passphrase",
      }),
    ).toEqual({});
  });
});

describe("serverFieldErrors", () => {
  const schema = signUpEmailSchema;
  const known = ["name", "email", "password"];
  const validish = {
    name: "Sara",
    email: "sara@example.com",
    password: "a long enough passphrase",
  };
  const failed = (details: Record<string, unknown>) =>
    new ApiRequestError("VALIDATION_FAILED", "x", undefined, 400, details);

  it("maps the field paths onto the form, with the client message when the client also fails", () => {
    const mapped = serverFieldErrors(
      failed({ fields: ["email", "password"] }),
      schema,
      { ...validish, password: "short" },
      known,
    );
    expect(mapped).toEqual({
      email: t("form.invalid"),
      password: t("form.tooShort", { min: 10, max: 0 }),
    });
  });

  it("uses the server's reason when the client rules passed", () => {
    expect(
      serverFieldErrors(
        failed({ fields: ["password"], reason: "password_compromised" }),
        schema,
        validish,
        known,
      ),
    ).toEqual({ password: t("form.passwordCompromised") });
  });

  it("ignores paths that are not fields of this form", () => {
    expect(serverFieldErrors(failed({ fields: ["provider"] }), schema, validish, known)).toBeNull();
    expect(
      serverFieldErrors(failed({ fields: ["provider", "email"] }), schema, validish, known),
    ).toEqual({ email: t("form.invalid") });
  });

  it("is null for errors that are not field errors", () => {
    expect(
      serverFieldErrors(failed({ reason: "turnstile_required" }), schema, validish, known),
    ).toBeNull();
    expect(
      serverFieldErrors(
        new ApiRequestError("RATE_LIMITED", "x", undefined, 429),
        schema,
        validish,
        known,
      ),
    ).toBeNull();
    expect(serverFieldErrors(new Error("boom"), schema, validish, known)).toBeNull();
  });
});
