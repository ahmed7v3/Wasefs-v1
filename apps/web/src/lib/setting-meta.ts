import type { MessageKey } from "@wasfa/shared/i18n";
import type { SettingKey } from "@wasfa/shared/settings";

/*
 * How the admin presents the settings registry: which page each key lives on, how a key's fields
 * are grouped into sections, and the unit of every number. Presentation only: the stored values,
 * the schemas and the API stay exactly as they are (`settingFields` still reads the schema, so a
 * field added to a schema shows up, in a trailing "more" section, without touching this file).
 *
 * Labels and help live in the dictionaries under `admin.settings.field.<key>.<path>` and
 * `admin.settings.help.<key>.<path>`.
 */

/**
 * The unit of a number field. `bps` and `minor` are edited in friendly units (percent, pounds) and
 * stored unchanged (basis points, piasters): the form multiplies by `scale` on save.
 */
export type SettingUnit =
  | "bps"
  | "minor"
  | "minutes"
  | "hours"
  | "days"
  | "months"
  | "points"
  | "credits"
  | "egpPerUsd"
  | "hourOfDay"
  | "perHour"
  | "perWeek"
  | "perDay";

/** Stored value = typed value × scale. */
export const UNIT_SCALE: Partial<Record<SettingUnit, number>> = { bps: 100, minor: 100 };

/** Units per `key.path`. A number without an entry is shown as a plain number. */
export const SETTING_UNITS: Record<string, SettingUnit> = {
  "rx.creditsPerPage": "credits",
  "uploads.retentionDays": "days",

  "billing.minChargeMinor": "minor",
  "billing.quoteTtlMinutes": "minutes",
  "billing.orderTtlHours": "hours",
  "billing.graceDays": "days",
  "billing.refundWindowDays": "days",
  "billing.maxTotalDiscountBps": "bps",
  "billing.fourEyesThresholdMinor": "minor",
  "billing.adminPlanChangeFreshAuthMinor": "minor",
  "billing.reviewSlaMinutes": "minutes",
  "billing.failureSpike.windowMinutes": "minutes",
  "billing.failureSpike.rateBps": "bps",
  "billing.failureSpike.cooldownMinutes": "minutes",
  "billing.proofRetentionDays": "days",
  "billing.fx.usdToEgp": "egpPerUsd",
  "billing.creditPackValidMonths": "months",
  "billing.trial.credits": "credits",

  "content.maxPublishesPerDay": "perDay",
  "content.previewTokenHours": "hours",
  "content.reviewIntervalDays.general": "days",
  "content.reviewIntervalDays.highRisk": "days",

  "rewards.pointValueMinor": "minor",
  "rewards.minWithdrawalPoints": "points",
  "rewards.maxWithdrawalPointsPerMonth": "points",
  "rewards.minAccountAgeDays": "days",
  "rewards.destinationCooldownHours": "hours",
  "rewards.holdDaysDefault": "days",
  "rewards.fourEyesThresholdPoints": "points",
  "rewards.pointsPerCredit": "points",
  "rewards.creditConversionBonusBps": "bps",
  "rewards.weeklyBudgetPoints": "points",
  "rewards.expireAfterMonths": "months",
  "rewards.fraud.velocityPerHour": "perHour",
  "rewards.payoutSlaHours": "hours",
  "rewards.refereeFirstPaymentDiscountBps": "bps",
  "rewards.refereeCouponValidDays": "days",

  "growth.prompts.cooldownDays": "days",
  "growth.prompts.maxCooldownDays": "days",
  "growth.taste.weeklyCap": "perWeek",
  "growth.taste.perUserPerWeek": "perWeek",
  "growth.taste.weeklyBudgetCredits": "credits",
  "growth.value.minutesSavedPerAnalysis": "minutes",
  "growth.marketingMail.maxPerWeek": "perWeek",
  "growth.marketingMail.quietHoursAfterSignup": "hours",
  "growth.experiments.guardrailBps": "bps",
  "growth.welcomeOffer.validityHours": "hours",
  "growth.winback.validityDays": "days",

  "alerts.whatsapp.dailyCap": "perDay",
  "alerts.businessHours.startHour": "hourOfDay",
  "alerts.businessHours.endHour": "hourOfDay",
};

/** A titled block of one key's fields (top-level paths, in display order). */
export interface SettingSection {
  id: string;
  title: MessageKey;
  description: MessageKey;
  paths: readonly string[];
}

/**
 * Sections of the keys with many fields. A section listing a single group shows that group's
 * fields directly (the section title replaces the group legend). Keys without an entry render as
 * one block.
 */
