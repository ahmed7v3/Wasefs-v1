import { setWhatsappOptOut, userIdForVerifiedPhone, type Database } from "@wasfa/db";
import {
  WA_CUSTOMER_PREFS_LIST,
  waCustomerPrefCommandSchema,
} from "@wasfa/shared/customer-messages";

import type { Redis } from "ioredis";
import type { Logger } from "pino";

export type CustomerPrefOutcome = "stopped" | "started" | "ignored";

/**
 * Records a STOP / START the bridge received on the account whose verified phone sent it. The
 * bridge already updated the Redis opt-out set (instant effect); this makes it last and shows on
 * the account page. A number that belongs to no account changes nothing.
 */
export async function processCustomerPref(db: Database, raw: string): Promise<CustomerPrefOutcome> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return "ignored";
  }
  const parsed = waCustomerPrefCommandSchema.safeParse(value);
  if (!parsed.success) return "ignored";
  const userId = await userIdForVerifiedPhone(db, `+${parsed.data.digits}`);
  if (!userId) return "ignored";
  const stop = parsed.data.action === "stop";
  await setWhatsappOptOut(db, userId, stop, "whatsapp");
  return stop ? "stopped" : "started";
}

/** Pops the bridge's STOP / START list until `signal` aborts; `redis` must be its own connection. */
export async function runCustomerPrefLoop(input: {
  redis: Redis;
  db: Database;
  logger: Logger;
  signal: AbortSignal;
}): Promise<void> {
  while (!input.signal.aborted) {
    const item = await input.redis.brpop(WA_CUSTOMER_PREFS_LIST, 5);
    if (!item) continue;
    const outcome = await processCustomerPref(input.db, item[1]);
    if (outcome !== "ignored") input.logger.info({ outcome }, "WhatsApp customer preference saved");
  }
}
