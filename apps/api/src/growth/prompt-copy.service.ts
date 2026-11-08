import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  DEEP_LINE,
  findBannedClaim,
  promptTexts,
  renderPromptText,
  resolvePromptCatalog,
} from "@wasfa/shared/growth-prompts";
import { LOCALES } from "@wasfa/shared/i18n";
import { formatMoney } from "@wasfa/shared/money";

import { CatalogService } from "../catalog/catalog.service.js";
import { SettingsService } from "../settings/settings.service.js";

import { GrowthRepo } from "./growth.repo.js";

import type { PromptEntry } from "@wasfa/shared/growth-prompts";
import type { Locale } from "@wasfa/shared/i18n";
import type { RenderedPromptCopy } from "@wasfa/shared/schemas/growth";
import type { SettingValue } from "@wasfa/shared/settings";

/** What the placeholders `{plan} {price} {analyses} {deepLine}` are filled from. */
export interface PlanFacts {
  key: string;
  name: { ar: string; en: string };
  priceMinor: number;
  currency: string;
  /** Monthly credits divided by the credits one page costs: one-page readings a month. */
  analyses: number;
  deepMode: boolean;
}

export type PromptContent = Record<Locale, RenderedPromptCopy>;

/** Values that differ per locale (the locked feature's sentence). */
export type LocalizedValues = Record<string, Record<Locale, string>>;

export interface RenderInput {
  entry: PromptEntry;
  plan: PlanFacts | null;
  /** The user's next free renewal date. */
  renewAt: Date;
  /** Plain values of the moment (counts, days, ids), taking precedence over the plan values. */
  params?: Readonly<Record<string, string | number>>;
  localized?: LocalizedValues;
}

const UNFILLED = /\{\w+\}/;

function renewDateText(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(date);
}

/**
 * Turns a catalog entry into the strings a person reads: plan name, price, monthly analyses and
 * dates come from the plans data at request time (a price change reaches every prompt), and the
 * admin save refuses copy with a banned claim. Nothing here is stored.
 */
@Injectable()
export class PromptCopyService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly settings: SettingsService,
    private readonly repo: GrowthRepo,
  ) {}

  /** The plans a prompt may name: on sale to individuals, with their one-month price. */
  private async offered(now: Date) {
    const currency = (await this.settings.get("currency")).default;
    const catalog = await this.catalog.catalog({ currency, country: null }, now);
    const rows = catalog.plans
      .filter((plan) => plan.audience !== "organization")
      .flatMap((plan) => {
        const monthly = plan.prices.find((price) => price.months === 1);
        return monthly ? [{ plan, price: monthly.display.headlineMinor }] : [];
      });
    return { currency, rows };
  }

  /** For the admin's target-plan select. */
  async offeredPlans(now = new Date()): Promise<{ key: string; name: { ar: string; en: string } }[]> {
    return (await this.offered(now)).rows.map(({ plan }) => ({ key: plan.key, name: plan.names }));
  }

  /**
   * The plan a prompt names: its `targetPlan` when that plan is on sale to individuals, else the
   * recommended one (a pinned plan, else the cheapest). `null` when no plan is on sale.
   */
  async planFacts(targetPlan: string | null, now = new Date()): Promise<PlanFacts | null> {
    const { currency, rows: offered } = await this.offered(now);
    const target = targetPlan === null ? undefined : offered.find((row) => row.plan.key === targetPlan);
    const chosen =
      target ??
      offered.find((row) => row.plan.pinRecommended) ??
      [...offered].sort((a, b) => a.price - b.price)[0];
    if (!chosen) return null;
    const rx = await this.settings.get("rx");
    return {
      key: chosen.plan.key,
      name: chosen.plan.names,
      priceMinor: chosen.price,
      currency,
      analyses: Math.floor(chosen.plan.monthlyCredits / Math.max(1, rx.creditsPerPage)),
      deepMode: await this.repo.planHasDeep(chosen.plan.key),
    };
  }

  /** Whether the copy names a plan value, so the plan lookup is worth making. */
  usesPlan(entry: PromptEntry): boolean {
    return promptTexts(entry).some((text) => /\{(plan|price|analyses|deepLine)\}/.test(text));
  }

  /** The entry's copy for both locales with every known placeholder filled. */
  render(input: RenderInput): PromptContent {
    const { entry, plan, renewAt, params = {}, localized = {} } = input;
    const content = {} as PromptContent;
    for (const locale of LOCALES) {
      const values: Record<string, string | number> = {
        renewDate: renewDateText(renewAt, locale),
        ...(plan
          ? {
              plan: plan.name[locale],
              price: formatMoney(plan.priceMinor, plan.currency, locale),
              analyses: plan.analyses,
              deepLine: plan.deepMode ? DEEP_LINE[locale] : "",
            }
          : {}),
        ...params,
        ...Object.fromEntries(Object.entries(localized).map(([name, byLocale]) => [name, byLocale[locale]])),
      };
      const copy = entry.copy[locale];
      content[locale] = {
        title: renderPromptText(copy.title, values),
        body: renderPromptText(copy.body, values),
        cta: renderPromptText(copy.cta, values),
        ...(copy.secondary !== undefined
          ? { secondary: renderPromptText(copy.secondary, values) }
          : {}),
        close: renderPromptText(copy.close, values),
      };
    }
    return content;
  }

  /** True when a `{placeholder}` is still in the text: a person must never read a template. */
  isComplete(content: PromptContent): boolean {
    return LOCALES.every((locale) =>
      Object.values(content[locale]).every((text) => text === undefined || !UNFILLED.test(text)),
    );
  }

  /**
   * Refuses banned claims in every catalog entry: the terms that are never allowed (also checked by
   * the settings schema) and the deep-mode pair «أدق / more accurate», allowed only when the entry's
   * target plan really has the deep-mode entitlement. Typed error naming the term.
   */
  async assertCleanCopy(growth: SettingValue<"growth">, now = new Date()): Promise<void> {
    const catalog = resolvePromptCatalog(growth.prompts.catalog);
    for (const [key, entry] of Object.entries(catalog)) {
      const stored = growth.prompts.catalog[key as keyof typeof catalog];
      if (stored === undefined) continue;
      const texts = promptTexts(entry);
      const refuse = (term: string) =>
        new AppError(ErrorCode.VALIDATION_FAILED, { details: { reason: "banned_claim", key, term } });
      // Terms that are never allowed decide without a lookup; the plan is read only for the deep pair.
      const never = findBannedClaim(texts, growth.bannedClaims, true);
      if (never !== null) throw refuse(never);
      const needsDeep = findBannedClaim(texts, growth.bannedClaims, false);
      if (needsDeep !== null && !(await this.planFacts(entry.targetPlan, now))?.deepMode) {
        throw refuse(needsDeep);
      }
    }
  }
}
