import { addressingOf, unwrapContent, type Addressing, type RawMessage } from "./inbound.js";

import type { Redis } from "ioredis";
import type { Logger } from "pino";

/*
 * Why was an inbound message not acted on? Production logs of ignored messages used to be debug
 * only. Everything here is structural: no phone number, jid, LID, name, text or code is ever
 * logged or stored. The hourly counters let the admin side show the numbers later.
 */

export interface IgnoredDiagnostics {
  reason: string;
  addressing: Addressing;
  hasAlt: boolean;
  /** WhatsApp's `messageStubType` (2 = CIPHERTEXT: decryption failed), null when none. */
  stub: number | string | null;
  /** What a stub's parameter says, from a fixed list (never the raw text). */
  stubDetail: "absent" | "no_session" | "bad_mac" | "other" | null;
  /** The first key of the unwrapped message, e.g. `conversation` or `imageMessage`. */
  contentType: string | null;
  /** The sender is a verified business. */
  business: boolean;
}

// Keys that sit beside the real content in almost every message.
const NOISE_KEYS = new Set(["messageContextInfo", "senderKeyDistributionMessage"]);

function stubDetailOf(raw: RawMessage): IgnoredDiagnostics["stubDetail"] {
  if (raw.messageStubType === null || raw.messageStubType === undefined) return null;
  const parameter = raw.messageStubParameters?.[0] ?? "";
  if (parameter.includes("absent from node")) return "absent";
  if (/No (matching )?session/i.test(parameter)) return "no_session";
  if (/Bad MAC/i.test(parameter)) return "bad_mac";
  return "other";
}

export function describeIgnored(reason: string, raw: RawMessage): IgnoredDiagnostics {
  const content = unwrapContent(raw.message);
  const contentType =
    content === null
      ? null
      : (Object.keys(content).find(
          (key) => !NOISE_KEYS.has(key) && (content as Record<string, unknown>)[key] != null,
        ) ?? null);
  return {
    reason,
    addressing: addressingOf(raw.key.remoteJid),
    hasAlt: !!(raw.key.remoteJidAlt || raw.key.participantAlt),
    stub: raw.messageStubType ?? null,
    stubDetail: stubDetailOf(raw),
    contentType,
    business: !!raw.verifiedBizName,
  };
}

const COUNTER_TTL_SECONDS = 48 * 60 * 60;

/** `yyyymmddhh` in UTC. */
export function hourBucket(now: number): string {
  return new Date(now).toISOString().slice(0, 13).replace(/[-T]/g, "");
}

export async function recordIgnored(
  deps: { redis: Pick<Redis, "multi">; logger: Logger; now?: () => number },
  reason: string,
  raw: RawMessage,
): Promise<void> {
  deps.logger.info(describeIgnored(reason, raw), "Inbound message ignored");
  const key = `wa:inbound:ignored:${hourBucket((deps.now ?? Date.now)())}`;
  try {
    await deps.redis.multi().hincrby(key, reason, 1).expire(key, COUNTER_TTL_SECONDS).exec();
  } catch {
    // A counter must never break message handling.
  }
}
