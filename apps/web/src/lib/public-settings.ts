import "server-only";

import { publicSettingsSchema, settingDefault, type PublicSettings } from "@wasfa/shared/settings";
import { cache } from "react";

import { serverEnv } from "./server-env";

/** Every public key at its registry default: no contact hub, no socials, the default free tier. */
export const PUBLIC_SETTINGS_FALLBACK: PublicSettings = {
  branding: settingDefault("branding"),
  contact: settingDefault("contact"),
  socials: settingDefault("socials"),
  locale: settingDefault("locale"),
  currency: settingDefault("currency"),
  access: settingDefault("access"),
  free_tier: settingDefault("free_tier"),
};

/** The public pages wait this long for the API, then render with the defaults. */
export const PUBLIC_SETTINGS_TIMEOUT_MS = 2_000;

/**
 * The public site settings (contact hub, socials, free tier), fetched once per request. The API
 * already sends `max-age=60`; `revalidate: 60` lets Next's data cache do the same between requests.
 * Public pages must never fail because the API is down or slow: an unreachable API, a timeout, an
 * error status or an unexpected body all fall back to the registry defaults.
 */
export const getPublicSettings = cache(async (): Promise<PublicSettings> => {
  try {
    const response = await fetch(`${serverEnv.API_INTERNAL_URL}/settings/public`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(PUBLIC_SETTINGS_TIMEOUT_MS),
    });
    if (!response.ok) return PUBLIC_SETTINGS_FALLBACK;
    const parsed = publicSettingsSchema.safeParse(await response.json().catch(() => undefined));
    return parsed.success ? parsed.data : PUBLIC_SETTINGS_FALLBACK;
  } catch {
    return PUBLIC_SETTINGS_FALLBACK;
  }
});
