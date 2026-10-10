import { isErrorRef } from "@wasfa/shared/ids";

/** An error response from the API (`{ code, message, ref? }`), kept so the UI can show the ref. */
export class ApiRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly ref?: string,
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
