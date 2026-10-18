import { z } from "zod";

/*
 * Pure subscription helpers shared by the API (authoritative), the worker (lifecycle jobs) and the
 * web (receipt print page). No I/O here.
 */

/**
 * `date` plus `months` calendar months in UTC, clamped to the last day of the target month:
 * Jan 31 + 1 month = Feb 28 (or 29), Mar 31 - 1 month = Feb 28. The time of day is kept.
 */
export function addMonthsClamped(date: Date, months: number): Date {
  if (!Number.isInteger(months)) throw new Error("months must be an integer");
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      Math.min(date.getUTCDate(), lastDay),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

/** `date` plus whole days (UTC, 24 h each). */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/**
 * The anniversaries of a period: `start`, start + 1 month, ... while strictly before `end`. Each
 * is the moment a month of plan credits is due (BILLING §7.2).
 */
export function anniversaries(start: Date, end: Date): Date[] {
  const result: Date[] = [];
  for (let n = 0; ; n++) {
    const at = addMonthsClamped(start, n);
    if (at.getTime() >= end.getTime()) return result;
    result.push(at);
  }
}

/** `YYYY-MM` of a moment in UTC. */
export function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** A downgrade bought while a higher plan is still running: it starts when the current period ends. */
export const pendingChangeSchema = z.object({
  planId: z.uuid(),
  months: z.number().int().min(1).max(120),
  orderId: z.uuid(),
  effectiveAt: z.iso.datetime(),
});
export type PendingChange = z.output<typeof pendingChangeSchema>;

/** Reminder slots before the period end (days) and during grace (one per day, at most three). */
export const RENEWAL_REMINDER_DAYS = [7, 3, 1] as const;
export const GRACE_REMINDER_SLOTS = ["g1", "g2", "g3"] as const;
export const SUBSCRIPTION_REMINDER_SLOTS = [
  "d7",
  "d3",
  "d1",
  "expired",
  ...GRACE_REMINDER_SLOTS,
] as const;
export type SubscriptionReminderSlot = (typeof SUBSCRIPTION_REMINDER_SLOTS)[number];

// --- Receipts ---------------------------------------------------------------------------------

export interface ReceiptLineInput {
  kind: "plan" | "discount" | "proration" | "adjustment" | "tax" | "fee" | "bonus";
  labelKey: string;
  amountMinor: number;
  meta?: Record<string, string | number | boolean>;
}

export interface ReceiptInput {
  order: {
    number: string;
    kind: string;
    planKey: string | null;
    packKey: string | null;
    months: number | null;
    currency: string;
    subtotalMinor: number;
    discountMinor: number;
    taxMinor: number;
    feeMinor: number;
    totalMinor: number;
    status: string;
    createdAt: Date;
    paidAt: Date | null;
    /** The stored quote's lines (`quote.lines`); anything unreadable is dropped. */
    lines: unknown;
    taxMode: "added" | "inclusive" | null;
  };
  buyer: { name: string; email: string | null; phone: string | null };
  company: { legalName: string | null; address: string | null; taxId: string | null };
  payment: {
    methodKey: string;
    methodNameAr: string;
    methodNameEn: string;
    reference: string;
  } | null;
  refunds: Array<{ amountMinor: number; createdAt: Date }>;
}

export interface Receipt {
  number: string;
  issuedAt: string;
  paidAt: string | null;
  status: string;
  currency: string;
  buyer: { name: string; email: string | null; phone: string | null };
  company: ReceiptInput["company"];
  item: { kind: string; planKey: string | null; packKey: string | null; months: number | null };
  lines: Array<{ kind: ReceiptLineInput["kind"]; labelKey: string; amountMinor: number }>;
  taxMode: "added" | "inclusive" | null;
  totals: {
    subtotalMinor: number;
    discountMinor: number;
    taxMinor: number;
    feeMinor: number;
    totalMinor: number;
    refundedMinor: number;
    netPaidMinor: number;
  };
  payment: {
    methodKey: string;
    methodNameAr: string;
    methodNameEn: string;
    reference: string;
  } | null;
  refunds: Array<{ amountMinor: number; refundedAt: string }>;
}

const receiptLineSchema = z.object({
  kind: z.enum(["plan", "discount", "proration", "adjustment", "tax", "fee", "bonus"]),
  labelKey: z.string().min(1).max(120),
  amountMinor: z.number().int(),
});

/** `a***@example.com`: enough for the buyer to recognise, not a full address on a printout. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

/** `+20*******678`: the country code and the last three digits. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return "***";
  const prefix = phone.startsWith("+") ? `+${digits.slice(0, 2)}` : digits.slice(0, 3);
  return `${prefix}${"*".repeat(Math.max(3, digits.length - 5))}${digits.slice(-3)}`;
}

/**
 * The data of a printable receipt (BILLING §6.4: the full itemisation). Money stays in integer
 * minor units; the web formats it. The buyer's email and phone are masked.
 */
export function buildReceipt(input: ReceiptInput): Receipt {
  const parsedLines = z.array(receiptLineSchema).safeParse(input.order.lines);
  const lines = parsedLines.success ? parsedLines.data : [];
  const refundedMinor = input.refunds.reduce((sum, refund) => sum + refund.amountMinor, 0);
  return {
    number: input.order.number,
    issuedAt: (input.order.paidAt ?? input.order.createdAt).toISOString(),
    paidAt: input.order.paidAt?.toISOString() ?? null,
    status: input.order.status,
    currency: input.order.currency,
    buyer: {
      name: input.buyer.name,
      email: input.buyer.email ? maskEmail(input.buyer.email) : null,
      phone: input.buyer.phone ? maskPhone(input.buyer.phone) : null,
    },
    company: input.company,
    item: {
      kind: input.order.kind,
      planKey: input.order.planKey,
      packKey: input.order.packKey,
      months: input.order.months,
    },
    lines: lines.map(({ kind, labelKey, amountMinor }) => ({ kind, labelKey, amountMinor })),
    taxMode: input.order.taxMode,
    totals: {
      subtotalMinor: input.order.subtotalMinor,
      discountMinor: input.order.discountMinor,
      taxMinor: input.order.taxMinor,
      feeMinor: input.order.feeMinor,
      totalMinor: input.order.totalMinor,
      refundedMinor,
      netPaidMinor: input.order.totalMinor - refundedMinor,
    },
    payment: input.payment,
    refunds: input.refunds.map((refund) => ({
      amountMinor: refund.amountMinor,
      refundedAt: refund.createdAt.toISOString(),
    })),
  };
}
