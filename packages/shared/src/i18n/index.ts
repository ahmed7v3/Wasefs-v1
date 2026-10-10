import { ar, type MessageKey } from "./ar.js";
import { en } from "./en.js";

export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export type { MessageKey } from "./ar.js";
export { ar } from "./ar.js";
export { en } from "./en.js";

export const DEFAULT_LOCALE: Locale = "ar";

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
