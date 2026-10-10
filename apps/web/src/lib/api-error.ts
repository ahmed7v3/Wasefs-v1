import { isErrorRef } from "@wasfa/shared/ids";

/** An error response from the API (`{ code, message, details?, ref? }`), kept so the UI can show the ref. */
export class ApiRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly ref?: string,
    /** HTTP status; `0` when no response arrived (network failure). */
    readonly status: number = 0,
    /** Client-safe details from the API (`fields`, `reason`, ...). Loosely typed: always narrow before use. */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/** The support reference carried by an error, if it has a well-formed one. */
export function extractErrorRef(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("ref" in error)) return undefined;
  const { ref } = error;
  return typeof ref === "string" && isErrorRef(ref) ? ref : undefined;
}

/** Dotted field paths a `VALIDATION_FAILED` answer points at (`details.fields`), values never included. */
export function fieldPaths(error: unknown): string[] {
  if (!(error instanceof ApiRequestError)) return [];
  const fields = error.details?.["fields"];
  return Array.isArray(fields)
    ? fields.filter((field): field is string => typeof field === "string")
    : [];
}

/** The machine-readable `details.reason` (`turnstile_required`, `email_not_verified`, ...), if any. */
export function errorReason(error: unknown): string | undefined {
  if (!(error instanceof ApiRequestError)) return undefined;
  const reason = error.details?.["reason"];
  return typeof reason === "string" ? reason : undefined;
}
