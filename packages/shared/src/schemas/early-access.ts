import { z } from "zod";

/*
 * Early access / pre-launch waitlist on `early.wasfa.online` (docs/EARLY-ACCESS-PLAN.md).
 * Contracts shared by api, db and web. Prices are integer minor units + ISO currency (AGENT §5.5).
 */

// ---------------------------------------------------------------------------------------------
// Constants

export const EARLY_ROLES = [
  "patient",
  "caregiver",
  "doctor",
  "pharmacist",
  "pharmacy_owner",
  "clinic_owner",
  "medical_student",
  "other",
] as const;
export type EarlyRole = (typeof EARLY_ROLES)[number];

export const EARLY_FEATURES = [
  "handwriting",
  "whatsapp_bot",
  "pdf_reports_reminders",
  "no_download",
  "mobile_apps",
  "ai_assistant",
  "rx_details",
] as const;
export type EarlyFeature = (typeof EARLY_FEATURES)[number];

export const EARLY_EVENT_TYPES = [
  "view",
  "phone_focus",
  "phone_submit",
  "details_view",
  "details_submit",
  "share",
] as const;
export type EarlyEventType = (typeof EARLY_EVENT_TYPES)[number];

export const EARLY_PROBE_ANSWERS = ["yes", "maybe", "no"] as const;
export type EarlyProbeAnswer = (typeof EARLY_PROBE_ANSWERS)[number];

export const EARLY_SIGNUP_STATUSES = ["new", "contacted", "invited", "converted"] as const;
export type EarlySignupStatus = (typeof EARLY_SIGNUP_STATUSES)[number];

export const EARLY_DEVICES = ["mobile", "tablet", "desktop"] as const;
export type EarlyDevice = (typeof EARLY_DEVICES)[number];

export const EARLY_VARIANTS = ["a", "b", "c"] as const;
export type EarlyVariant = (typeof EARLY_VARIANTS)[number];

export const EARLY_PRICE_CURRENCIES = ["EGP", "SAR", "AED", "USD"] as const;
export type EarlyPriceCurrency = (typeof EARLY_PRICE_CURRENCIES)[number];

export interface ArabCountry {
  /** ISO 3166-1 alpha-2. */
  readonly iso: string;
  /** Dial code without "+". */
  readonly dial: string;
  readonly nameAr: string;
  readonly nameEn: string;
  /** Allowed national significant number lengths (digits after the dial code, no trunk 0). */
  readonly nsnMin: number;
  readonly nsnMax: number;
  /** Currency the price questions are asked in. */
  readonly priceCurrency: EarlyPriceCurrency;
}

