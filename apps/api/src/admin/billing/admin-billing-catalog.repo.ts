import { Inject, Injectable } from "@nestjs/common";
import {
  aiUsage,
  creditPackPrices,
  creditPacks,
  isUniqueViolation,
  paymentGateways,
  paymentMethodAccountChanges,
  paymentMethods,
  planPrices,
  plans,
  subscriptions,
  taxRules,
  type CreditPack,
  type NewCreditPack,
  type NewTaxRule,
  type PaymentMethod,
  type TaxRule,
  type Transaction,
} from "@wasfa/db";
import { LIVE_SUBSCRIPTION_STATUSES } from "@wasfa/shared/billing";
import { and, asc, count, desc, eq, gte, inArray, isNull, ne, sql, sum } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

import type {
  CreditPackPriceCell,
  PlanPriceCell,
} from "@wasfa/shared/schemas/admin-billing-console";

export type MethodPatch = Partial<
  Pick<
    PaymentMethod,
    | "nameAr"
    | "nameEn"
    | "instructionsAr"
    | "instructionsEn"
    | "feeBps"
    | "feeFixedMinor"
    | "minAmountMinor"
    | "maxAmountMinor"
    | "currencies"
    | "countries"
    | "requiresProof"
    | "reviewSlaMinutes"
    | "sort"
    | "enabled"
  >
>;

export type TaxRulePatch = Partial<
  Pick<TaxRule, "country" | "nameAr" | "nameEn" | "rateBps" | "mode" | "appliesTo" | "active">
>;

/** The country a tax rule applies to; null = the default rule. */
const sameCountry = (country: string | null) =>
  country === null ? isNull(taxRules.country) : eq(taxRules.country, country);

