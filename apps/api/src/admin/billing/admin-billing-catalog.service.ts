import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { planMargin, type PlanMargin } from "@wasfa/shared/margin";

import { SettingsService } from "../../settings/settings.service.js";

import { AdminBillingCatalogRepo, type MethodPatch } from "./admin-billing-catalog.repo.js";
import { maskTail } from "./admin-billing-console.mask.js";

import type { AuditScope } from "../../audit/audited.decorator.js";
import type {
  CreditPackCreate,
  CreditPackPatch,
  CreditPackPriceCell,
  PaymentMethodPatch,
  PlanPriceCell,
  TaxRuleCreate,
  TaxRulePatch,
} from "@wasfa/shared/schemas/admin-billing-console";

const DAY_MS = 86_400_000;

type PriceRow = { months: number; currency: string; amountMinor: number; active: boolean };

/** The key of one cell of the price grid. */
const cellKey = (cell: { months: number; currency: string }) => `${cell.months}:${cell.currency}`;

/** What the customer pays now: an inactive cell is "not offered", shown as null. */
const effective = (row: { amountMinor: number; active: boolean }) =>
  row.active ? row.amountMinor : null;

/** Only the keys the patch touches, so `before`/`after` in the audit list exactly what changed. */
function changedFields(row: object, keys: readonly string[]): Record<string, unknown> {
  const values = row as Record<string, unknown>;
  return Object.fromEntries(keys.map((key) => [key, values[key]]));
}

@Injectable()
export class AdminBillingCatalogService {
  constructor(
    private readonly repo: AdminBillingCatalogRepo,
    private readonly settings: SettingsService,
  ) {}

  // --- Plans and prices --------------------------------------------------------------------------

  async plans() {
    const [rows, marginInputs] = await Promise.all([this.repo.plans(), this.marginInputs()]);
    return {
      items: rows.map(({ plan, prices, activeSubscribers }) => ({
        id: plan.id,
        key: plan.key,
        nameAr: plan.nameAr,
        nameEn: plan.nameEn,
        audience: plan.audience,
        isDefault: plan.isDefault,
        monthlyCredits: plan.monthlyCredits,
        visibility: plan.visibility,
        sort: plan.sort,
        badgeAr: plan.badgeAr,
        badgeEn: plan.badgeEn,
        taglineAr: plan.taglineAr,
        taglineEn: plan.taglineEn,
        features: plan.features,
        trialDays: plan.trialDays,
        pinRecommended: plan.pinRecommended,
        maxMembers: plan.maxMembers,
        fairUseNoteAr: plan.fairUseNoteAr,
        fairUseNoteEn: plan.fairUseNoteEn,
        prices: prices.map((price) => ({
          months: price.months,
          currency: price.currency,
          amountMinor: effective(price),
          active: price.active,
        })),
        activeSubscribers,
        marginInputs,
      })),
    };
  }

  /**
   * What publishing `cells` would change. A cell sent with a null amount switches an offered price
   * off ("removed"); cells that are not sent are left alone.
   */
  async previewPlanPrices(planId: string, cells: readonly PlanPriceCell[]) {
    const plan = await this.repo.findPlan(planId);
    if (!plan) throw new AppError(ErrorCode.NOT_FOUND);
    const [current, activeSubscribers, marginInputs, assumptions] = await Promise.all([
      this.repo.planPrices(planId),
      this.repo.activeSubscribers(planId),
      this.marginInputs(),
      this.repo.marginAssumptions(),
    ]);
    const existing = new Map<string, PriceRow>(current.map((row) => [cellKey(row), row]));

    const added: Array<{ months: number; currency: string; amountMinor: number | null }> = [];
    const changed: Array<{
      months: number;
      currency: string;
      from: number | null;
      to: number | null;
    }> = [];
    const removed: Array<{ months: number; currency: string; amountMinor: number }> = [];
    for (const cell of cells) {
      const old = existing.get(cellKey(cell));
      if (!old) {
        if (cell.amountMinor !== null) added.push(cell);
        continue;
      }
      const from = effective(old);
      if (from === cell.amountMinor) continue;
      if (cell.amountMinor === null) {
        removed.push({
          months: cell.months,
          currency: cell.currency,
          amountMinor: old.amountMinor,
        });
      } else {
        changed.push({ months: cell.months, currency: cell.currency, from, to: cell.amountMinor });
      }
    }

    const margin = cells.map((cell) => ({
      months: cell.months,
      currency: cell.currency,
      amountMinor: cell.amountMinor,
      margin:
        cell.amountMinor === null
          ? null
          : planMargin({
              amountMinor: cell.amountMinor,
              months: cell.months,
              currency: cell.currency,
              monthlyCredits: plan.monthlyCredits,
              costPerCreditUsdMicros: marginInputs.costPerCreditUsdMicros,
              fxUsdToEgp: marginInputs.fxUsdToEgp,
              taxMode: assumptions.tax?.mode ?? null,
              taxRateBps: assumptions.tax?.rateBps ?? 0,
              feeBps: assumptions.feeBps,
            }),
    }));
    return {
      diff: { added, changed, removed },
      // They keep their price until renewal; the number is what the admin is about to affect later.
      activeSubscribers,
      margin,
      marginInputs,
    };
  }

