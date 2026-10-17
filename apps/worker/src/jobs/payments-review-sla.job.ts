import {
  adminAlerts,
  orders,
  paymentEvents,
  paymentMethods,
  payments,
  raiseAdminAlert,
} from "@wasfa/db";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { readSetting } from "../settings.js";

import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

/** Overdue reviews are re-announced at most once per slot. */
const SLOT_MS = 30 * 60_000;

function isWithinBusinessHours(
  now: Date,
  hours: { timezone: string; startHour: number; endHour: number; days: number[] },
): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: hours.timezone,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekdayName = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayName ?? "");
  return day >= 0 && hours.days.includes(day) && hour >= hours.startHour && hour < hours.endHour;
}

export async function paymentsReviewSlaJob(
  _payload: JobPayload<"payments", "payments.review-sla">,
  { db }: Pick<JobContext, "db">,
  now = new Date(),
): Promise<void> {
  const [alertsSettings, billing] = await Promise.all([
    readSetting(db, "alerts"),
    readSetting(db, "billing"),
  ]);
  if (!isWithinBusinessHours(now, alertsSettings.businessHours)) return;
  const slotStart = new Date(Math.floor(now.getTime() / SLOT_MS) * SLOT_MS);
  const slotEnd = new Date(slotStart.getTime() + SLOT_MS);
  const candidates = await db
    .select({ payment: payments, order: orders, method: paymentMethods })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(paymentMethods, eq(paymentMethods.key, payments.methodKey))
    .where(inArray(payments.status, ["awaiting_review", "awaiting_second_approval"]));
  for (const candidate of candidates) {
    const transitions = await db
      .select()
      .from(paymentEvents)
      .where(
        and(
          eq(paymentEvents.paymentId, candidate.payment.id),
          eq(paymentEvents.provider, "internal"),
          eq(paymentEvents.type, "transition"),
        ),
      )
      .orderBy(desc(paymentEvents.receivedAt))
      .limit(10);
    const transition = transitions.find((event) => event.payload.to === candidate.payment.status);
    const enteredAt = transition?.receivedAt ?? candidate.payment.updatedAt;
    const sla = candidate.method.reviewSlaMinutes ?? billing.reviewSlaMinutes;
    if (now.getTime() - enteredAt.getTime() < sla * 60_000) continue;
    await db.transaction(async (tx) => {
      // Two overlapping runs must not both raise the reminder for this slot.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`review-sla:${candidate.payment.id}`}))`,
      );
      const [existing] = await tx
        .select({ id: adminAlerts.id })
        .from(adminAlerts)
        .where(
          and(
            eq(adminAlerts.kind, "payment.review_overdue"),
            eq(adminAlerts.refId, candidate.payment.id),
            gte(adminAlerts.createdAt, slotStart),
            lt(adminAlerts.createdAt, slotEnd),
          ),
        )
        .limit(1);
      if (existing) return;
      await raiseAdminAlert(tx, {
        kind: "payment.review_overdue",
        severity: "warning",
        refType: "payment",
        refId: candidate.payment.id,
        summary: `Order ${candidate.order.number}: manual payment review is overdue.`,
        link: `/admin/billing/payments/${candidate.payment.id}`,
        createdAt: now,
      });
    });
  }
}
