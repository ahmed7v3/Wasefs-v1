import { ERROR_CODES, ERROR_INFO, type ErrorCode } from "../errors/codes.js";

type ErrorMessageKey = `error.${ErrorCode}`;

/** One `error.<CODE>` message per API error code (Arabic). */
export const arErrors = Object.fromEntries(
  ERROR_CODES.map((code) => [`error.${code}`, ERROR_INFO[code].message.ar]),
) as Record<ErrorMessageKey, string>;