  async publishPlanPrices(
    planId: string,
    cells: readonly PlanPriceCell[],
    input: { reason: string; overrideMargin: boolean },
    audit: AuditScope,
  ) {
    const preview = await this.previewPlanPrices(planId, cells);
    // BILLING §2.3: a new or changed price that loses money needs an explicit override.
    const touched = new Set([...preview.diff.added, ...preview.diff.changed].map(cellKey));
    const negativeMargin = preview.margin.filter(
      (row): row is typeof row & { margin: PlanMargin } =>
        touched.has(cellKey(row)) && row.margin !== null && row.margin.marginFullMinor < 0,
    );
    if (negativeMargin.length > 0 && !input.overrideMargin) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, {
        details: { fields: ["prices"], negativeMargin: negativeMargin.map(cellKey) },
      });
    }
    await this.repo.publishPlanPrices(planId, cells);
    audit.targetId = planId;
    audit.after = {
      diff: preview.diff,
      overrideMargin: input.overrideMargin,
      negativeMarginCells: negativeMargin.length,
      reason: input.reason,
    };
    return { published: true as const, ...preview };
  }

  /**
   * Cost of one credit for the margin screen: what the provider charged over the last 30 days per
   * credit charged, or the configured credit value when there was no usage to learn from.
   */
  private async marginInputs() {
    const [billing, ai, usage] = await Promise.all([
      this.settings.get("billing"),
      this.settings.get("ai"),
      this.repo.aiCostSince(new Date(Date.now() - 30 * DAY_MS)),
    ]);
    const measured = usage.credits > 0;
    return {
      costPerCreditUsdMicros: measured
        ? Math.floor(usage.cost / usage.credits)
        : ai.creditValueUsdMicros,
      source: measured ? ("ai_usage_30d" as const) : ("credit_value_setting" as const),
      fxUsdToEgp: billing.fx.usdToEgp,
    };
  }

  // --- Credit packs ------------------------------------------------------------------------------

  async creditPacks() {
    return {
      items: (await this.repo.creditPacks()).map(({ pack, prices }) => this.packView(pack, prices)),
    };
  }

  async createCreditPack(input: CreditPackCreate, audit: AuditScope) {
    const pack = await this.repo.createCreditPack(input);
    if (!pack) throw new AppError(ErrorCode.CONFLICT, { details: { reason: "key_taken" } });
    audit.targetId = pack.id;
    audit.after = changedFields(pack, [
      "key",
      "credits",
      "bonusCredits",
      "validMonths",
      "active",
      "sort",
    ]);
    return this.packView(pack, []);
  }

  async updateCreditPack(id: string, patch: CreditPackPatch, audit: AuditScope) {
    const before = await this.repo.creditPack(id);
    if (!before) throw new AppError(ErrorCode.NOT_FOUND);
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ) as Parameters<AdminBillingCatalogRepo["updateCreditPack"]>[1];
    const pack = await this.repo.updateCreditPack(id, clean);
    if (!pack) throw new AppError(ErrorCode.NOT_FOUND);
    const keys = Object.keys(patch);
    audit.targetId = id;
    audit.before = changedFields(before.pack, keys);
    audit.after = changedFields(pack, keys);
    return this.packView(pack, before.prices);
  }

  async setCreditPackPrices(
    id: string,
    cells: readonly CreditPackPriceCell[],
    reason: string,
    audit: AuditScope,
  ) {
    const before = await this.repo.creditPack(id);
    if (!before) throw new AppError(ErrorCode.NOT_FOUND);
    await this.repo.setCreditPackPrices(id, cells);
    const after = await this.repo.creditPack(id);
    if (!after) throw new AppError(ErrorCode.NOT_FOUND);
    const grid = (prices: typeof before.prices) =>
      prices.map((price) => ({ currency: price.currency, amountMinor: effective(price) }));
    audit.targetId = id;
    audit.before = { prices: grid(before.prices) };
    audit.after = { prices: grid(after.prices), reason };
    return this.packView(after.pack, after.prices);
  }

  private packView(
    pack: Awaited<ReturnType<AdminBillingCatalogRepo["creditPacks"]>>[number]["pack"],
    prices: Array<{ currency: string; amountMinor: number; active: boolean }>,
  ) {
    return {
      id: pack.id,
      key: pack.key,
      nameAr: pack.nameAr,
      nameEn: pack.nameEn,
      credits: pack.credits,
      bonusCredits: pack.bonusCredits,
      validMonths: pack.validMonths,
      active: pack.active,
      sort: pack.sort,
      prices: prices.map((price) => ({
        currency: price.currency,
        amountMinor: effective(price),
      })),
    };
  }

  // --- Payment methods ---------------------------------------------------------------------------

  async methods() {
    return { items: (await this.repo.methods()).map((row) => this.methodView(row)) };
  }

  async updateMethod(key: string, input: PaymentMethodPatch, audit: AuditScope) {
    const { reason, ...patch } = input;
    // Strip `undefined` keys: only what the admin sent is written (and audited).
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ) as MethodPatch;
    const result = await this.repo.updateMethod(key, clean);
    switch (result.outcome) {
      case "not_found":
        throw new AppError(ErrorCode.NOT_FOUND);
      case "invalid_range":
        throw new AppError(ErrorCode.VALIDATION_FAILED, {
          details: { fields: ["maxAmountMinor"] },
        });
      case "gateway_unverified":
        throw new AppError(ErrorCode.CONFLICT, { details: { reason: "gateway_unverified" } });
      case "updated": {
        const keys = Object.keys(clean);
        audit.targetId = key;
        audit.before = changedFields(result.before, keys);
        audit.after = { ...changedFields(result.after, keys), reason };
        const view = await this.repo.method(key);
        if (!view) throw new AppError(ErrorCode.NOT_FOUND);
        return this.methodView(view);
      }
    }
  }

  private methodView({
    method,
    gateway,
    pending,
  }: Awaited<ReturnType<AdminBillingCatalogRepo["methods"]>>[number]) {
    return {
      key: method.key,
      kind: method.kind,
      provider: method.provider,
      nameAr: method.nameAr,
      nameEn: method.nameEn,
      instructionsAr: method.instructionsAr,
      instructionsEn: method.instructionsEn,
      // The number customers pay into is shown to the last three digits only.
      accountDisplay: maskTail(method.accountDisplay, 3),
      pendingAccountChange: pending
        ? { id: pending.id, effectiveAt: pending.effectiveAt.toISOString() }
        : null,
      feeBps: method.feeBps,
      feeFixedMinor: method.feeFixedMinor,
      minAmountMinor: method.minAmountMinor,
      maxAmountMinor: method.maxAmountMinor,
      currencies: method.currencies,
      countries: method.countries,
      requiresProof: method.requiresProof,
      reviewSlaMinutes: method.reviewSlaMinutes,
      enabled: method.enabled,
      sort: method.sort,
      gateway: gateway ? { enabled: gateway.enabled, verified: gateway.verifiedAt !== null } : null,
    };
  }

  // --- Tax rules ---------------------------------------------------------------------------------

  async taxRules() {
    return (await this.repo.taxRules()).map((rule) => this.taxRuleView(rule));
  }

  async createTaxRule(input: TaxRuleCreate, audit: AuditScope) {
    const { reason, replaceActive, ...rule } = input;
    const result = await this.repo.createTaxRule(rule, replaceActive === true);
    if (result.outcome === "active_exists") {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "active_tax_rule_exists" } });
    }
    audit.targetId = result.rule.id;
    audit.after = {
      ...this.taxRuleView(result.rule),
      replaceActive: replaceActive === true,
      reason,
    };
    return this.taxRuleView(result.rule);
  }

  async updateTaxRule(id: string, input: TaxRulePatch, audit: AuditScope) {
    const { reason, replaceActive, ...patch } = input;
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ) as Parameters<AdminBillingCatalogRepo["updateTaxRule"]>[1];
    const result = await this.repo.updateTaxRule(id, clean, replaceActive === true);
    if (result.outcome === "not_found") throw new AppError(ErrorCode.NOT_FOUND);
    if (result.outcome === "active_exists") {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "active_tax_rule_exists" } });
    }
    const keys = Object.keys(clean);
    audit.targetId = id;
    audit.before = changedFields(result.before, keys);
    audit.after = {
      ...changedFields(result.after, keys),
      replaceActive: replaceActive === true,
      reason,
    };
    return this.taxRuleView(result.after);
  }

  private taxRuleView(rule: {
    id: string;
    country: string | null;
    nameAr: string;
    nameEn: string;
    rateBps: number;
    mode: "added" | "inclusive";
    appliesTo: "all" | "subscription" | "credit_pack";
    active: boolean;
  }) {
    return {
      id: rule.id,
      country: rule.country,
      nameAr: rule.nameAr,
      nameEn: rule.nameEn,
      rateBps: rule.rateBps,
      mode: rule.mode,
      appliesTo: rule.appliesTo,
      active: rule.active,
    };
  }
}
