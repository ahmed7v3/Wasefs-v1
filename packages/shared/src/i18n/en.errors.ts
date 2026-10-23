import { ERROR_CODES, ERROR_INFO } from "../errors/codes.js";

import type { MessageKey } from "./ar.js";

/** One `error.<CODE>` message per API error code (English). */
export const enErrors = Object.fromEntries(
  ERROR_CODES.map((code) => [`error.${code}`, ERROR_INFO[code].message.en]),
) as Partial<Record<MessageKey, string>>;