/** The 22 Arab League states. Display order is decided by the UI (detected country first). */
export const ARAB_COUNTRIES: readonly ArabCountry[] = [
  { iso: "EG", dial: "20", nameAr: "مصر", nameEn: "Egypt", nsnMin: 10, nsnMax: 10, priceCurrency: "EGP" },
  { iso: "SA", dial: "966", nameAr: "السعودية", nameEn: "Saudi Arabia", nsnMin: 9, nsnMax: 9, priceCurrency: "SAR" },
  { iso: "AE", dial: "971", nameAr: "الإمارات", nameEn: "UAE", nsnMin: 8, nsnMax: 9, priceCurrency: "AED" },
  { iso: "KW", dial: "965", nameAr: "الكويت", nameEn: "Kuwait", nsnMin: 8, nsnMax: 8, priceCurrency: "USD" },
  { iso: "QA", dial: "974", nameAr: "قطر", nameEn: "Qatar", nsnMin: 8, nsnMax: 8, priceCurrency: "USD" },
  { iso: "BH", dial: "973", nameAr: "البحرين", nameEn: "Bahrain", nsnMin: 8, nsnMax: 8, priceCurrency: "USD" },
  { iso: "OM", dial: "968", nameAr: "عُمان", nameEn: "Oman", nsnMin: 8, nsnMax: 8, priceCurrency: "USD" },
  { iso: "JO", dial: "962", nameAr: "الأردن", nameEn: "Jordan", nsnMin: 8, nsnMax: 9, priceCurrency: "USD" },
  { iso: "LB", dial: "961", nameAr: "لبنان", nameEn: "Lebanon", nsnMin: 7, nsnMax: 8, priceCurrency: "USD" },
  { iso: "SY", dial: "963", nameAr: "سوريا", nameEn: "Syria", nsnMin: 8, nsnMax: 9, priceCurrency: "USD" },
  { iso: "IQ", dial: "964", nameAr: "العراق", nameEn: "Iraq", nsnMin: 8, nsnMax: 10, priceCurrency: "USD" },
  { iso: "PS", dial: "970", nameAr: "فلسطين", nameEn: "Palestine", nsnMin: 8, nsnMax: 9, priceCurrency: "USD" },
  { iso: "YE", dial: "967", nameAr: "اليمن", nameEn: "Yemen", nsnMin: 7, nsnMax: 9, priceCurrency: "USD" },
  { iso: "SD", dial: "249", nameAr: "السودان", nameEn: "Sudan", nsnMin: 9, nsnMax: 9, priceCurrency: "USD" },
  { iso: "LY", dial: "218", nameAr: "ليبيا", nameEn: "Libya", nsnMin: 8, nsnMax: 9, priceCurrency: "USD" },
  { iso: "TN", dial: "216", nameAr: "تونس", nameEn: "Tunisia", nsnMin: 8, nsnMax: 8, priceCurrency: "USD" },
  { iso: "DZ", dial: "213", nameAr: "الجزائر", nameEn: "Algeria", nsnMin: 8, nsnMax: 9, priceCurrency: "USD" },
  { iso: "MA", dial: "212", nameAr: "المغرب", nameEn: "Morocco", nsnMin: 9, nsnMax: 9, priceCurrency: "USD" },
  { iso: "MR", dial: "222", nameAr: "موريتانيا", nameEn: "Mauritania", nsnMin: 8, nsnMax: 8, priceCurrency: "USD" },
  { iso: "SO", dial: "252", nameAr: "الصومال", nameEn: "Somalia", nsnMin: 7, nsnMax: 9, priceCurrency: "USD" },
  { iso: "DJ", dial: "253", nameAr: "جيبوتي", nameEn: "Djibouti", nsnMin: 8, nsnMax: 8, priceCurrency: "USD" },
  { iso: "KM", dial: "269", nameAr: "جزر القمر", nameEn: "Comoros", nsnMin: 7, nsnMax: 7, priceCurrency: "USD" },
];

export const ARAB_COUNTRY_ISOS = ARAB_COUNTRIES.map((c) => c.iso) as [string, ...string[]];

export function arabCountry(iso: string | null | undefined): ArabCountry | undefined {
  if (!iso) return undefined;
  const code = iso.toUpperCase();
  return ARAB_COUNTRIES.find((c) => c.iso === code);
}

/**
 * Local number as typed (any digits, spaces, dashes, Arabic-Indic digits, leading trunk 0)
 * → E.164 for that country, or null when the length does not fit the country.
 */
export function toEarlyE164(iso: string, local: string): string | null {
  const country = arabCountry(iso);
  if (!country) return null;
  let digits = local
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, "");
  if (digits.startsWith("00" + country.dial)) digits = digits.slice(2 + country.dial.length);
  else if (digits.startsWith(country.dial) && digits.length > country.nsnMax) {
    digits = digits.slice(country.dial.length);
  }
  digits = digits.replace(/^0+/, "");
  if (digits.length < country.nsnMin || digits.length > country.nsnMax) return null;
  return `+${country.dial}${digits}`;
}

/** Monthly price ladders in minor units. Admin-editable via `earlyAccess` settings. */
export const DEFAULT_EARLY_PRICE_LADDERS: Readonly<Record<EarlyPriceCurrency, readonly number[]>> = {
  EGP: [4900, 7900, 9900, 14900, 19900],
  SAR: [900, 1500, 1900, 2900, 3900],
  AED: [900, 1500, 1900, 2900, 3900],
  USD: [299, 499, 699, 999],
};

