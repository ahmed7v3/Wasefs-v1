import { ar, type MessageKey } from "./ar.js";
import { en } from "./en.js";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "./locales.js";

export { DEFAULT_LOCALE, LOCALES, type Locale };
export type { MessageKey } from "./ar.js";
export { ar } from "./ar.js";
export { en } from "./en.js";

const dictionaries: Record<Locale, Partial<Record<MessageKey, string>>> = { ar, en };

/** Typed translation helper: unknown keys fail to compile; missing translations fall back to Arabic. */
export function t(
  key: MessageKey,
  params?: Record<string, string | number>,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const template = dictionaries[locale][key] ?? ar[key];
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}
