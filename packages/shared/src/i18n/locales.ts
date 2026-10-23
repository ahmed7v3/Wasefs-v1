/** Supported languages. Kept apart from the catalogues so schemas can import it without them. */
export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "ar";
