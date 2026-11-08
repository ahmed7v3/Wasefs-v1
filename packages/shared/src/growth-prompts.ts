import { z } from "zod";

import {
  GROWTH_PROMPT_FORMS,
  GROWTH_PROMPT_KINDS,
  modalAllowed,
  type GrowthPromptKind,
} from "./growth.js";
import { ar } from "./i18n/ar.js";
import { en } from "./i18n/en.js";
import { normalizeArabic } from "./normalize.js";
import { PLAN_KEY_PATTERN } from "./plans.js";

/*
 * The settings-backed prompt catalog (home-ads-conversion, D7): one entry per prompt kind with its
 * form, Arabic and English copy, target plan, destination and cooldown. Copy holds `{placeholders}`
 * that the server fills from the plans, prices and entitlements, so a price change reaches every
 * prompt without editing it. Pure and dependency-light: the api renders and lints, the admin page
 * shows the same defaults.
 */

/** Copy of one locale: `title` and `secondary` are optional, the body and the buttons are not. */
export const promptCopySchema = z.object({
  title: z.string().trim().max(120).default(""),
  body: z.string().trim().min(1).max(500),
  cta: z.string().trim().min(1).max(60),
  secondary: z.string().trim().min(1).max(60).optional(),
  close: z.string().trim().min(1).max(40),
});
export type PromptCopy = z.output<typeof promptCopySchema>;

