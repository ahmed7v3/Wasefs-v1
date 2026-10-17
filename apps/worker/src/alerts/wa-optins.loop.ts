import { adminAlertPrefs, holdsPermission, users } from "@wasfa/db";
import { waAlertOptInSchema } from "@wasfa/shared/schemas/wa-alert";
import { and, eq, isNotNull, isNull } from "drizzle-orm";

import type { Database } from "@wasfa/db";
import type { Redis } from "ioredis";
import type { Logger } from "pino";

export const WA_ALERT_OPTINS_LIST = "wa:alert_optins";
export const WA_ALERT_OPTIN_JIDS = "wa:alert_optin_jids";

export type OptInOutcome = "opted_in" | "opted_out" | "ignored";

/**
 * Applies one entry the bridge queued. Only an active account whose VERIFIED phone matches the
 * sender and that holds `alerts.receive` is linked; anything else changes nothing, so the bridge's
 * reply cannot reveal whether a number belongs to an admin.
 */
export async function processAlertOptIn(
  db: Database,
  redis: Redis,
  raw: string,
): Promise<OptInOutcome> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return "ignored";
  }
  const parsed = waAlertOptInSchema.safeParse(value);
  if (!parsed.success) return "ignored";
  const { action, digits, jid } = parsed.data;
  if (action === "optout") {
    await db
      .update(adminAlertPrefs)
      .set({ whatsappEnabled: false, whatsappJid: null, updatedAt: new Date() })
      .where(eq(adminAlertPrefs.whatsappJid, jid));
    await redis.srem(WA_ALERT_OPTIN_JIDS, jid);
    return "opted_out";
  }
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.phone, `+${digits}`),
        isNotNull(users.phoneVerifiedAt),
        eq(users.status, "active"),
        isNull(users.anonymizedAt),
      ),
    );
  if (!owner || !(await holdsPermission(db, owner.id, "alerts.receive"))) return "ignored";
  await db
    .insert(adminAlertPrefs)
    .values({ userId: owner.id, whatsappEnabled: true, whatsappJid: jid })
    .onConflictDoUpdate({
      target: adminAlertPrefs.userId,
      set: { whatsappEnabled: true, whatsappJid: jid, updatedAt: new Date() },
    });
  await redis.sadd(WA_ALERT_OPTIN_JIDS, jid);
  return "opted_in";
}

/** Pops the bridge's opt-in list until `signal` aborts; `redis` must be a connection of its own. */
export async function runAlertOptInLoop(input: {
  redis: Redis;
  db: Database;
  logger: Logger;
  signal: AbortSignal;
}): Promise<void> {
  while (!input.signal.aborted) {
    const item = await input.redis.brpop(WA_ALERT_OPTINS_LIST, 5);
    if (!item) continue;
    const outcome = await processAlertOptIn(input.db, input.redis, item[1]);
    if (outcome !== "ignored") input.logger.info({ outcome }, "WhatsApp alert preference applied");
  }
}
