// The price engine (docs/BILLING.md §4): a pure, deterministic function. No I/O, no clock, no
// randomness; the API gathers already-resolved inputs and the web only displays the result.
// Money is integer minor units. Percentages are basis points, rounded half-up.

export const QUOTE_ERROR_CODES = [
  "PRICE_NOT_AVAILABLE",
  "BELOW_MINIMUM",
  "FREE_ORDER_NOT_ALLOWED",
  "METHOD_NOT_AVAILABLE",
] as const;
export type QuoteErrorCode = (typeof QUOTE_ERROR_CODES)[number];

export type DiscountSource = "promotion" | "coupon" | "personal_offer";
export type DiscountKind = "percent" | "fixed" | "bonus_credits" | "extra_months";

export interface DiscountScope {
  planKeys?: readonly string[];
  months?: readonly number[];
  countries?: readonly string[];
  newCustomersOnly?: boolean;
  minAmountMinor?: number;
}

export interface DiscountDef {
  id: string;
  source: DiscountSource;
  kind: DiscountKind;
  valueBps?: number | undefined;
  amountsMinor?: Readonly<Record<string, number>> | undefined;
  credits?: number | undefined;
  months?: number | undefined;
  scope: DiscountScope;
  startsAt?: string | Date | null;
  endsAt?: string | Date | null;
  stacking: "exclusive" | "stack_with_other";
  priority: number;
}

export interface DealTerms {
  id: string;
  /** Shown to the customer as the discount line's name (the engine's math never reads it). */
  name?: string | undefined;
  pricing:
    { mode: "fixed"; amountMinor: number; currency: string } | { mode: "percent_off"; bps: number };
  stackWithPromotions: boolean;
  stackWithCoupons: boolean;
}

export interface TaxRuleInput {
  id: string;
  rateBps: number;
  mode: "added" | "inclusive";
}

export interface PaymentMethodInput {
  key: string;
  feeBps: number;
  feeFixedMinor: number;
  minAmountMinor?: number;
  maxAmountMinor?: number;
  /** When set, the method is only available in these currencies. */
  currencies?: readonly string[];
}

export interface QuoteInput {
  price: { planKey: string; months: number; currency: string; amountMinor: number } | null;
  discounts: readonly DiscountDef[];
  deal?: DealTerms | null | undefined;
  taxRule?: TaxRuleInput | null | undefined;
  methods: readonly PaymentMethodInput[];
  methodKey?: string | null | undefined;
  history: {
    isFirstPurchase: boolean;
    upgradeFrom?:
      | {
          periodStart: string | Date;
          periodEnd: string | Date;
          lastPaidNetMinor: number;
          currency: string;
        }
      | null
      | undefined;
  };
  settings: {
    maxTotalDiscountBps: number;
    minChargeMinor: number;
    minChargeMode: "raise" | "refuse";
    allowFreeOrders: boolean;
    quoteTtlMinutes: number;
    creditValueMinor?: number | undefined;
  };
  now: string | Date;
  country?: string | null | undefined;
}

export type QuoteLineKind =
  "plan" | "discount" | "proration" | "adjustment" | "tax" | "fee" | "bonus";
export type QuoteLineMeta = Record<string, string | number | boolean>;

export interface QuoteLine {
  kind: QuoteLineKind;
  labelKey: string;
  amountMinor: number;
  meta?: QuoteLineMeta;
}

export interface MethodOption {
  key: string;
  feeMinor: number;
  totalMinor: number;
  available: boolean;
}

export interface PriceQuote {
  quoteVersion: 1;
  planKey: string;
  months: number;
  currency: string;
  lines: QuoteLine[];
  listPriceMinor: number;
  subtotalMinor: number;
  /** Tax shown to the customer: the added amount, or the amount contained in an inclusive price. */
  taxMinor: number;
  taxAddedMinor: number;
  taxIncludedMinor: number;
  taxMode: "added" | "inclusive" | null;
  feeMinor: number;
  totalMinor: number;
  methodKey: string | null;
  methodOptions: MethodOption[];
  isFreeOrder: boolean;
  grants: { bonusCredits: number; extraMonths: number };
  applied: { dealId?: string; promotionId?: string; couponId?: string; personalOfferId?: string };
  display: {
    headlineMinor: number;
    struckMinor: number | null;
    savingsMinor: number;
    savingsBps: number;
    perMonthMinor: number;
    feeLine: {
      amountMinor: number;
      show: boolean;
      items: Array<{ kind: "tax" | "fee"; amountMinor: number }>;
    };
    buttonTotalMinor: number;
  };
  expiresAt: string;
}

export type QuoteResult = { ok: true; quote: PriceQuote } | { ok: false; code: QuoteErrorCode };

const BPS = 10_000;
const DAY_MS = 86_400_000;

