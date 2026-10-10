import { ERROR_CODES, ERROR_INFO } from "../errors/codes.js";

import type { MessageKey } from "./ar.js";

// English is planned later: stub with the keys we already have. Missing keys fall back to Arabic.
const errorMessages = Object.fromEntries(
  ERROR_CODES.map((code) => [`error.${code}`, ERROR_INFO[code].message.en]),
) as Partial<Record<MessageKey, string>>;

export const en: Partial<Record<MessageKey, string>> = {
  "brand.name": "Wasfa AI",
  "common.errorRef": "Error reference: {ref}",
  "common.contactSupport": "Contact support",
  "common.retry": "Try again",
  "common.backHome": "Back to home",
  ...errorMessages,
};
