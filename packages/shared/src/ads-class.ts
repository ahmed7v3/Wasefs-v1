/*
 * The ad page classes and the never-serve floor, with no dependencies. Client components of the
 * public layout (the bottom banner and its beacon) import this instead of `./ads`, which pulls in
 * zod and the placement catalogue (about 17 KB gzip on every public page). `./ads` re-exports it.
 */

export const PAGE_CLASSES = [
  "marketing",
  "conversion",
  "content",
  "medical_reference",
  "utility_public",
  "app_neutral",
  "app_sensitive",
] as const;
export type PageClass = (typeof PAGE_CLASSES)[number];

/** Classes that never serve an ad, whatever the admin enables (results, chat, checkout, account, ...). */
export const NEVER_SERVE_CLASSES = [
  "conversion",
  "app_sensitive",
] as const satisfies readonly PageClass[];

export function isPageClass(value: unknown): value is PageClass {
  return typeof value === "string" && (PAGE_CLASSES as readonly string[]).includes(value);
}

export function canServeOnClass(pageClass: PageClass): boolean {
  return !(NEVER_SERVE_CLASSES as readonly string[]).includes(pageClass);
}

/** Most impression tokens one beacon request carries. */
export const AD_IMPRESSION_BATCH_MAX = 10;