function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

/** `amount × bps / 10000`, rounded half-up, in integer math (no float, no overflow). */
export function mulBpsHalfUp(amountMinor: number, bps: number): number {
  return Number(divRoundHalfUp(BigInt(amountMinor) * BigInt(bps), BigInt(BPS)));
}

function toDate(value: string | Date): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError("Invalid date");
  return date;
}

function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value))
    return value.map((item) => (item === undefined ? null : canonicalize(item)));
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const item = source[key];
      if (item !== undefined) out[key] = canonicalize(item);
    }
    return out;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new RangeError("canonicalJson cannot encode a non-finite number");
  }
  return value;
}

/** Stable JSON for hashing: keys sorted recursively, no whitespace, `undefined` dropped, Dates as ISO. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

const SOURCE_RANK: Record<DiscountSource, number> = { coupon: 0, personal_offer: 1, promotion: 2 };
const SOURCE_LABEL: Record<DiscountSource, string> = {
  promotion: "billing.line.promotion",
  coupon: "billing.line.coupon",
  personal_offer: "billing.line.personalOffer",
};

interface Candidate {
  def: DiscountDef;
  saving: number;
}

function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.saving !== b.saving) return b.saving - a.saving;
  const rank = SOURCE_RANK[a.def.source] - SOURCE_RANK[b.def.source];
  if (rank !== 0) return rank;
  if (a.def.priority !== b.def.priority) return b.def.priority - a.def.priority;
  return a.def.id < b.def.id ? -1 : a.def.id > b.def.id ? 1 : 0;
}

function discountSaving(
  def: DiscountDef,
  baseMinor: number,
  months: number,
  currency: string,
  creditValueMinor: number,
): number {
  switch (def.kind) {
    case "percent":
      return def.valueBps === undefined
        ? 0
        : Math.min(baseMinor, mulBpsHalfUp(baseMinor, def.valueBps));
    case "fixed": {
      const amount = def.amountsMinor?.[currency];
      return amount === undefined ? 0 : Math.min(baseMinor, amount);
    }
    case "extra_months":
      return def.months && def.months > 0
        ? Number((BigInt(baseMinor) * BigInt(def.months)) / BigInt(months))
        : 0;
    case "bonus_credits":
      return (def.credits ?? 0) * creditValueMinor;
  }
}

function isEligible(def: DiscountDef, input: QuoteInput, baseMinor: number, now: Date): boolean {
  const price = input.price;
  if (!price) return false;
  const { scope } = def;
  if (def.startsAt && toDate(def.startsAt).getTime() > now.getTime()) return false;
  if (def.endsAt && toDate(def.endsAt).getTime() <= now.getTime()) return false;
  if (scope.planKeys && !scope.planKeys.includes(price.planKey)) return false;
  if (scope.months && !scope.months.includes(price.months)) return false;
  if (scope.countries) {
    const country = input.country?.toUpperCase();
    if (!country || !scope.countries.some((c) => c.toUpperCase() === country)) return false;
  }
  if (scope.newCustomersOnly && !input.history.isFirstPurchase) return false;
  if (scope.minAmountMinor !== undefined && baseMinor < scope.minAmountMinor) return false;
  return true;
}

function methodAvailable(
  method: PaymentMethodInput,
  currency: string,
  chargeableMinor: number,
): boolean {
  if (method.currencies && !method.currencies.includes(currency)) return false;
  if (method.feeBps < 0 || method.feeBps >= BPS || method.feeFixedMinor < 0) return false;
  if (chargeableMinor === 0) return true;
  if (method.minAmountMinor !== undefined && chargeableMinor < method.minAmountMinor) return false;
  if (method.maxAmountMinor !== undefined && chargeableMinor > method.maxAmountMinor) return false;
  return true;
}

/** Gross-up so the merchant nets `subtotal + taxAdded` after the gateway's cut (BILLING §4 step 8). */
function methodTotal(method: PaymentMethodInput, preFeeMinor: number): number {
  if (preFeeMinor === 0) return 0;
  const base = BigInt(preFeeMinor) + BigInt(method.feeFixedMinor);
  if (method.feeBps <= 0) return Number(base);
  const denominator = BigInt(BPS - method.feeBps);
  return Number((base * BigInt(BPS) + denominator - 1n) / denominator);
}