/** Currency for the price questions: from the phone's country, else the visitor's, else USD. */
export function earlyPriceCurrency(iso: string | null | undefined): EarlyPriceCurrency {
  return arabCountry(iso)?.priceCurrency ?? "USD";
}

// ---------------------------------------------------------------------------------------------
// Settings (`earlyAccess` key in site settings)

const ladder = z.array(z.number().int().min(1).max(10_000_000)).min(2).max(8);

export const earlyAccessSettingsSchema = z.object({
  priceLadders: z
    .object({ EGP: ladder, SAR: ladder, AED: ladder, USD: ladder })
    .default({
      EGP: [...DEFAULT_EARLY_PRICE_LADDERS.EGP],
      SAR: [...DEFAULT_EARLY_PRICE_LADDERS.SAR],
      AED: [...DEFAULT_EARLY_PRICE_LADDERS.AED],
      USD: [...DEFAULT_EARLY_PRICE_LADDERS.USD],
    }),
  /** Headline A/B: when false everyone sees variant "a". */
  abHeadlines: z.boolean().default(true),
  /** The public "N joined" counter is shown only once the real count reaches this. */
  counterMinToShow: z.number().int().min(0).max(1_000_000).default(50),
});
export type EarlyAccessSettings = z.output<typeof earlyAccessSettingsSchema>;

// ---------------------------------------------------------------------------------------------
// Public API

const sessionId = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
const shortText = (max: number) => z.string().trim().max(max);
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const refCode = z.string().regex(/^[A-Za-z0-9]{6,12}$/);

/** UTM params carried from the landing URL (first touch, kept in sessionStorage). */
export const earlyUtmSchema = z
  .object({
    source: shortText(100).optional(),
    medium: shortText(100).optional(),
    campaign: shortText(150).optional(),
    content: shortText(150).optional(),
    term: shortText(150).optional(),
  })
  .strip();
export type EarlyUtm = z.output<typeof earlyUtmSchema>;

/** What the browser adds; geo always comes from Cloudflare headers on the server. */
export const earlyClientContextSchema = z.object({
  sessionId,
  utm: earlyUtmSchema.default({}),
  /** `campaign_links.slug` from `?c=` (set by the `/c/<slug>` redirect). */
  campaign: slug.optional(),
  /** Inviter's ref code from `?r=`. */
  ref: refCode.optional(),
  referrer: shortText(500).optional(),
  timezone: shortText(64).optional(),
  lang: shortText(35).optional(),
  variant: z.enum(EARLY_VARIANTS).optional(),
  screenW: z.number().int().min(0).max(20_000).optional(),
});
export type EarlyClientContext = z.input<typeof earlyClientContextSchema>;

/** `POST /public/early-access/ping` (sendBeacon, text/plain JSON) → 204. */
export const earlyEventSchema = earlyClientContextSchema.extend({
  type: z.enum(EARLY_EVENT_TYPES),
});
export type EarlyEventInput = z.input<typeof earlyEventSchema>;

/** `POST /public/early-access/join` — step 1. Header `x-turnstile-token` when configured. */
export const earlyJoinSchema = earlyClientContextSchema.extend({
  country: z.enum(ARAB_COUNTRY_ISOS),
  phone: z.string().trim().min(5).max(30),
  /** ms between first view and submit (client-measured, informational). */
  elapsedMs: z.number().int().min(0).max(86_400_000).optional(),
});
export type EarlyJoinInput = z.input<typeof earlyJoinSchema>;

