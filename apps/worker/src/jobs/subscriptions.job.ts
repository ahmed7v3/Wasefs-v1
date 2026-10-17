import {
  advanceSubscription,
  backfillPaidSubscriptionOrders,
  liveSubscriptionIds,
  NO_LIFECYCLE_HOOKS,
} from "@wasfa/db";

import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

export const LIFECYCLE_BATCH_SIZE = 200;
export const LIFECYCLE_MAX_BATCHES = 500;

type LifecycleContext = Pick<JobContext, "db" | "logger">;

/**
 * `subscriptions.lifecycle`, every 15 minutes: walks the live subscriptions and moves each one to
 * `now` (period end, scheduled downgrade, grace, expiry, monthly credit grants on the anniversary,
 * reminders). Every step is idempotent, so a late or repeated run changes nothing twice. One
 * subscription failing does not stop the others; the run then fails so BullMQ records it.
 */
export async function subscriptionsLifecycleJob(
  _payload: JobPayload<"payments", "subscriptions.lifecycle">,
  { db, logger }: LifecycleContext,
  now = new Date(),
): Promise<void> {
  let afterId: string | null = null;
  let advanced = 0;
  let failed = 0;
  for (let batch = 0; batch < LIFECYCLE_MAX_BATCHES; batch++) {
    const ids = await liveSubscriptionIds(db, afterId, LIFECYCLE_BATCH_SIZE);
    if (ids.length === 0) break;
    for (const id of ids) {
      try {
        await advanceSubscription(db, id, now, NO_LIFECYCLE_HOOKS);
        advanced++;
      } catch {
        // Driver messages can quote row values; only the count is reported.
        failed++;
      }
    }
    afterId = ids.at(-1) ?? null;
    if (ids.length < LIFECYCLE_BATCH_SIZE) break;
  }
  logger.info({ advanced, failed }, "Subscription lifecycle finished");
  if (failed > 0) throw new Error(`Advancing ${String(failed)} subscription(s) failed`);
}

/**
 * `subscriptions.backfill`: paid subscription orders without a subscription (paid while the
 * activation hook was a no-op) get their period, at their payment time. Runs at start and nightly.
 */
export async function subscriptionsBackfillJob(
  _payload: JobPayload<"payments", "subscriptions.backfill">,
  { db, logger }: LifecycleContext,
): Promise<void> {
  const activated = await backfillPaidSubscriptionOrders(db);
  if (activated > 0) logger.info({ activated }, "Paid subscription orders backfilled");
}
