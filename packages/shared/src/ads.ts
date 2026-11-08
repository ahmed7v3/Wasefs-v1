import { z } from "zod";

/*
 * First-party ads (docs/ADS.md, openspec change home-ads-conversion). Everything here is either the
 * safety floor, which is CODE and cannot be changed from the admin, or a contract shared by api, db,
 * web and worker. Ad selection never uses health data; no cookie or user id is part of any ad datum.
 */

// ---------------------------------------------------------------------------------------------
// Page classes and the safety floor

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

/** Classes a placement may be configured for: everything except the never-serve ones. */
export const SERVABLE_PAGE_CLASSES = PAGE_CLASSES.filter(
  (pageClass) => !(NEVER_SERVE_CLASSES as readonly string[]).includes(pageClass),
);

export function canServeOnClass(pageClass: PageClass): boolean {
  return !(NEVER_SERVE_CLASSES as readonly string[]).includes(pageClass);
}

/** A creative of these categories can never be approved (ADS §1.3). */
export const FORBIDDEN_CATEGORIES = ["medicine"] as const;

export const AD_CATEGORIES = [
  "house",
  "pharmacy_delivery",
  "insurance",
  "labs_clinics",
  "health_devices",
  "wellness_apps",
  "education",
  "retail",
  "other",
  ...FORBIDDEN_CATEGORIES,
] as const;
export type AdCategory = (typeof AD_CATEGORIES)[number];

export function isForbiddenCategory(category: string): boolean {
  return (FORBIDDEN_CATEGORIES as readonly string[]).includes(category);
}

/** The label shown on every ad; the text lives in i18n and is added by code, never by the creative. */
export const AD_LABEL_KEY = "ads.label" as const;
export const AD_CLOSE_KEY = "ads.close" as const;

// ---------------------------------------------------------------------------------------------
// Catalog (positions are code; the admin toggles and tunes them)

export const AD_DEVICES = ["mobile", "tablet", "desktop"] as const;
export type AdDevice = (typeof AD_DEVICES)[number];
export const AD_CHANNELS = ["web", "whatsapp"] as const;
export type AdChannel = (typeof AD_CHANNELS)[number];
export const AD_FORMATS = ["banner", "native", "bottom_banner"] as const;
export type AdFormat = (typeof AD_FORMATS)[number];
export const AD_STATUSES = ["draft", "approved", "paused", "archived"] as const;
export type AdStatus = (typeof AD_STATUSES)[number];
export const AD_LOCALES = ["ar", "en"] as const;

export interface AdPlacementSeed {
  key: string;
  pageClass: PageClass;
  format: AdFormat;
  /** `WxH` in CSS pixels, or `native` for an image + title card. */
  sizeDesktop: string;
  sizeMobile: string;
  maxPerPage: number;
  closable: boolean;
  dismissDays: number;
  allowPaid: boolean;
  sort: number;
}

/** The migration seeds exactly these rows, all disabled (a unit test keeps SQL and this list equal). */
export const AD_PLACEMENT_CATALOG: readonly AdPlacementSeed[] = [
  seed("home.after_hero", "marketing", "banner", "970x250", "320x100", 1, 10),
  seed("home.mid", "marketing", "banner", "970x250", "320x100", 1, 20),
  seed("home.before_faq", "marketing", "banner", "970x250", "320x100", 1, 30),
  seed("blog.feed", "content", "native", "native", "native", 2, 40),
  seed("article.inline.1", "content", "banner", "728x90", "320x100", 1, 50),
  seed("article.inline.2", "content", "banner", "728x90", "300x250", 1, 60),
  seed("article.sidebar", "content", "banner", "300x250", "300x250", 1, 70),
  seed("article.end", "content", "native", "native", "native", 1, 80),
  seed("glossary.end", "content", "native", "native", "native", 1, 90),
  seed("drug.sidebar", "medical_reference", "banner", "300x250", "300x250", 1, 100),
  seed("drug.end", "medical_reference", "native", "native", "native", 1, 110),
  seed("drugs.hub.mid", "medical_reference", "banner", "970x250", "320x100", 1, 120),
  seed("search.top", "utility_public", "banner", "728x90", "320x100", 1, 130),
  seed("app.dashboard.card", "app_neutral", "native", "native", "native", 1, 140, false),
  seed("app.analyze.start", "app_neutral", "native", "native", "320x100", 1, 150, false),
  seed("app.analyze.waiting", "app_neutral", "native", "native", "native", 1, 160, false),
  {
    key: "global.bottom_banner",
    pageClass: "marketing",
    format: "bottom_banner",
    sizeDesktop: "728x90",
    sizeMobile: "320x50",
    maxPerPage: 1,
    closable: true,
    dismissDays: 7,
    allowPaid: true,
    sort: 5,
  },
];