export const earlyJoinResponseSchema = z.object({
  signupId: z.uuid(),
  /** HMAC token authorising the step-2 PATCH for this signup only (24 h). */
  token: z.string().min(20).max(300),
  position: z.number().int().min(1),
  refCode,
  /** Server-chosen probe price (Gabor-Granger), shown in step 2. */
  probe: z.object({ priceMinor: z.number().int().min(1), currency: z.enum(EARLY_PRICE_CURRENCIES) }),
  /** Fair-price chips for the same currency. */
  ladder: z.array(z.number().int().min(1)),
  /** True when this phone had already joined (row updated, not duplicated). */
  existing: z.boolean(),
});
export type EarlyJoinResponse = z.infer<typeof earlyJoinResponseSchema>;

/** `PATCH /public/early-access/join/:id` — step 2. Header `x-early-token`. */
export const earlyDetailsSchema = z.object({
  name: z.string().trim().min(2).max(80),
  role: z.enum(EARLY_ROLES),
  probeAnswer: z.enum(EARLY_PROBE_ANSWERS),
  /** Must be one of the ladder values for the signup's currency; null = "free only". */
  fairPriceMinor: z.number().int().min(1).nullable(),
  features: z.array(z.enum(EARLY_FEATURES)).max(EARLY_FEATURES.length).default([]),
});
export type EarlyDetailsInput = z.input<typeof earlyDetailsSchema>;

export const earlyDetailsResponseSchema = z.object({
  position: z.number().int().min(1),
  refCode,
  invited: z.number().int().min(0),
});
export type EarlyDetailsResponse = z.infer<typeof earlyDetailsResponseSchema>;

/** `GET /public/early-access/stats` (cached 60 s). `joined` is null below `counterMinToShow`. */
export const earlyStatsResponseSchema = z.object({ joined: z.number().int().min(0).nullable() });
export type EarlyStatsResponse = z.infer<typeof earlyStatsResponseSchema>;

/** `GET /public/early-access/link/:slug` → where `/c/<slug>` redirects. 404 → web redirects to `/`. */
export const earlyLinkResponseSchema = z.object({
  slug,
  utm: z.record(z.string(), z.string()),
});
export type EarlyLinkResponse = z.infer<typeof earlyLinkResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Admin API (`/admin/early-access/*`)

const isoDate = z.iso.datetime({ offset: true });

/** Shared filters for overview, list and exports. */
export const adminEarlyFilterSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  campaignLinkId: z.uuid().optional(),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  city: shortText(100).optional(),
  role: z.enum(EARLY_ROLES).optional(),
  device: z.enum(EARLY_DEVICES).optional(),
  utmSource: shortText(100).optional(),
});
export type AdminEarlyFilter = z.output<typeof adminEarlyFilterSchema>;

export const EARLY_SORT_FIELDS = [
  "createdAt",
  "name",
  "country",
  "city",
  "role",
  "fairPriceMinor",
  "probePriceMinor",
  "invited",
  "status",
] as const;
export type EarlySortField = (typeof EARLY_SORT_FIELDS)[number];