export function quote(input: QuoteInput): QuoteResult {
  const { price, settings } = input;
  if (!price) return { ok: false, code: "PRICE_NOT_AVAILABLE" };
  const now = toDate(input.now);
  const { currency, months } = price;
  const listMinor = price.amountMinor;
  const lines: QuoteLine[] = [
    {
      kind: "plan",
      labelKey: "billing.line.plan",
      amountMinor: listMinor,
      meta: { planKey: price.planKey, months },
    },
  ];
  const applied: PriceQuote["applied"] = {};
  const grants = { bonusCredits: 0, extraMonths: 0 };

  // Step 2: deal. It never raises the price and never goes below min(list, minCharge).
  let baseMinor = listMinor;
  const deal = input.deal ?? null;
  if (deal) {
    let dealPrice = listMinor;
    if (deal.pricing.mode === "fixed") {
      if (deal.pricing.currency === currency) dealPrice = deal.pricing.amountMinor;
    } else {
      dealPrice = listMinor - mulBpsHalfUp(listMinor, deal.pricing.bps);
    }
    dealPrice = Math.min(
      listMinor,
      Math.max(dealPrice, Math.min(listMinor, settings.minChargeMinor)),
    );
    if (dealPrice < listMinor) {
      baseMinor = dealPrice;
      applied.dealId = deal.id;
      lines.push({
        kind: "discount",
        labelKey: "billing.line.deal",
        amountMinor: -(listMinor - dealPrice),
        meta: deal.name ? { dealId: deal.id, name: deal.name } : { dealId: deal.id },
      });
    }
  }

  // Steps 3-4: best-of, with opt-in stacking.
  const creditValue = settings.creditValueMinor ?? 0;
  const candidates: Candidate[] = [];
  for (const def of input.discounts) {
    if (deal && def.source === "promotion" && !deal.stackWithPromotions) continue;
    if (deal && def.source === "coupon" && !deal.stackWithCoupons) continue;
    if (!isEligible(def, input, baseMinor, now)) continue;
    const saving = discountSaving(def, baseMinor, months, currency, creditValue);
    if (saving > 0) candidates.push({ def, saving });
  }
  candidates.sort(compareCandidates);

  let chosen: Candidate[] = [];
  const winner = candidates[0];
  if (winner) {
    chosen = [winner];
    if (winner.def.stacking === "stack_with_other") {
      chosen = [];
      let couponTaken = false;
      for (const candidate of candidates) {
        if (candidate.def.stacking !== "stack_with_other") continue;
        if (candidate.def.source === "coupon") {
          if (couponTaken) continue;
          couponTaken = true;
        }
        chosen.push(candidate);
      }
    }
  }

  // The cap limits stacked discounts only (BILLING §3); a single discount may reach 100% (free order, §5.4).
  const capMinor =
    chosen.length > 1
      ? Number((BigInt(baseMinor) * BigInt(settings.maxTotalDiscountBps)) / BigInt(BPS))
      : baseMinor;
  let running = baseMinor;
  let capLeft = capMinor;
  for (const { def } of chosen) {
    const label = SOURCE_LABEL[def.source];
    const recordApplied = () => {
      if (def.source === "promotion") applied.promotionId ??= def.id;
      else if (def.source === "coupon") applied.couponId ??= def.id;
      else applied.personalOfferId ??= def.id;
    };
    if (def.kind === "percent" || def.kind === "fixed") {
      const raw =
        def.kind === "percent"
          ? mulBpsHalfUp(running, def.valueBps ?? 0)
          : (def.amountsMinor?.[currency] ?? 0);
      const amount = Math.min(raw, running, capLeft);
      if (amount <= 0) continue;
      running -= amount;
      capLeft -= amount;
      recordApplied();
      lines.push({
        kind: "discount",
        labelKey: label,
        amountMinor: -amount,
        meta: def.kind === "percent" ? { id: def.id, bps: def.valueBps ?? 0 } : { id: def.id },
      });
    } else if (def.kind === "bonus_credits") {
      const credits = def.credits ?? 0;
      grants.bonusCredits += credits;
      recordApplied();
      lines.push({
        kind: "bonus",
        labelKey: "billing.line.bonusCredits",
        amountMinor: 0,
        meta: { id: def.id, credits },
      });
    } else {
      const extra = def.months ?? 0;
      grants.extraMonths += extra;
      recordApplied();
      lines.push({
        kind: "bonus",
        labelKey: "billing.line.extraMonths",
        amountMinor: 0,
        meta: { id: def.id, months: extra },
      });
    }
  }
  const discountedMinor = running;

  // Step 5: proration credit for an upgrade (BILLING §7.3).
  let prorationMinor = 0;
  const upgrade = input.history.upgradeFrom;
  if (upgrade && upgrade.currency === currency) {
    const start = toDate(upgrade.periodStart).getTime();
    const end = toDate(upgrade.periodEnd).getTime();
    const totalDays = Math.ceil((end - start) / DAY_MS);
    const remainingDays = Math.max(0, Math.ceil((end - now.getTime()) / DAY_MS));
    if (totalDays > 0 && remainingDays > 0) {
      const daily = Math.floor(upgrade.lastPaidNetMinor / totalDays);
      prorationMinor = Math.min(daily * remainingDays, discountedMinor);
      if (prorationMinor > 0) {
        lines.push({
          kind: "proration",
          labelKey: "billing.line.proration",
          amountMinor: -prorationMinor,
          meta: { remainingDays, totalDays },
        });
      }
    }
  }

  // Step 6: subtotal and minimum charge.
  let subtotalMinor = Math.max(0, discountedMinor - prorationMinor);
  if (subtotalMinor > 0 && subtotalMinor < settings.minChargeMinor) {
    if (settings.minChargeMode === "refuse") return { ok: false, code: "BELOW_MINIMUM" };
    lines.push({
      kind: "adjustment",
      labelKey: "billing.line.minimumCharge",
      amountMinor: settings.minChargeMinor - subtotalMinor,
      meta: { minChargeMinor: settings.minChargeMinor },
    });
    subtotalMinor = settings.minChargeMinor;
  }
  if (subtotalMinor === 0 && !settings.allowFreeOrders) {
    return { ok: false, code: "FREE_ORDER_NOT_ALLOWED" };
  }

  // Step 7: tax.
  const taxRule = input.taxRule ?? null;
  let taxAddedMinor = 0;
  let taxIncludedMinor = 0;
  if (taxRule?.mode === "added") {
    taxAddedMinor = mulBpsHalfUp(subtotalMinor, taxRule.rateBps);
    if (taxAddedMinor > 0) {
      lines.push({
        kind: "tax",
        labelKey: "billing.line.tax",
        amountMinor: taxAddedMinor,
        meta: { taxRuleId: taxRule.id, rateBps: taxRule.rateBps },
      });
    }
  } else if (taxRule?.mode === "inclusive") {
    taxIncludedMinor = Number(
      divRoundHalfUp(
        BigInt(subtotalMinor) * BigInt(taxRule.rateBps),
        BigInt(BPS + taxRule.rateBps),
      ),
    );
    if (taxIncludedMinor > 0) {
      lines.push({
        kind: "tax",
        labelKey: "billing.line.tax",
        amountMinor: 0,
        meta: {
          taxRuleId: taxRule.id,
          rateBps: taxRule.rateBps,
          inclusive: true,
          includedMinor: taxIncludedMinor,
        },
      });
    }
  }

  // Step 8: processing fee for every method; the selected one makes the quote.
  const preFeeMinor = subtotalMinor + taxAddedMinor;
  const methodOptions: MethodOption[] = input.methods.map((method) => {
    const available = methodAvailable(method, currency, preFeeMinor);
    const totalMinor = available ? methodTotal(method, preFeeMinor) : preFeeMinor;
    return { key: method.key, feeMinor: totalMinor - preFeeMinor, totalMinor, available };
  });
  let feeMinor = 0;
  let methodKey: string | null = null;
  if (input.methodKey) {
    const selected = methodOptions.find((option) => option.key === input.methodKey);
    if (!selected || !selected.available) return { ok: false, code: "METHOD_NOT_AVAILABLE" };
    feeMinor = selected.feeMinor;
    methodKey = selected.key;
    if (feeMinor > 0) {
      lines.push({
        kind: "fee",
        labelKey: "billing.line.fee",
        amountMinor: feeMinor,
        meta: { methodKey },
      });
    }
  }

  // Step 9: total and display hints (BILLING §6).
  const totalMinor = preFeeMinor + feeMinor;
  const savingsMinor = listMinor - discountedMinor;
  const combinedMinor = taxAddedMinor + feeMinor;
  return {
    ok: true,
    quote: {
      quoteVersion: 1,
      planKey: price.planKey,
      months,
      currency,
      lines,
      listPriceMinor: listMinor,
      subtotalMinor,
      taxMinor: taxRule?.mode === "inclusive" ? taxIncludedMinor : taxAddedMinor,
      taxAddedMinor,
      taxIncludedMinor,
      taxMode: taxRule?.mode ?? null,
      feeMinor,
      totalMinor,
      methodKey,
      methodOptions,
      isFreeOrder: totalMinor === 0,
      grants,
      applied,
      display: {
        headlineMinor: totalMinor,
        struckMinor: listMinor > subtotalMinor ? listMinor : null,
        savingsMinor,
        savingsBps: listMinor > 0 ? Math.floor((savingsMinor * BPS) / listMinor) : 0,
        perMonthMinor: Math.floor(subtotalMinor / months),
        feeLine: {
          amountMinor: combinedMinor,
          show: combinedMinor > 0,
          items: [
            { kind: "tax", amountMinor: taxAddedMinor },
            { kind: "fee", amountMinor: feeMinor },
          ],
        },
        buttonTotalMinor: totalMinor,
      },
      expiresAt: new Date(now.getTime() + settings.quoteTtlMinutes * 60_000).toISOString(),
    },
  };
}