function seed(
  key: string,
  pageClass: PageClass,
  format: AdFormat,
  sizeDesktop: string,
  sizeMobile: string,
  maxPerPage: number,
  sort: number,
  allowPaid = true,
): AdPlacementSeed {
  return {
    key,
    pageClass,
    format,
    sizeDesktop,
    sizeMobile,
    maxPerPage,
    closable: false,
    dismissDays: 7,
    allowPaid,
    sort,
  };
}

/** Classes the bottom banner serves by default (the admin picks the final set). */
export const BOTTOM_BANNER_DEFAULT_CLASSES = ["marketing", "content", "utility_public"] as const;

export const AD_PLACEMENT_KEYS = AD_PLACEMENT_CATALOG.map((entry) => entry.key);
export const adPlacementKeySchema = z.string().regex(/^[a-z][a-z0-9_.]{1,63}$/);

export function parseAdSize(size: string): { width: number; height: number } | null {
  const match = /^(\d{2,4})x(\d{2,4})$/.exec(size);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

// ---------------------------------------------------------------------------------------------
// Settings key `ads`

const perClass = z.partialRecord(z.enum(PAGE_CLASSES), z.number().int().min(0).max(10));

export const DEFAULT_MAX_PER_PAGE: Record<PageClass, number> = {
  marketing: 1,
  conversion: 0,
  content: 3,
  medical_reference: 2,
  utility_public: 1,
  app_neutral: 1,
  app_sensitive: 0,
};

export const adsWhatsappSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  triggers: z
    .array(
      z.enum([
        "after_rx_done",
        "after_command:help",
        "after_command:balance",
        "after_command:report",
        "after_command:schedule",
      ]),
    )
    .max(10)
    .default(["after_rx_done"]),
  probability: z.number().min(0).max(1).default(0.7),
  maxPerUserPerDay: z.number().int().min(0).max(20).default(2),
  minGapHours: z.number().int().min(0).max(168).default(6),
  globalDailyLimit: z.number().int().min(0).max(1_000_000).default(300),
  quietHours: z
    .object({
      from: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .default("23:00"),
      to: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .default("08:00"),
      timezone: z.string().min(1).max(64).default("Africa/Cairo"),
    })
    .default({ from: "23:00", to: "08:00", timezone: "Africa/Cairo" }),
  allowOptOut: z.boolean().default(true),
});

/** Admin-editable (never public): the global kill switch, density per class and banner defaults. */
export const adsSettingsSchema = z.object({
  /** Global kill switch: off = no slot is rendered anywhere. */
  enabled: z.boolean().default(false),
  /** Missing classes fall back to `DEFAULT_MAX_PER_PAGE`; the floor classes always serve nothing. */
  maxPerPage: perClass.default({ ...DEFAULT_MAX_PER_PAGE }),
  bottomBanner: z
    .object({
      enabled: z.boolean().default(false),
      pageClasses: z
        .array(z.enum(SERVABLE_PAGE_CLASSES as [PageClass, ...PageClass[]]))
        .max(SERVABLE_PAGE_CLASSES.length)
        .default([...BOTTOM_BANNER_DEFAULT_CLASSES]),
      dismissDays: z.number().int().min(1).max(365).default(7),
    })
    .default({
      enabled: false,
      pageClasses: [...BOTTOM_BANNER_DEFAULT_CLASSES],
      dismissDays: 7,
    }),
  whatsapp: adsWhatsappSettingsSchema.default(adsWhatsappSettingsSchema.parse({})),
});
export type AdsSettings = z.output<typeof adsSettingsSchema>;

