import {
  handleMemberJoined,
  handleOrderPaid,
  handleOrderRefunded,
  handleSignupCheck,
  raiseAdminAlert,
  reconcilePoints,
  releaseDuePoints,
  REWARD_TOPICS,
  type OutboxHandler,
  type RewardEvaluationOptions,
} from "@wasfa/db";
import { z } from "zod";

import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

/*
 * Rewards on the worker (Task 3.11). The rules live in `@wasfa/db` (`rewards.ts`); this file only
 * binds them to the outbox topics and to the scheduled jobs. Every handler runs in the outbox
 * drainer's transaction (a savepoint), so a failure rolls back its points and the entry is retried.
 */

const userPayload = z.object({ userId: z.uuid() });
const orderPayload = z.object({ orderId: z.uuid() });
const refundPayload = z.object({ orderId: z.uuid(), refundId: z.uuid() });
const memberPayload = z.object({
  orgId: z.uuid(),
  userId: z.uuid(),
  linkId: z.uuid().nullish(),
});

/** The reward topics of the outbox; spread into `outboxHandlers`. */
export function rewardOutboxHandlers(
  options: RewardEvaluationOptions = {},
): Record<string, OutboxHandler> {
  return {
    [REWARD_TOPICS.signupCheck]: async (tx, entry) => {
      const { userId } = userPayload.parse(entry.payload);
      await handleSignupCheck(tx, userId, new Date(), options);
    },
    [REWARD_TOPICS.orderPaid]: async (tx, entry) => {
      const { orderId } = orderPayload.parse(entry.payload);
      await handleOrderPaid(tx, orderId, new Date(), options);
    },
    [REWARD_TOPICS.orderRefunded]: async (tx, entry) => {
      const { orderId } = refundPayload.parse(entry.payload);
      await handleOrderRefunded(tx, orderId, new Date());
    },
    [REWARD_TOPICS.memberJoined]: async (tx, entry) => {
      const { orgId, userId } = memberPayload.parse(entry.payload);
      await handleMemberJoined(tx, { orgId, userId }, new Date(), options);
    },
  };
}

type RewardsJobContext = Pick<JobContext, "db" | "logger">;

/** `rewards.release`, hourly at minute 7: pending rewards whose hold ended (REFERRALS §4). */
export async function releaseRewardsJob(
  _payload: JobPayload<"payments", "rewards.release">,
  { db, logger }: RewardsJobContext,
  now = new Date(),
): Promise<void> {
  const result = await releaseDuePoints(db, now);
  if (result.failed > 0) {
    logger.warn(
      { event: "rewards.release_failed", ...result },
      "Some rewards could not be released",
    );
  } else if (result.released + result.reversed > 0) {
    logger.info(result, "Pending rewards released");
  }
}

/**
 * `rewards.reconcile`, nightly at 03:10 UTC: every wallet bucket against the sum of its ledger rows.
 * Drift raises a critical admin alert (ids stay in the log, never in the alert) and does not throw:
 * retrying cannot fix drift, and a failing job would hide it.
 */
export async function reconcileRewardsJob(
  _payload: JobPayload<"payments", "rewards.reconcile">,
  { db, logger }: RewardsJobContext,
  now = new Date(),
): Promise<void> {
  const result = await reconcilePoints(db);
  if (result.drifted === 0) {
    logger.info({ wallets: result.wallets }, "Points wallets reconciled");
    return;
  }
  logger.error(
    {
      event: "points.drift",
      wallets: result.wallets,
      drifted: result.drifted,
      walletIds: result.walletIds,
    },
    "Points wallet drift detected",
  );
  await db.transaction((tx) =>
    raiseAdminAlert(tx, {
      kind: "points.reconcile_drift",
      severity: "critical",
      refType: "points_reconcile",
      refId: now.toISOString().slice(0, 10),
      summary: `Points reconciliation: ${String(result.drifted)} of ${String(result.wallets)} wallets differ from their ledger.`,
      link: "/admin/growth/rewards",
      createdAt: now,
    }),
  );
}