export const adminEarlySignupsQuerySchema = adminEarlyFilterSchema.extend({
  q: shortText(100).optional(),
  status: z.enum(EARLY_SIGNUP_STATUSES).optional(),
  completed: z.enum(["yes", "no"]).optional(),
  sort: z.enum(EARLY_SORT_FIELDS).default("createdAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
});
export type AdminEarlySignupsQuery = z.output<typeof adminEarlySignupsQuerySchema>;

export const adminEarlySignupSchema = z.object({
  id: z.uuid(),
  phoneE164: z.string(),
  phoneCountry: z.string(),
  name: z.string().nullable(),
  role: z.enum(EARLY_ROLES).nullable(),
  probePriceMinor: z.number().int(),
  probeCurrency: z.enum(EARLY_PRICE_CURRENCIES),
  probeAnswer: z.enum(EARLY_PROBE_ANSWERS).nullable(),
  fairPriceMinor: z.number().int().nullable(),
  features: z.array(z.enum(EARLY_FEATURES)),
  refCode: z.string(),
  referredById: z.uuid().nullable(),
  invited: z.number().int(),
  country: z.string().nullable(),
  region: z.string().nullable(),
  city: z.string().nullable(),
  timezone: z.string().nullable(),
  latApprox: z.number().nullable(),
  lonApprox: z.number().nullable(),
  device: z.enum(EARLY_DEVICES).nullable(),
  browser: z.string().nullable(),
  os: z.string().nullable(),
  lang: z.string().nullable(),
  referrerHost: z.string().nullable(),
  utm: z.record(z.string(), z.string()),
  campaignLinkId: z.uuid().nullable(),
  campaignName: z.string().nullable(),
  variant: z.enum(EARLY_VARIANTS).nullable(),
  timeToSubmitMs: z.number().int().nullable(),
  stepsCompleted: z.number().int(),
  status: z.enum(EARLY_SIGNUP_STATUSES),
  adminNote: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AdminEarlySignup = z.infer<typeof adminEarlySignupSchema>;

export const adminEarlySignupsResponseSchema = z.object({
  items: z.array(adminEarlySignupSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type AdminEarlySignupsResponse = z.infer<typeof adminEarlySignupsResponseSchema>;

export const adminEarlySignupPatchSchema = z.object({
  status: z.enum(EARLY_SIGNUP_STATUSES).optional(),
  adminNote: z.string().trim().max(2000).nullable().optional(),
});
export type AdminEarlySignupPatch = z.input<typeof adminEarlySignupPatchSchema>;

const countRow = z.object({ key: z.string(), label: z.string().nullable(), count: z.number().int() });

export const adminEarlyOverviewSchema = z.object({
  kpis: z.object({
    views: z.number().int(),
    uniqueVisitors: z.number().int(),
    phoneSubmits: z.number().int(),
    completed: z.number().int(),
    /** completed / uniqueVisitors, 0..1. */
    conversionRate: z.number(),
    today: z.number().int(),
    invitedJoins: z.number().int(),
  }),
  /** Daily buckets (UTC date `YYYY-MM-DD`) for views and sign-ups. */
  series: z.array(z.object({ date: z.string(), views: z.number().int(), signups: z.number().int() })),
  funnel: z.array(z.object({ type: z.enum(EARLY_EVENT_TYPES), sessions: z.number().int() })),
  countries: z.array(countRow.extend({ views: z.number().int() })),
  cities: z.array(countRow.extend({ country: z.string().nullable() })),
  roles: z.array(countRow),
  devices: z.array(countRow),
  sources: z.array(countRow),
  features: z.array(countRow),
  /** Gabor-Granger demand curve: share of "yes" (and "maybe") per probe price. */
  priceCurve: z.array(
    z.object({
      currency: z.enum(EARLY_PRICE_CURRENCIES),
      priceMinor: z.number().int(),
      answered: z.number().int(),
      yes: z.number().int(),
      maybe: z.number().int(),
      no: z.number().int(),
    }),
  ),
  /** Fair-price chips; priceMinor null = "free only". */
  fairPrice: z.array(
    z.object({
      currency: z.enum(EARLY_PRICE_CURRENCIES),
      priceMinor: z.number().int().nullable(),
      count: z.number().int(),
    }),
  ),
  campaigns: z.array(
    z.object({
      campaignLinkId: z.uuid().nullable(),
      name: z.string().nullable(),
      slug: z.string().nullable(),
      views: z.number().int(),
      signups: z.number().int(),
      completed: z.number().int(),
    }),
  ),
  variants: z.array(
    z.object({ variant: z.string(), views: z.number().int(), signups: z.number().int() }),
  ),
});
export type AdminEarlyOverview = z.infer<typeof adminEarlyOverviewSchema>;

/** Campaign links for the early subdomain (reuses `campaign_links`; targetPath "/"). */
export const adminEarlyLinkCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug,
  utm: earlyUtmSchema.default({}),
});
export type AdminEarlyLinkCreate = z.input<typeof adminEarlyLinkCreateSchema>;

export const adminEarlyLinkSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  utm: z.record(z.string(), z.string()),
  active: z.boolean(),
  createdAt: z.string(),
});
export type AdminEarlyLink = z.infer<typeof adminEarlyLinkSchema>;
