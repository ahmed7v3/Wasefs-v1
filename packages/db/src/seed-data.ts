import { siteSettings, type NewSiteSetting } from "./schema/index.js";

import type { Database } from "./client.js";

// Safe defaults only. Admins edit these in the panel, so seeding never overwrites existing rows.
export const DEFAULT_SITE_SETTINGS: readonly NewSiteSetting[] = [
  {
    key: "branding",
    value: { nameAr: "وصفة AI", nameEn: "Wasfa AI", logoUrl: null },
  },
  {
    key: "contact",
    value: { whatsapp: null, telegram: null, phone: null, email: null },
  },
  {
    key: "socials",
    value: { facebook: null, instagram: null, tiktok: null, x: null, youtube: null },
  },
  {
    key: "locale",
    value: { defaultLocale: "ar", westernDigits: true, showHijriDates: false },
  },
  {
    key: "currency",
    value: { default: "EGP", enabled: ["EGP", "SAR", "AED", "USD"] },
  },
  {
    key: "access",
    value: { signupOpen: true, maintenanceMode: false },
  },
  {
    key: "free_tier",
    value: { monthlyAnalyses: 3 },
  },
];

/** Idempotent: existing keys are left untouched, so running twice changes nothing. */
export async function seedDefaults(db: Database): Promise<number> {
  const inserted = await db
    .insert(siteSettings)
    .values([...DEFAULT_SITE_SETTINGS])
    .onConflictDoNothing({ target: siteSettings.key })
    .returning({ key: siteSettings.key });
  return inserted.length;
}