/** A destination: an app path or an https URL, never a protocol-relative or script URL. */
const promptHref = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine((href) => /^\/(?!\/)/.test(href) || /^https:\/\//.test(href), "href_not_allowed");

export const promptEntrySchema = z.object({
  enabled: z.boolean().default(true),
  form: z.enum(GROWTH_PROMPT_FORMS).default("inline"),
  copy: z.object({ ar: promptCopySchema, en: promptCopySchema }),
  /** `plans.key` the copy names; `null` = the recommended plan (pinned, else the cheapest). */
  targetPlan: z.string().regex(PLAN_KEY_PATTERN).max(64).nullable().default(null),
  /** `href` is not used by the taste button (it starts the free deep reading itself). */
  cta: z.object({ href: promptHref.nullable() }),
  secondaryHref: promptHref.optional(),
  /** Days a dismissed prompt stays quiet (doubling per dismissal); `null` = the global default. */
  cooldownDays: z.number().int().min(0).max(365).nullable().default(null),
});
export type PromptEntry = z.output<typeof promptEntrySchema>;
export type PromptEntryInput = z.input<typeof promptEntrySchema>;

/** Terms that no prompt may use (case-insensitive, Arabic spelling normalized). */
export const DEFAULT_BANNED_CLAIMS = [
  "أدق",
  "أكثر دقة",
  "more accurate",
  "مضمون",
  "guaranteed",
  "علاج",
  "شفاء",
  "cure",
  "يحمي صحتك",
  "protects your health",
] as const;

/** Allowed only when the target plan really has the deep-mode entitlement. */
export const DEEP_CLAIM_TERMS = ["أدق", "more accurate"] as const;

function fold(text: string): string {
  return normalizeArabic(text).toLowerCase();
}

function containsTerm(text: string, term: string): boolean {
  const folded = fold(term);
  if (folded === "") return false;
  // A Latin term must stand alone ("cure" is not in "secure"); Arabic has no such word boundary.
  if (/^[a-z ]+$/.test(folded)) {
    return new RegExp(`(?<![a-z])${folded.replace(/ /g, "\\s+")}(?![a-z])`).test(text);
  }
  return text.includes(folded);
}

/** The first banned term in `texts`, or `null`. `deepAllowed` frees the «أدق / more accurate» pair. */
export function findBannedClaim(
  texts: readonly string[],
  banned: readonly string[],
  deepAllowed: boolean,
): string | null {
  const exempt = new Set(DEEP_CLAIM_TERMS.map(fold));
  for (const raw of texts) {
    const text = fold(raw);
    for (const term of banned) {
      if (deepAllowed && exempt.has(fold(term))) continue;
      if (containsTerm(text, term)) return term;
    }
  }
  return null;
}

/** Every string of an entry's copy, for linting. */
export function promptTexts(entry: Pick<PromptEntry, "copy">): string[] {
  return Object.values(entry.copy).flatMap((copy) =>
    [copy.title, copy.body, copy.cta, copy.secondary, copy.close].filter(
      (text): text is string => text !== undefined && text !== "",
    ),
  );
}

/** Fills `{name}`; a name with no value stays visible so a typo is seen in the preview. */
export function renderPromptText(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}

/** The placeholders an admin may use (the editor lists them). */
export const PROMPT_PLACEHOLDERS = [
  "plan",
  "price",
  "analyses",
  "renewDate",
  "deepLine",
  "count",
  "used",
  "total",
  "left",
  "credits",
  "days",
  "date",
  "members",
  "featureLine",
] as const;

const text = (key: keyof typeof ar, locale: "ar" | "en"): string =>
  (locale === "ar" ? ar : en)[key] as string;

/** Today's inline copy (the dictionary strings) wrapped as a catalog entry. */
function legacy(
  messageKey: keyof typeof ar,
  cta: { ar: string; en: string },
  href: string | null,
  extra: Partial<PromptEntryInput> = {},
): PromptEntryInput {
  const close = { ar: text("growth.cta.dismiss", "ar"), en: text("growth.cta.dismiss", "en") };
  return {
    enabled: true,
    form: "inline",
    copy: {
      ar: { title: "", body: text(messageKey, "ar"), cta: cta.ar, close: close.ar },
      en: { title: "", body: text(messageKey, "en"), cta: cta.en, close: close.en },
    },
    targetPlan: null,
    cta: { href },
    cooldownDays: null,
    ...extra,
  };
}

const ctaText = (key: keyof typeof ar) => ({ ar: text(key, "ar"), en: text(key, "en") });

/**
 * The defaults reproduce today's behaviour (inline cards with today's copy) except the two modal
 * moments, whose copy is the reviewed 4.1 text. `locked_feature` takes its sentence per feature from
 * the `{featureLine}` the server fills.
 */
export const DEFAULT_PROMPT_CATALOG: Record<GrowthPromptKind, PromptEntryInput> = {
  analysis_taste: legacy("growth.prompt.analysis_taste.a", ctaText("growth.cta.taste"), null),
  credits_low: legacy("growth.prompt.credits_low.a", ctaText("growth.cta.pricing"), "/pricing"),
  credits_out: {
    enabled: true,
    form: "modal",
    copy: {
      ar: {
        title: "رصيدك خلص",
        body: "هيتجدد مجانًا يوم {renewDate}، أو كمّل دلوقتي مع باقة {plan}: {analyses} روشتة في الشهر بـ {price}.",
        cta: "شوف الباقات",
        secondary: "اشتري رصيد إضافي",
        close: "مش دلوقتي",
      },
      en: {
        title: "You are out of credits",
        body: "Your free credits renew on {renewDate}, or carry on now with {plan}: {analyses} prescription readings a month for {price}.",
        cta: "See the plans",
        secondary: "Buy extra credits",
        close: "Not now",
      },
    },
    targetPlan: null,
    cta: { href: "/pricing" },
    secondaryHref: "/billing#packs",
    cooldownDays: null,
  },
  locked_feature: legacy("growth.prompt.locked_feature.deep.a", ctaText("growth.cta.pricing"), "/pricing", {
    copy: {
      ar: {
        title: "",
        body: "{featureLine}",
        cta: text("growth.cta.pricing", "ar"),
        close: text("growth.cta.dismiss", "ar"),
      },
      en: {
        title: "",
        body: "{featureLine}",
        cta: text("growth.cta.pricing", "en"),
        close: text("growth.cta.dismiss", "en"),
      },
    },
  }),
  org_usage: legacy("growth.prompt.org_usage.a", ctaText("growth.cta.pricing"), "/pricing?org={orgId}"),
  expiring_free_credits: legacy(
    "growth.prompt.expiring_free_credits.a",
    ctaText("growth.cta.analyze"),
    "/analyze",
  ),
  plan_expiring: legacy("growth.prompt.plan_expiring.a", ctaText("growth.cta.renew"), "/billing/renew?sub={subId}"),
  trial_ended: {
    enabled: true,
    form: "modal",
    copy: {
      ar: {
        title: "خلصت تجربتك المجانية",
        body: "جرّبت وصفة وشفت النتيجة بنفسك. مع باقة {plan} تقدر تحلل {analyses} روشتة في الشهر{deepLine} بـ {price} بس.",
        cta: "اشترك في {plan}",
        close: "مش دلوقتي",
      },
      en: {
        title: "Your free trial is over",
        body: "You have seen what Wasfa does. With {plan} you get {analyses} prescription readings a month{deepLine} for {price}.",
        cta: "Subscribe to {plan}",
        close: "Not now",
      },
    },
    targetPlan: null,
    cta: { href: "/pricing" },
    cooldownDays: null,
  },
};

/** What `{deepLine}` says when the target plan has deep mode (empty otherwise). */
export const DEEP_LINE = {
  ar: "، وتفتح وضع التحليل العميق",
  en: ", and unlock deep analysis mode",
} as const;

const catalogSchemaBase = z.partialRecord(z.enum(GROWTH_PROMPT_KINDS), promptEntrySchema);

/** The stored catalog: any subset of kinds (a missing kind uses its default); modals only on calm moments. */
export const promptCatalogSchema = catalogSchemaBase.superRefine((catalog, ctx) => {
  for (const kind of GROWTH_PROMPT_KINDS) {
    const entry = catalog[kind];
    if (entry?.form === "modal" && !modalAllowed(kind)) {
      ctx.addIssue({
        code: "custom",
        path: [kind, "form"],
        message: "modal_not_allowed",
      });
    }
  }
});

/** The stored entry over its default, parsed (a stored value always has a complete default behind it). */
export function resolvePromptEntry(
  catalog: Partial<Record<GrowthPromptKind, PromptEntry>>,
  kind: GrowthPromptKind,
): PromptEntry {
  return catalog[kind] ?? promptEntrySchema.parse(DEFAULT_PROMPT_CATALOG[kind]);
}

/** The whole catalog with defaults filled in. */
export function resolvePromptCatalog(
  catalog: Partial<Record<GrowthPromptKind, PromptEntry>>,
): Record<GrowthPromptKind, PromptEntry> {
  return Object.fromEntries(
    GROWTH_PROMPT_KINDS.map((kind) => [kind, resolvePromptEntry(catalog, kind)]),
  ) as Record<GrowthPromptKind, PromptEntry>;
}
