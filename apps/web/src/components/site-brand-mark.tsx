import { getPublicSettings } from "../lib/public-settings";

import { BrandMark } from "./brand-mark";

import type { Locale } from "../lib/locale";

/**
 * `BrandMark` for server components that have no settings of their own (the sign-in frames, the
 * public header). Client shells receive the branding as a prop from their layout instead. The fetch
 * is memoised per request and cached for 60 s, and falls back to the defaults when the API is down.
 */
export async function SiteBrandMark({ locale = "ar" }: { locale?: Locale }) {
  const { branding } = await getPublicSettings();
  return <BrandMark branding={branding} locale={locale} />;
}
