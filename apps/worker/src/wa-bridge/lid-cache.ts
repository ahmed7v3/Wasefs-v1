import { WA_LID_CLAIM_LOOKUP_MAX, waLidClaimKey } from "@wasfa/shared/schemas/phone";

import { splitJid, type LidResolver } from "./inbound.js";

import type { Redis } from "ioredis";
import type { Logger } from "pino";

/*
 * `lid -> phone` mappings WhatsApp told us about, kept in Redis for 30 days next to Baileys' own
 * store (which can lose them on a reconnect before they sync). Baileys cannot look a LID up on
 * demand, so everything we ever learn is worth keeping. The key holds the LID user part only; the
 * value is the phone digits. Nothing from a message's text ever ends up here.
 */

export const LID_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

const keyOf = (lidUser: string) => `wa:lid:${lidUser}`;

function lidUserOf(lid: string): string | null {
  const parts = splitJid(lid);
  return parts && (parts.server === "lid" || parts.server === "hosted.lid") ? parts.user : null;
}

function digitsOf(pn: string): string | null {
  const parts = splitJid(pn);
  return parts && /^\d{6,15}$/.test(parts.user) ? parts.user : null;
}

/** Wraps Baileys' mapping with the Redis cache; also the sink for mappings it learns from events. */
export function createLidResolver(options: {
  redis: Pick<Redis, "get" | "set" | "srandmember">;
  baileys: {
    getPNForLID: (lid: string) => Promise<string | null>;
    /** Asks WhatsApp (usync) when the mapping is not stored yet. */
    getLIDForPN: (pn: string) => Promise<string | null>;
  };
  logger: Logger;
}): LidResolver {
  const { redis, baileys, logger } = options;

  async function learn(lid: string, pn: string): Promise<void> {
    const lidUser = lidUserOf(lid);
    const digits = digitsOf(pn);
    if (!lidUser || !digits) return;
    try {
      await redis.set(keyOf(lidUser), digits, "EX", LID_CACHE_TTL_SECONDS);
    } catch (error) {
      logger.warn({ reason: (error as Error).name }, "Caching a LID mapping failed");
    }
  }

  return {
    learn,
    async getPNForLID(lid) {
      const lidUser = lidUserOf(lid);
      if (!lidUser) return baileys.getPNForLID(lid);
      try {
        const cached = await redis.get(keyOf(lidUser));
        if (cached) return `${cached}@s.whatsapp.net`;
      } catch {
        // Fall through to Baileys' own store.
      }
      const pn = await baileys.getPNForLID(lid);
      if (pn) await learn(lid, pn);
      return pn;
    },
    async resolveClaimed(lid, code) {
      const lidUser = lidUserOf(lid);
      if (!lidUser) return null;
      const claimed = await redis.srandmember(waLidClaimKey(code), WA_LID_CLAIM_LOOKUP_MAX);
      for (const digits of claimed) {
        if (!/^\d{6,15}$/.test(digits)) continue;
        const pn = `${digits}@s.whatsapp.net`;
        const theirs = await baileys.getLIDForPN(pn).catch(() => null);
        if (theirs && lidUserOf(theirs) === lidUser) {
          await learn(lid, pn);
          return pn;
        }
      }
      return null;
    },
  };
}
