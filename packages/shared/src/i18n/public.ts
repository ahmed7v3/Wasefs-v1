import { arBilling } from "./ar.billing.js";
import { arCore } from "./ar.core.js";
import { arErrors } from "./ar.errors.js";
import { arPublicContent } from "./ar.public-content.js";
import { arPublic } from "./ar.public.js";
import { enBilling } from "./en.billing.js";
import { enCore } from "./en.core.js";
import { enErrors } from "./en.errors.js";
import { enPublicContent } from "./en.public-content.js";
import { enPublic } from "./en.public.js";

import type { MessageKey } from "./ar.js";
import type { Locale } from "./locales.js";

/*
 * `t` for client components on public routes (landing, pricing, contact, legal, error pages).
 * The full catalogue is ~150 KB gzip because it carries the admin console and the whole app; this
 * one holds only the namespaces those pages use (core, billing, API error messages), so importing it
 * keeps the rest out of a public page's first load. `public-catalogue.test.ts` fails when a client
 * file on a public route uses a key that is not here. Server components keep the full `t`.
 */
const publicAr: Partial<Record<MessageKey, string>> = {
  ...arCore,
  ...arPublic,
  ...arPublicContent,
  ...arBilling,
  ...arErrors,
};
const publicEn: Partial<Record<MessageKey, string>> = {
  ...enCore,
  ...enPublic,
  ...enPublicContent,
  ...enBilling,
  ...enErrors,
};
const dictionaries: Record<Locale, Partial<Record<MessageKey, string>>> = {
  ar: publicAr,
  en: publicEn,
};

/** Keys of the public catalogue (the test reads them; not for runtime lookups). */
export const PUBLIC_MESSAGE_KEYS: readonly string[] = Object.keys(publicAr);

/** Same contract as `t` in `@wasfa/shared/i18n`; a key outside the public catalogue returns itself. */
export function t(
  key: MessageKey,
  params?: Record<string, string | number>,
  locale: Locale = "ar",
): string {
  const template = dictionaries[locale][key] ?? publicAr[key] ?? key;
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}

/** Whether `key` is in the public catalogue (for keys that arrive as zod issue messages). */
export function hasMessage(key: string): key is MessageKey {
  return Object.hasOwn(publicAr, key);
}

export type { MessageKey } from "./ar.js";
export type { Locale } from "./locales.js";
