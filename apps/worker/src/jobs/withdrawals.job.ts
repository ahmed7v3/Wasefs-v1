import {
  adminAlerts,
  loadWithdrawal,
  maskedUserLabel,
  raiseAdminAlert,
  rewardsSettingsOf,
  users,
  withdrawalReconcile,
  withdrawalRequests,
  type OutboxHandler,
  type OutboxPostCommitAction,
} from "@wasfa/db";
import {
  WITHDRAWAL_MAIL_EVENTS,
  type EmailSendInput,
  type WithdrawalMailEvent,
} from "@wasfa/shared/email";
import { t, type MessageKey } from "@wasfa/shared/i18n";
import { formatMoney } from "@wasfa/shared/money";
import { and, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { jobIdFor } from "../notifications/customer-channel.js";
import { readSetting } from "../settings.js";

import { isWithinBusinessHours } from "./payments-review-sla.job.js";

import type { PaymentsRuntime } from "../payments/runtime.js";
import type { JobContext } from "../queues.js";
import type { CustomerMessageKind } from "@wasfa/shared/customer-messages";
import type { JobPayload } from "@wasfa/shared/queues";

/*
 * Withdrawals on the worker (Task 3.12): the customer notices of every step (the in-app row is
 * written by the money transaction itself; this turns the outbox entry into WhatsApp or email), the
 * overdue reminder, and the nightly check of paid-out against the points ledger.
 */

/** Overdue reminders are re-announced at most once per slot. */
const SLOT_MS = 30 * 60_000;

const notifyPayload = z.object({
  event: z.enum(WITHDRAWAL_MAIL_EVENTS),
  userId: z.uuid(),
  requestId: z.uuid().optional(),
  destinationId: z.uuid().optional(),
  note: z.string().nullish(),
  hours: z.number().int().min(0).optional(),
});

const KIND_OF: Record<WithdrawalMailEvent, CustomerMessageKind> = {
  requested: "withdrawal_requested",
  approved: "withdrawal_approved",
  rejected: "withdrawal_rejected",
  paid: "withdrawal_paid",
  canceled: "withdrawal_canceled",
  destination_added: "payout_destination_added",
};

export function withdrawalOutboxHandlers(
  runtime: Pick<PaymentsRuntime, "webOrigin">,
): Record<string, OutboxHandler> {
  return {
    "withdrawals.notify": async (tx, entry) => {
      const payload = notifyPayload.parse(entry.payload);
      const path = "/rewards/withdraw";
      const link = `${runtime.webOrigin}${path}`;
      const key = (entry.idempotencyKey ?? `withdrawal-notify:${entry.id}`).slice(0, 160);

      const [user] = await tx.select().from(users).where(eq(users.id, payload.userId));
      if (!user || user.status !== "active") return;
      const base = { to: user.email, name: user.name, locale: user.locale, link } as const;

      let message: {
        params: Record<string, string | number>;
        email: EmailSendInput;
      };
      if (payload.event === "destination_added") {
        const hours = payload.hours ?? (await rewardsSettingsOf(tx)).destinationCooldownHours;
        message = {
          params: { hours },
          email: { template: "withdrawal_update", ...base, event: "destination_added" },
        };
      } else {
        const loaded = payload.requestId ? await loadWithdrawal(tx, payload.requestId) : null;
        if (!loaded) return;
        const { request } = loaded;
        const reasonKey = request.rejectReason;
        const reason =
          payload.event === "rejected"
            ? t(
                `rewards.withdrawal.reject.${reasonKey ?? "other"}` as MessageKey,
                {},
                user.locale,
              )
            : undefined;
        message = {
          params: {
            points: request.points,
            amount: formatMoney(request.amountMinor, request.currency, user.locale),
            hours: (await rewardsSettingsOf(tx)).payoutSlaHours,
            ...(request.transferReference ? { reference: request.transferReference } : {}),
            ...(reason ? { reason } : {}),
            ...(payload.note ? { note: payload.note } : {}),
          },
          email: {
            template: "withdrawal_update",
            ...base,
            event: payload.event,
            points: request.points,
            amountMinor: request.amountMinor,
            currency: request.currency,
            reference: request.transferReference,
            reason: payload.event === "rejected" ? (reasonKey ?? "other") : null,
            note: payload.note ?? null,
          },
        };
      }
      const action: OutboxPostCommitAction = {
        kind: "customer_message",
        jobId: jobIdFor("customer", key),
        payload: {
          key,
          userId: user.id,
          kind: KIND_OF[payload.event],
          params: message.params,
          path,
          email: message.email,
        },
      };
      return [action];
    },
  };
}

/** `withdrawals.overdue`, every 30 minutes inside `alerts.businessHours`. */
export async function withdrawalsOverdueJob(
  _payload: JobPayload<"payments", "withdrawals.overdue">,
  { db }: Pick<JobContext, "db">,
  now = new Date(),
): Promise<void> {
  const alertsSettings = await readSetting(db, "alerts");
  if (!isWithinBusinessHours(now, alertsSettings.businessHours)) return;
  const rewards = await rewardsSettingsOf(db);
  const slotStart = new Date(Math.floor(now.getTime() / SLOT_MS) * SLOT_MS);
  const slotEnd = new Date(slotStart.getTime() + SLOT_MS);
  const cutoff = new Date(now.getTime() - rewards.payoutSlaHours * 3_600_000);
  const overdue = await db
    .select({ request: withdrawalRequests, user: users })
    .from(withdrawalRequests)
    .innerJoin(users, eq(users.id, withdrawalRequests.userId))
    .where(
      and(
        inArray(withdrawalRequests.status, ["requested", "approved"]),
        lte(withdrawalRequests.createdAt, cutoff),
      ),
    );
  for (const { request, user } of overdue) {
    await db.transaction(async (tx) => {
      // Two overlapping runs must not both raise the reminder for this slot.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`withdrawal-overdue:${request.id}`}))`,
      );
      const [existing] = await tx
        .select({ id: adminAlerts.id })
        .from(adminAlerts)
        .where(
          and(
            eq(adminAlerts.kind, "withdrawal.overdue"),
            eq(adminAlerts.refId, request.id),
            gte(adminAlerts.createdAt, slotStart),
            lt(adminAlerts.createdAt, slotEnd),
          ),
        )
        .limit(1);
      if (existing) return;
      const hours = Math.floor((now.getTime() - request.createdAt.getTime()) / 3_600_000);
      await raiseAdminAlert(tx, {
        kind: "withdrawal.overdue",
        severity: "warning",
        refType: "withdrawal",
        refId: request.id,
        summary:
          `Withdrawal of ${request.points.toLocaleString("en-US")} points ` +
          `(${formatMoney(request.amountMinor, request.currency, "en")}) from ${maskedUserLabel(user.name, user.id)} ` +
          `is overdue: ${request.status} for ${String(hours)} hours (SLA ${String(rewards.payoutSlaHours)}).`,
        link: `/admin/growth/withdrawals?id=${request.id}`,
        createdAt: now,
      });
    });
  }
}

/** `withdrawals.reconcile`, nightly: paid-out against the points ledger (REFERRALS §8.2.6). */
export async function withdrawalsReconcileJob(
  _payload: JobPayload<"payments", "withdrawals.reconcile">,
  { db, logger }: Pick<JobContext, "db" | "logger">,
  now = new Date(),
): Promise<void> {
  const result = await withdrawalReconcile(db);
  if (result.drifted === 0) {
    logger.info({ requests: result.requests, paid: result.paid }, "Withdrawals reconciled");
    return;
  }
  logger.error(
    {
      event: "withdrawals.drift",
      requests: result.requests,
      drifted: result.drifted,
      requestIds: result.requestIds,
      orphanRows: result.orphanRows,
    },
    "Withdrawals differ from the points ledger",
  );
  await db.transaction((tx) =>
    raiseAdminAlert(tx, {
      kind: "points.reconcile_drift",
      severity: "critical",
      refType: "withdrawals_reconcile",
      refId: now.toISOString().slice(0, 10),
      summary: `Withdrawals reconciliation: ${String(result.drifted)} of ${String(result.requests)} requests differ from the points ledger.`,
      link: "/admin/growth/withdrawals",
      createdAt: now,
    }),
  );
}
