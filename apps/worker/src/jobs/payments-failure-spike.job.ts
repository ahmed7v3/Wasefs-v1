import { adminAlerts, paymentEvents, payments, raiseAdminAlert } from "@wasfa/db";
import { and, eq, gte, isNotNull, lte, lt, sql } from "drizzle-orm";

import { readSetting } from "../settings.js";

import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

export async function paymentsFailureSpikeJob(
  _payload: JobPayload<"payments", "payments.failure_spike">,
  { db, logger }: Pick<JobContext, "db" | "logger">,
  now = new Date(),
): Promise<void> {
  const billing = await readSetting(db, "billing");
  const config = billing.failureSpike;
  if (!config.enabled) return;

  const windowStart = new Date(now.getTime() - config.windowMinutes * 60_000);
  const transitions = await db
    .select({
      methodKey: payments.methodKey,
      status: payments.status,
    })
    .from(paymentEvents)
    .innerJoin(payments, eq(payments.id, paymentEvents.paymentId))
    .where(
      and(
        eq(paymentEvents.provider, "internal"),
        eq(paymentEvents.type, "transition"),
        gte(paymentEvents.receivedAt, windowStart),
        lt(paymentEvents.receivedAt, now),
        isNotNull(payments.gateway),
        sql`${paymentEvents.payload}->>'to' = ${payments.status}`,
        sql`${payments.status} in ('failed', 'succeeded')`,
        sql`not exists (
          select 1 from payment_events later
          where later.payment_id = ${paymentEvents.paymentId}
            and later.provider = 'internal'
            and later.type = 'transition'
            and later.received_at > ${paymentEvents.receivedAt}
        )`,
      ),
    );

  const counts = new Map<string, { failed: number; succeeded: number }>();
  for (const transition of transitions) {
    const count = counts.get(transition.methodKey) ?? { failed: 0, succeeded: 0 };
    if (transition.status === "failed") count.failed += 1;
    if (transition.status === "succeeded") count.succeeded += 1;
    counts.set(transition.methodKey, count);
  }

  let raised = 0;
  for (const [methodKey, count] of counts) {
    const total = count.failed + count.succeeded;
    if (count.failed < config.minFailures || count.failed * 10_000 < total * config.rateBps) {
      continue;
    }

    const cooldownStart = new Date(now.getTime() - config.cooldownMinutes * 60_000);
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`failure-spike:${methodKey}`}))`,
      );
      const [existing] = await tx
        .select({ id: adminAlerts.id })
        .from(adminAlerts)
        .where(
          and(
            eq(adminAlerts.kind, "payment.failure_spike"),
            eq(adminAlerts.refType, "payment_method"),
            eq(adminAlerts.refId, methodKey),
            gte(adminAlerts.createdAt, cooldownStart),
            lte(adminAlerts.createdAt, now),
          ),
        )
        .limit(1);
      if (existing) return;

      const severity =
        count.failed === total && count.failed >= config.minFailures * 2 ? "critical" : "warning";
      const category = methodKey.includes("card") ? "Card" : "Gateway";
      await raiseAdminAlert(tx, {
        kind: "payment.failure_spike",
        severity,
        refType: "payment_method",
        refId: methodKey,
        summary:
          `${category} payments (${methodKey}): ${String(count.failed)} of ${String(total)} ` +
          `failed in the last ${String(config.windowMinutes)} min`,
        link: `/admin/billing/payments?status=failed&method=${encodeURIComponent(methodKey)}`,
        createdAt: now,
      });
      raised += 1;
    });
  }

  logger.info({ methods: counts.size, alerts: raised }, "Payment failure spike scan finished");
}
