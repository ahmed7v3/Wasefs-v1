import "server-only";

import { publicSettingsSchema, type PublicSettings } from "@wasfa/shared/settings";
import { cache } from "react";

import { serverEnv } from "./server-env";

/** Every key falls back to its registry default (each schema's fields all have one). */
const DEFAULTS: PublicSettings = publicSettingsSchema.parse({
  branding: {},
  contact: {},
  socials: {},
  locale: {},
  currency: {},
  access: {},
  free_tier: {},
});

/**
 * The public site settings (contact hub, socials, free tier), fetched once per request. The API
 * already sends `max-age=60`; `revalidate: 60` lets Next's data cache do the same between requests.
 * A failure is not worth an error page: the defaults hide the contact hub and the socials.
 */
export const getPublicSettings = cache(async (): Promise<PublicSettings> => {
  try {
    const response = await fetch(`${serverEnv.API_INTERNAL_URL}/settings/public`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 60 },
    });
    if (!response.ok) return DEFAULTS;
    const parsed = publicSettingsSchema.safeParse(await response.json().catch(() => undefined));
    return parsed.success ? parsed.data : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
});