@Injectable()
export class AdminBillingCatalogRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  // --- Plans and their prices --------------------------------------------------------------------

  async plans() {
    const [rows, prices, subscribers] = await Promise.all([
      this.handle.db.select().from(plans).orderBy(asc(plans.sort), asc(plans.key)),
      this.handle.db
        .select()
        .from(planPrices)
        .orderBy(asc(planPrices.months), asc(planPrices.currency)),
      this.handle.db
        .select({ planId: subscriptions.planId, value: count() })
        .from(subscriptions)
        .where(inArray(subscriptions.status, LIVE_SUBSCRIPTION_STATUSES))
        .groupBy(subscriptions.planId),
    ]);
    return rows.map((plan) => ({
      plan,
      prices: prices.filter((price) => price.planId === plan.id),
      activeSubscribers: subscribers.find((row) => row.planId === plan.id)?.value ?? 0,
    }));
  }

  async findPlan(id: string) {
    const [row] = await this.handle.db.select().from(plans).where(eq(plans.id, id));
    return row ?? null;
  }

  planPrices(planId: string) {
    return this.handle.db.select().from(planPrices).where(eq(planPrices.planId, planId));
  }

  async activeSubscribers(planId: string): Promise<number> {
    const [row] = await this.handle.db
      .select({ value: count() })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.planId, planId),
          inArray(subscriptions.status, LIVE_SUBSCRIPTION_STATUSES),
        ),
      );
    return row?.value ?? 0;
  }

  /** Upserts each cell in one transaction; a null amount switches the cell off, never deletes it. */
  async publishPlanPrices(planId: string, cells: readonly PlanPriceCell[]): Promise<void> {
    await this.handle.db.transaction(async (tx) => {
      for (const cell of cells) {
        const active = cell.amountMinor !== null;
        const set = active
          ? { amountMinor: cell.amountMinor ?? 0, active: true, updatedAt: new Date() }
          : { active: false, updatedAt: new Date() };
        await tx
          .insert(planPrices)
          .values({
            planId,
            months: cell.months,
            currency: cell.currency,
            amountMinor: cell.amountMinor ?? 0,
            active,
          })
          .onConflictDoUpdate({
            target: [planPrices.planId, planPrices.months, planPrices.currency],
            set,
          });
      }
    });
  }

  /** Provider cost and credits charged over the window: the real cost of one credit. */
  async aiCostSince(since: Date) {
    const [row] = await this.handle.db
      .select({
        cost: sum(aiUsage.costUsdMicros).mapWith(Number),
        credits: sum(aiUsage.creditsCharged).mapWith(Number),
      })
      .from(aiUsage)
      .where(gte(aiUsage.createdAt, since));
    return { cost: row?.cost ?? 0, credits: row?.credits ?? 0 };
  }

  /** The tax rule and gateway fee a new price is judged against (the worst enabled fee). */
  async marginAssumptions() {
    const [tax] = await this.handle.db
      .select({ mode: taxRules.mode, rateBps: taxRules.rateBps })
      .from(taxRules)
      .where(and(eq(taxRules.active, true), inArray(taxRules.appliesTo, ["all", "subscription"])))
      // The Egyptian rule wins over the default one (null sorts last).
      .orderBy(sql`${taxRules.country} is null`, asc(taxRules.country))
      .limit(1);
    const [fee] = await this.handle.db
      .select({ feeBps: paymentMethods.feeBps })
      .from(paymentMethods)
      .where(eq(paymentMethods.enabled, true))
      .orderBy(desc(paymentMethods.feeBps))
      .limit(1);
    return { tax: tax ?? null, feeBps: fee?.feeBps ?? 0 };
  }

  // --- Credit packs ------------------------------------------------------------------------------

  async creditPacks() {
    const [rows, prices] = await Promise.all([
      this.handle.db
        .select()
        .from(creditPacks)
        .orderBy(asc(creditPacks.sort), asc(creditPacks.key)),
      this.handle.db.select().from(creditPackPrices).orderBy(asc(creditPackPrices.currency)),
    ]);
    return rows.map((pack) => ({
      pack,
      prices: prices.filter((price) => price.packId === pack.id),
    }));
  }

  async creditPack(id: string) {
    const [pack] = await this.handle.db.select().from(creditPacks).where(eq(creditPacks.id, id));
    if (!pack) return null;
    const prices = await this.handle.db
      .select()
      .from(creditPackPrices)
      .where(eq(creditPackPrices.packId, id))
      .orderBy(asc(creditPackPrices.currency));
    return { pack, prices };
  }

  /** `null` = the key is taken. */
  async createCreditPack(values: NewCreditPack): Promise<CreditPack | null> {
    try {
      const [row] = await this.handle.db.insert(creditPacks).values(values).returning();
      return row ?? null;
    } catch (error) {
      if (isUniqueViolation(error, "credit_packs_key_key")) return null;
      throw error;
    }
  }

  async updateCreditPack(id: string, patch: Partial<NewCreditPack>) {
    const [row] = await this.handle.db
      .update(creditPacks)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(creditPacks.id, id))
      .returning();
    return row ?? null;
  }

  async setCreditPackPrices(packId: string, cells: readonly CreditPackPriceCell[]): Promise<void> {
    await this.handle.db.transaction(async (tx) => {
      for (const cell of cells) {
        const active = cell.amountMinor !== null;
        await tx
          .insert(creditPackPrices)
          .values({
            packId,
            currency: cell.currency,
            amountMinor: cell.amountMinor ?? 0,
            active,
          })
          .onConflictDoUpdate({
            target: [creditPackPrices.packId, creditPackPrices.currency],
            set: active
              ? { amountMinor: cell.amountMinor ?? 0, active: true, updatedAt: new Date() }
              : { active: false, updatedAt: new Date() },
          });
      }
    });
  }

  // --- Payment methods ---------------------------------------------------------------------------

  async methods() {
    const [rows, gateways, changes] = await Promise.all([
      this.handle.db
        .select()
        .from(paymentMethods)
        .orderBy(asc(paymentMethods.sort), asc(paymentMethods.key)),
      this.handle.db.select().from(paymentGateways),
      this.handle.db
        .select()
        .from(paymentMethodAccountChanges)
        .where(eq(paymentMethodAccountChanges.status, "pending")),
    ]);
    return rows.map((method) => ({
      method,
      gateway:
        method.kind === "gateway"
          ? (gateways.find((g) => g.key === method.provider) ?? null)
          : null,
      pending: changes.find((change) => change.methodId === method.id) ?? null,
    }));
  }

  async method(key: string) {
    const [method] = await this.handle.db
      .select()
      .from(paymentMethods)
      .where(eq(paymentMethods.key, key));
    if (!method) return null;
    const [[gateway], [pending]] = await Promise.all([
      this.handle.db.select().from(paymentGateways).where(eq(paymentGateways.key, method.provider)),
      this.handle.db
        .select()
        .from(paymentMethodAccountChanges)
        .where(
          and(
            eq(paymentMethodAccountChanges.methodId, method.id),
            eq(paymentMethodAccountChanges.status, "pending"),
          ),
        ),
    ]);
    return {
      method,
      gateway: method.kind === "gateway" ? (gateway ?? null) : null,
      pending: pending ?? null,
    };
  }

  /**
   * Applies `patch` under a row lock. Enabling a gateway method needs its gateway enabled and
   * verified, checked in the same transaction so a concurrent gateway change cannot slip past.
   * `patch` has no account fields by type: they are only written by the delayed change flow.
   */
  async updateMethod(key: string, patch: MethodPatch) {
    return this.handle.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(paymentMethods)
        .where(eq(paymentMethods.key, key))
        .for("update");
      if (!before) return { outcome: "not_found" as const };
      const minAmount =
        patch.minAmountMinor === undefined ? before.minAmountMinor : patch.minAmountMinor;
      const maxAmount =
        patch.maxAmountMinor === undefined ? before.maxAmountMinor : patch.maxAmountMinor;
      if (minAmount !== null && maxAmount !== null && minAmount > maxAmount) {
        return { outcome: "invalid_range" as const };
      }
      if (patch.enabled === true && !before.enabled && before.kind === "gateway") {
        const [gateway] = await tx
          .select({ enabled: paymentGateways.enabled, verifiedAt: paymentGateways.verifiedAt })
          .from(paymentGateways)
          .where(eq(paymentGateways.key, before.provider));
        if (!gateway?.enabled || !gateway.verifiedAt) {
          return { outcome: "gateway_unverified" as const };
        }
      }
      const [after] = await tx
        .update(paymentMethods)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(paymentMethods.key, key))
        .returning();
      if (!after) return { outcome: "not_found" as const };
      return { outcome: "updated" as const, before, after };
    });
  }

  // --- Tax rules ---------------------------------------------------------------------------------

  taxRules() {
    return this.handle.db
      .select()
      .from(taxRules)
      .orderBy(desc(taxRules.active), asc(taxRules.country), asc(taxRules.nameEn));
  }

  async createTaxRule(input: NewTaxRule, replaceActive: boolean) {
    return this.handle.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('tax_rules'))`);
      if (input.active) {
        const clash = await this.activeClashes(tx, input.country ?? null, null);
        if (clash.length > 0 && !replaceActive) return { outcome: "active_exists" as const };
        await this.deactivate(tx, clash);
      }
      const [created] = await tx.insert(taxRules).values(input).returning();
      if (!created) throw new Error("Tax rule was not stored");
      return { outcome: "created" as const, rule: created };
    });
  }

  async updateTaxRule(id: string, patch: TaxRulePatch, replaceActive: boolean) {
    return this.handle.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('tax_rules'))`);
      const [before] = await tx.select().from(taxRules).where(eq(taxRules.id, id)).for("update");
      if (!before) return { outcome: "not_found" as const };
      const country = patch.country === undefined ? before.country : patch.country;
      const active = patch.active ?? before.active;
      if (active) {
        const clash = await this.activeClashes(tx, country, id);
        if (clash.length > 0 && !replaceActive) return { outcome: "active_exists" as const };
        await this.deactivate(tx, clash);
      }
      const [after] = await tx
        .update(taxRules)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(taxRules.id, id))
        .returning();
      if (!after) return { outcome: "not_found" as const };
      return { outcome: "updated" as const, before, after };
    });
  }

  private activeClashes(tx: Transaction, country: string | null, exceptId: string | null) {
    return tx
      .select({ id: taxRules.id })
      .from(taxRules)
      .where(
        and(
          eq(taxRules.active, true),
          sameCountry(country),
          exceptId === null ? undefined : ne(taxRules.id, exceptId),
        ),
      )
      .for("update");
  }

  private async deactivate(tx: Transaction, rows: Array<{ id: string }>) {
    if (rows.length === 0) return;
    await tx
      .update(taxRules)
      .set({ active: false, updatedAt: new Date() })
      .where(
        inArray(
          taxRules.id,
          rows.map((row) => row.id),
        ),
      );
  }
}