export const SETTING_LAYOUTS: Partial<Record<SettingKey, readonly SettingSection[]>> = {
  billing: [
    {
      id: "checkout",
      title: "admin.settings.section.billing.checkout",
      description: "admin.settings.section.billing.checkout.description",
      paths: [
        "allowFreeOrders",
        "minChargeMinor",
        "minChargeMode",
        "maxTotalDiscountBps",
        "quoteTtlMinutes",
        "orderTtlHours",
      ],
    },
    {
      id: "subscriptions",
      title: "admin.settings.section.billing.subscriptions",
      description: "admin.settings.section.billing.subscriptions.description",
      paths: ["graceDays", "refundWindowDays", "trial", "creditPackValidMonths"],
    },
    {
      id: "review",
      title: "admin.settings.section.billing.review",
      description: "admin.settings.section.billing.review.description",
      paths: [
        "fourEyesThresholdMinor",
        "reviewSlaMinutes",
        "proofRetentionDays",
        "adminPlanChangeFreshAuthMinor",
      ],
    },
    {
      id: "failureSpike",
      title: "admin.settings.section.billing.failureSpike",
      description: "admin.settings.section.billing.failureSpike.description",
      paths: ["failureSpike"],
    },
    {
      id: "company",
      title: "admin.settings.section.billing.company",
      description: "admin.settings.section.billing.company.description",
      paths: ["company"],
    },
    {
      id: "fx",
      title: "admin.settings.section.billing.fx",
      description: "admin.settings.section.billing.fx.description",
      paths: ["fx"],
    },
  ],
  rewards: [
    {
      id: "status",
      title: "admin.settings.section.rewards.status",
      description: "admin.settings.section.rewards.status.description",
      paths: ["enabled", "killSwitch", "cashOutEnabled", "tiersEnabled"],
    },
    {
      id: "value",
      title: "admin.settings.section.rewards.value",
      description: "admin.settings.section.rewards.value.description",
      paths: [
        "pointValueMinor",
        "currency",
        "pointsPerCredit",
        "creditConversionBonusBps",
        "expireAfterMonths",
      ],
    },
    {
      id: "earning",
      title: "admin.settings.section.rewards.earning",
      description: "admin.settings.section.rewards.earning.description",
      paths: [
        "holdDaysDefault",
        "requireFirstUsage",
        "weeklyBudgetPoints",
        "refereeFirstPaymentDiscountBps",
        "refereeCouponValidDays",
      ],
    },
    {
      id: "withdrawals",
      title: "admin.settings.section.rewards.withdrawals",
      description: "admin.settings.section.rewards.withdrawals.description",
      paths: [
        "minWithdrawalPoints",
        "maxWithdrawalPointsPerMonth",
        "minAccountAgeDays",
        "destinationCooldownHours",
        "fourEyesThresholdPoints",
        "payoutSlaHours",
      ],
    },
    {
      id: "fraud",
      title: "admin.settings.section.rewards.fraud",
      description: "admin.settings.section.rewards.fraud.description",
      paths: ["fraud"],
    },
  ],
  growth: [
    {
      id: "master",
      title: "admin.settings.section.growth.master",
      description: "admin.settings.section.growth.master.description",
      paths: ["killSwitch"],
    },
    {
      id: "prompts",
      title: "admin.settings.section.growth.prompts",
      description: "admin.settings.section.growth.prompts.description",
      paths: ["prompts"],
    },
    {
      id: "taste",
      title: "admin.settings.section.growth.taste",
      description: "admin.settings.section.growth.taste.description",
      paths: ["taste"],
    },
    {
      id: "offers",
      title: "admin.settings.section.growth.offers",
      description: "admin.settings.section.growth.offers.description",
      paths: ["welcomeOffer", "winback"],
    },
    {
      id: "mail",
      title: "admin.settings.section.growth.mail",
      description: "admin.settings.section.growth.mail.description",
      paths: ["lifecycle", "marketingMail"],
    },
    {
      id: "proof",
      title: "admin.settings.section.growth.proof",
      description: "admin.settings.section.growth.proof.description",
      paths: ["proof", "mostChosen", "value"],
    },
    {
      id: "experiments",
      title: "admin.settings.section.growth.experiments",
      description: "admin.settings.section.growth.experiments.description",
      paths: ["experiments"],
    },
  ],
  seo: [
    {
      id: "snippets",
      title: "admin.settings.section.seo.snippets",
      description: "admin.settings.section.seo.snippets.description",
      paths: ["titleTemplate", "defaultDescription", "defaultOgImage"],
    },
    {
      id: "verification",
      title: "admin.settings.section.seo.verification",
      description: "admin.settings.section.seo.verification.description",
      paths: ["verification"],
    },
    {
      id: "aiCrawlers",
      title: "admin.settings.section.seo.aiCrawlers",
      description: "admin.settings.section.seo.aiCrawlers.description",
      paths: ["aiCrawlers"],
    },
    {
      id: "indexNow",
      title: "admin.settings.section.seo.indexNow",
      description: "admin.settings.section.seo.indexNow.description",
      paths: ["indexNow"],
    },
    {
      id: "llms",
      title: "admin.settings.section.seo.llms",
      description: "admin.settings.section.seo.llms.description",
      paths: ["llmsTxt"],
    },
    {
      id: "reports",
      title: "admin.settings.section.seo.reports",
      description: "admin.settings.section.seo.reports.description",
      paths: ["brandRegex", "aiReferrerHosts"],
    },
  ],
  content: [
    {
      id: "publishing",
      title: "admin.settings.section.content.publishing",
      description: "admin.settings.section.content.publishing.description",
      paths: ["maxPublishesPerDay", "timeZone", "previewTokenHours"],
    },
    {
      id: "quality",
      title: "admin.settings.section.content.quality",
      description: "admin.settings.section.content.quality.description",
      paths: [
        "minWords",
        "duplicate",
        "titleSimilarityBlockAt",
        "forbiddenPhrases",
        "featuredMinWidth",
      ],
    },
    {
      id: "links",
      title: "admin.settings.section.content.links",
      description: "admin.settings.section.content.links.description",
      paths: ["autoLink", "dofollowDomains"],
    },
    {
      id: "review",
      title: "admin.settings.section.content.review",
      description: "admin.settings.section.content.review.description",
      paths: ["defaultAuthorId", "reviewIntervalDays", "autoTranslateDrafts"],
    },
  ],
  landing: [
    {
      id: "proof",
      title: "admin.settings.section.landing.proof",
      description: "admin.settings.section.landing.proof.description",
      paths: ["proof"],
    },
    {
      id: "apps",
      title: "admin.settings.section.landing.apps",
      description: "admin.settings.section.landing.apps.description",
      paths: ["apps"],
    },
  ],
  alerts: [
    {
      id: "whatsapp",
      title: "admin.settings.section.alerts.whatsapp",
      description: "admin.settings.section.alerts.whatsapp.description",
      paths: ["whatsapp"],
    },
    {
      id: "businessHours",
      title: "admin.settings.section.alerts.businessHours",
      description: "admin.settings.section.alerts.businessHours.description",
      paths: ["businessHours"],
    },
  ],
};