/** The cap for a class: the admin value, else the default; the never-serve classes are always 0. */
export function maxAdsForClass(settings: AdsSettings, pageClass: PageClass): number {
  if (!canServeOnClass(pageClass)) return 0;
  return settings.maxPerPage[pageClass] ?? DEFAULT_MAX_PER_PAGE[pageClass];
}

// ---------------------------------------------------------------------------------------------
// Admin API boundary

const httpsUrl = z
  .url({ protocol: /^https$/ })
  .max(2_000)
  .refine((value) => !/\s/.test(value), "no whitespace");

const targetingSchema = z.object({
  placements: z.array(adPlacementKeySchema).max(40).default([]),
  pageClasses: z
    .array(z.enum(SERVABLE_PAGE_CLASSES as [PageClass, ...PageClass[]]))
    .max(10)
    .default([]),
  devices: z.array(z.enum(AD_DEVICES)).max(3).default([]),
  locales: z.array(z.enum(AD_LOCALES)).max(2).default([]),
  countries: z
    .array(z.string().regex(/^[A-Z]{2}$/))
    .max(250)
    .default([]),
});
export type AdTargeting = z.output<typeof targetingSchema>;
export const EMPTY_TARGETING: AdTargeting = {
  placements: [],
  pageClasses: [],
  devices: [],
  locales: [],
  countries: [],
};

const isoDate = z.iso.datetime({ offset: true });

export const advertiserInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.enum(
    AD_CATEGORIES.filter((c) => !isForbiddenCategory(c)) as [AdCategory, ...AdCategory[]],
  ),
  contact: z.string().trim().max(300).nullable().default(null),
  active: z.boolean().default(true),
});
export type AdvertiserInput = z.output<typeof advertiserInputSchema>;

export const creativeFieldsSchema = z.object({
  /** null = a house creative (our own offer). */
  advertiserId: z.uuid().nullable().default(null),
  title: z.string().trim().min(1).max(120),
  imageMediaId: z.uuid().nullable().default(null),
  alt: z.string().trim().min(1).max(300),
  targetUrl: httpsUrl,
  category: z.enum(AD_CATEGORIES),
  channels: z.array(z.enum(AD_CHANNELS)).min(1).max(2).default(["web"]),
  /** WhatsApp message body (the «إعلان» label is added by code). */
  waText: z.string().trim().min(1).max(700).nullable().default(null),
  startsAt: isoDate.nullable().default(null),
  endsAt: isoDate.nullable().default(null),
  weight: z.number().int().min(1).max(1_000).default(100),
  targeting: targetingSchema.default(EMPTY_TARGETING),
});

function scheduleIsOrdered(value: {
  startsAt?: string | null | undefined;
  endsAt?: string | null | undefined;
}): boolean {
  return !value.startsAt || !value.endsAt || Date.parse(value.startsAt) < Date.parse(value.endsAt);
}

/** Creating always makes a draft; approval is a separate action that runs the category check. */
export const createCreativeSchema = creativeFieldsSchema.refine(scheduleIsOrdered, {
  message: "startsAt must be before endsAt",
  path: ["endsAt"],
});
export const updateCreativeSchema = creativeFieldsSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "at least one field")
  .refine(scheduleIsOrdered, { message: "startsAt must be before endsAt", path: ["endsAt"] });
export type CreateCreativeInput = z.output<typeof createCreativeSchema>;
export type UpdateCreativeInput = z.output<typeof updateCreativeSchema>;

