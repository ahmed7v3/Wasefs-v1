import {
  anonymizeUser,
  findDueUserIds,
  purgeExpired,
  type AnonymizeReason,
} from "./accounts.repo.js";

import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

/** A run never works for long: whatever is left is picked up by the next one (hourly). */
export const ANONYMIZE_BATCH_SIZE = 100;
export const ANONYMIZE_MAX_BATCHES = 10;

/** Only what these jobs use, so tests do not need Redis or a mail runtime. */
type AccountJobContext = Pick<JobContext, "db" | "logger">;

const REASONS: readonly AnonymizeReason[] = ["deletion_request", "never_verified"];

/**
 * `account.anonymize_due`: wipes accounts whose deletion grace period is over, and accounts nobody
 * ever verified (a squatted address would otherwise block its real owner, SECURITY.md §11).
 * One transaction per account, so one bad row never blocks the others. Logs counts only.
 */
export async function anonymizeDueJob(
  payload: JobPayload<"system", "account.anonymize_due">,
  { db, logger }: AccountJobContext,
): Promise<void> {
  const counts: Record<AnonymizeReason, number> = { deletion_request: 0, never_verified: 0 };
  const failed = new Set<string>();

  for (const reason of REASONS) {
    for (let batch = 0; batch < ANONYMIZE_MAX_BATCHES; batch++) {
      const ids = await findDueUserIds(db, reason, new Date(), ANONYMIZE_BATCH_SIZE, [...failed]);
      if (ids.length === 0) break;
      for (const id of ids) {
        try {
          if (await anonymizeUser(db, id, reason, new Date())) counts[reason]++;
        } catch {
          // Driver messages can quote row values; the job only reports that an account failed.
          failed.add(id);
        }
      }
    }
  }

  logger.info(
    {
      source: payload.source,
      deletionRequests: counts.deletion_request,
      neverVerified: counts.never_verified,
      failed: failed.size,
    },
    "Account anonymization run finished",
  );
  if (failed.size > 0) {
    // Fail the job so it is visible and retried; the work already done is committed per account.
    throw new Error(`Anonymization failed for ${String(failed.size)} account(s)`);
  }
}

/** `auth.purge_expired`: expired sessions and verification rows. Logs counts only. */
export async function purgeExpiredJob(
  payload: JobPayload<"system", "auth.purge_expired">,
  { db, logger }: AccountJobContext,
): Promise<void> {
  const purged = await purgeExpired(db, new Date());
  logger.info({ source: payload.source, ...purged }, "Expired sessions and verifications purged");
}
