import { randomUUID } from "node:crypto";

import { WA_HEARTBEAT_KEY, WA_INBOUND_STREAM } from "@wasfa/shared/schemas/phone";

import type { InboundMessage } from "@wasfa/shared/schemas/phone";
import type { Redis } from "ioredis";

/*
 * A stand-in for the WhatsApp bridge (apps/worker/src/wa-bridge): the real one needs a paired phone.
 * Phone verification only trusts two things the bridge writes to Redis, and so does this.
 */

/** The bridge reports itself connected: phone verification becomes available (and mandatory in onboarding). */
export async function bridgeConnected(redis: Redis): Promise<void> {
  await redis.set(
    WA_HEARTBEAT_KEY,
    JSON.stringify({ at: Date.now(), state: "connected" }),
    "EX",
    300,
  );
}

/** No heartbeat: the bridge counts as down and the phone step can be skipped by verified-email users. */
export async function bridgeGone(redis: Redis): Promise<void> {
  await redis.del(WA_HEARTBEAT_KEY);
}

/** The user sent `code` from `phone` (E.164) to our number. */
export async function sendInbound(redis: Redis, phone: string, code: string): Promise<void> {
  const message: InboundMessage = {
    id: `WA${randomUUID().slice(0, 12)}`,
    phone,
    code,
    receivedAt: Date.now(),
    jid: `${phone.slice(1)}@s.whatsapp.net`,
  };
  await redis.xadd(WA_INBOUND_STREAM, "*", "data", JSON.stringify(message));
}