export const creativeStatusActionSchema = z.object({
  status: z.enum(["approved", "paused", "archived", "draft"]),
});

const sizeField = z.string().regex(/^(native|\d{2,4}x\d{2,4})$/);
export const updatePlacementSchema = z
  .object({
    enabled: z.boolean(),
    pageClasses: z
      .array(z.enum(SERVABLE_PAGE_CLASSES as [PageClass, ...PageClass[]]))
      .min(1)
      .max(10),
    devices: z.array(z.enum(AD_DEVICES)).min(1).max(3),
    maxPerPage: z.number().int().min(0).max(10),
    sizeDesktop: sizeField,
    sizeMobile: sizeField,
    closable: z.boolean(),
    dismissDays: z.number().int().min(1).max(365),
    allowPaid: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "at least one field");
export type UpdatePlacementInput = z.output<typeof updatePlacementSchema>;

// ---------------------------------------------------------------------------------------------
// Public delivery contracts

export const adSlotQuerySchema = z.object({
  placement: adPlacementKeySchema,
  pageClass: z.enum(PAGE_CLASSES),
  device: z.enum(AD_DEVICES).optional(),
  locale: z.enum(AD_LOCALES).optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  /** `placement:creativeId` pairs already rendered on this page, comma separated (density, dedupe). */
  already: z
    .string()
    .max(600)
    .regex(/^[A-Za-z0-9_.,:-]*$/)
    .optional(),
});
export type AdSlotQuery = z.output<typeof adSlotQuerySchema>;

export const adSlotViewSchema = z.object({
  /** Lets the page tell the next slot what is already shown (density and advertiser dedupe). */
  creativeId: z.uuid(),
  token: z.string().min(1).max(400),
  placement: adPlacementKeySchema,
  format: z.enum(AD_FORMATS),
  sizeDesktop: z.string(),
  sizeMobile: z.string(),
  closable: z.boolean(),
  dismissDays: z.number().int(),
  creative: z.object({
    title: z.string(),
    alt: z.string(),
    image: z
      .object({
        url: z.string(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .nullable(),
    advertiserName: z.string().nullable(),
  }),
});
export type AdSlotView = z.output<typeof adSlotViewSchema>;

/** `{ slot: null }` = nothing to show; the slot collapses. */
export const adSlotResponseSchema = z.object({ slot: adSlotViewSchema.nullable() });
export type AdSlotResponse = z.output<typeof adSlotResponseSchema>;

export const AD_IMPRESSION_BATCH_MAX = 10;
export const adImpressionsSchema = z.object({
  tokens: z.array(z.string().min(1).max(400)).min(1).max(AD_IMPRESSION_BATCH_MAX),
});

export const adClickSchema = z.object({ token: z.string().min(1).max(400) });
export const adClickResponseSchema = z.object({ url: httpsUrl });

/** Redis counter key of the rollup (worker) and the counters (api): one place so they cannot drift. */
export function adCounterKey(parts: {
  creativeId: string;
  placement: string;
  day: string;
  channel: AdChannel;
  kind: "i" | "c";
}): string {
  return `ads:c:${parts.creativeId}:${parts.placement}:${parts.day}:${parts.channel}:${parts.kind}`;
}

export const AD_COUNTER_KEY_PATTERN =
  /^ads:c:([0-9a-f-]{36}):([a-z][a-z0-9_.]{1,63}):(\d{4}-\d{2}-\d{2}):(web|whatsapp):(i|c)$/;

export function parseAdCounterKey(key: string): {
  creativeId: string;
  placement: string;
  day: string;
  channel: AdChannel;
  kind: "i" | "c";
} | null {
  const match = AD_COUNTER_KEY_PATTERN.exec(key);
  if (!match) return null;
  return {
    creativeId: match[1] as string,
    placement: match[2] as string,
    day: match[3] as string,
    channel: match[4] as AdChannel,
    kind: match[5] as "i" | "c",
  };
}