/** A titled group of whole keys on a settings page. */
export interface SettingsPageGroup {
  id: string;
  title: MessageKey;
  description: MessageKey;
  keys: readonly SettingKey[];
}

/**
 * The general settings page (`/admin/settings`). The other keys live with their feature:
 * `branding` on /admin/branding, `whatsapp` on /admin/whatsapp, `waAgent` on /admin/whatsapp/agent, `billing` on
 * /admin/billing/settings, `rewards` and `growth` on /admin/growth/settings, `alerts` on
 * /admin/alerts, `ai` and `skills` under /admin/ai.
 */
export const GENERAL_SETTINGS_GROUPS: readonly SettingsPageGroup[] = [
  {
    id: "access",
    title: "admin.settings.group.access",
    description: "admin.settings.group.access.description",
    keys: ["access", "auth"],
  },
  {
    id: "contact",
    title: "admin.settings.group.contact",
    description: "admin.settings.group.contact.description",
    keys: ["contact", "socials"],
  },
  {
    id: "locale",
    title: "admin.settings.group.locale",
    description: "admin.settings.group.locale.description",
    keys: ["locale", "currency"],
  },
  {
    id: "analysis",
    title: "admin.settings.group.analysis",
    description: "admin.settings.group.analysis.description",
    keys: ["free_tier", "rx", "uploads"],
  },
  {
    id: "homepage",
    title: "admin.settings.group.homepage",
    description: "admin.settings.group.homepage.description",
    keys: ["landing"],
  },
  {
    id: "seo",
    title: "admin.settings.group.seo",
    description: "admin.settings.group.seo.description",
    keys: ["seo"],
  },
  {
    id: "content",
    title: "admin.settings.group.content",
    description: "admin.settings.group.content.description",
    keys: ["content"],
  },
];
