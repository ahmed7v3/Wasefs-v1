import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { z } from "zod";

import { parseWithSchema } from "../common/validation.js";

/*
 * Errors of the Publishing API carry what an AI agent needs to fix its request. `SafeDetails` is flat, so
 * the field-level messages are `details.fields` (paths) plus `details.messages` ("path: what is wrong"):
 * zod messages describe the rule, never the submitted value.
 */

const MESSAGE_MAX = 300;

export function validationFailed(problems: Readonly<Record<string, string>>): AppError {
  const fields = Object.keys(problems);
  return new AppError(ErrorCode.VALIDATION_FAILED, {
    details: {
      fields,
      messages: fields.map((field) => `${field}: ${(problems[field] ?? "").slice(0, MESSAGE_MAX)}`),
    },
  });
}

/** Parses with a shared schema; failures list every bad path with its rule. */
export function parseBody<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  // NUL characters (no Postgres text column accepts them) are refused exactly like everywhere else.
  parseWithSchema(z.unknown(), value);
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const problems: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join(".") || "(body)";
    problems[path] ??= issue.message;
  }
  throw validationFailed(problems);
}

export function forbidden(reason: string): AppError {
  return new AppError(ErrorCode.FORBIDDEN, { details: { reason } });
}

export function notFound(): AppError {
  return new AppError(ErrorCode.NOT_FOUND);
}
