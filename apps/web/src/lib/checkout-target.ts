import { BILLING_KEY_PATTERN } from "@wasfa/shared/billing";
import { PLAN_KEY_PATTERN } from "@wasfa/shared/plans";
import { monthsSchema } from "@wasfa/shared/schemas/billing";
import { orgContextIdSchema } from "@wasfa/shared/schemas/org";

/*
 * What a checkout is for, read from the URL (`?plan=&months=`, `?pack=`, `?renew=1`) and turned into
 * the one quote request the API understands. The client names the plan and the period; it never
 * sends a price (BILLING §1).
 */

export type CheckoutTarget =
  | { kind: "plan"; planKey: string; months: number }
  | { kind: "pack"; packKey: string }
  | { kind: "renew"; months?: number | undefined };

type Params = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The checkout the query describes, or `null` when it names nothing buyable. */
export function targetFromParams(params: Params): CheckoutTarget | null {
  if (first(params["renew"]) === "1") {
    const months = monthsSchema.safeParse(Number(first(params["months"])));
    return { kind: "renew", months: months.success ? months.data : undefined };
  }
  const pack = first(params["pack"]);
  if (pack !== undefined) {
    return BILLING_KEY_PATTERN.test(pack) ? { kind: "pack", packKey: pack } : null;
  }
  const plan = first(params["plan"]);
  const months = monthsSchema.safeParse(Number(first(params["months"]) ?? "1"));
  if (plan === undefined || plan.length > 40 || !PLAN_KEY_PATTERN.test(plan) || !months.success) {
    return null;
  }
  return { kind: "plan", planKey: plan, months: months.data };
}

/** `?org=<id>`: buy for an organization the person administers (the API checks the role). */
export function orgFromParams(params: Params): string | undefined {
  const parsed = orgContextIdSchema.safeParse(first(params["org"]));
  return parsed.success ? parsed.data : undefined;
}

export interface QuoteCall {
  path: string;
  body: Record<string, unknown>;
}

/** `?currency=` is added so the quote is priced in the currency the person chose on the pricing page. */
export function quoteCall(
  target: CheckoutTarget,
  options: {
    methodKey?: string | undefined;
    couponCode?: string | undefined;
    currency?: string | undefined;
    orgId?: string | undefined;
  },
): QuoteCall {
  const { methodKey, couponCode, currency, orgId } = options;
  const org = orgId ? { orgId } : {};
  const query = currency ? `?currency=${encodeURIComponent(currency)}` : "";
  const method = methodKey ? { methodKey } : {};
  if (target.kind === "renew") {
    return {
      path: `/me/subscription/renew-quote${query}`,
      body: { ...method, ...(target.months ? { months: target.months } : {}) },
    };
  }
  if (target.kind === "pack") {
    return { path: `/billing/quote${query}`, body: { packKey: target.packKey, ...method, ...org } };
  }
  return {
    path: `/billing/quote${query}`,
    body: {
      planKey: target.planKey,
      months: target.months,
      ...method,
      ...org,
      ...(couponCode ? { couponCode } : {}),
    },
  };
}

/** The same target as a checkout link, for the pricing page and the billing account. */
export function checkoutHref(target: CheckoutTarget, currency?: string, orgId?: string): string {
  const params = new URLSearchParams();
  if (target.kind === "renew") {
    params.set("renew", "1");
    if (target.months) params.set("months", String(target.months));
  } else if (target.kind === "pack") {
    params.set("pack", target.packKey);
  } else {
    params.set("plan", target.planKey);
    params.set("months", String(target.months));
  }
  if (currency) params.set("currency", currency);
  if (orgId && target.kind !== "renew") params.set("org", orgId);
  return `/checkout?${params.toString()}`;
}
