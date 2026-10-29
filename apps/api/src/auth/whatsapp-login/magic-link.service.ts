import { createHash, randomBytes } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { Redis } from "ioredis";

import { REDIS } from "../../common/redis.js";
import { API_ENV } from "../../config/config.module.js";
import { AuthRateLimiter } from "../rate-limiter.js";

import { whatsappLoginRefusal } from "./refusal.js";
import { WhatsAppLoginRepo } from "./whatsapp-login.repo.js";

import type { ApiEnv } from "../../config/env.js";

export const MAGIC_LINK_TTL_SECONDS = 15 * 60;
/** Links per user and hour: the agent cannot be used to flood someone with sign-in links. */
const LINKS_PER_HOUR = 3;
const HOUR_SECONDS = 60 * 60;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface IssuedMagicLink {
  /** `<WEB_ORIGIN>/auth/whatsapp/link#t=<token>`: the token rides in the fragment, which no server sees. */
  url: string;
  expiresAt: Date;
}

/** The key never holds the token itself: only its SHA-256. */
const magicKey = (token: string): string =>
  `wa:magic:${createHash("sha256").update(token).digest("hex")}`;

/**
 * One-time sign-in links the WhatsApp agent hands out (docs/WA-SIGNUP.md section 3). Issuing is
 * limited to 3 per user per hour; redeeming is a single `GETDEL`, so a link works once and an
 * unknown, expired and used token are indistinguishable. Privileged accounts are refused at redeem
 * time too (2FA may have been switched on after the link was made).
 */
@Injectable()
export class MagicLinkService {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly limiter: AuthRateLimiter,
    private readonly repo: WhatsAppLoginRepo,
  ) {}

  /** Throws `RATE_LIMITED` past 3 links an hour for this user. */
  async issue(userId: string, options: { isNew?: boolean } = {}): Promise<IssuedMagicLink> {
    await this.limiter.hit(`wa-magic:user:${userId}`, LINKS_PER_HOUR, HOUR_SECONDS);
    const token = randomBytes(32).toString("base64url");
    const now = Date.now();
    await this.redis.set(
      magicKey(token),
      JSON.stringify({ userId, isNew: options.isNew === true, createdAt: now }),
      "EX",
      MAGIC_LINK_TTL_SECONDS,
    );
    return {
      url: `${this.env.WEB_ORIGIN[0] ?? ""}/auth/whatsapp/link#t=${token}`,
      expiresAt: new Date(now + MAGIC_LINK_TTL_SECONDS * 1000),
    };
  }

  /** The account a valid, unused token belongs to (consumed on the way), or null for anything else. */
  async redeem(token: string): Promise<{ userId: string; isNew: boolean } | null> {
    if (!TOKEN_PATTERN.test(token)) return null;
    const raw = await this.redis.getdel(magicKey(token));
    if (raw === null) return null;
    let stored: { userId?: unknown; isNew?: unknown };
    try {
      stored = JSON.parse(raw) as typeof stored;
    } catch {
      return null;
    }
    if (typeof stored.userId !== "string") return null;
    const account = await this.repo.findById(stored.userId);
    if (account === null || whatsappLoginRefusal(account) !== null) return null;
    return { userId: stored.userId, isNew: stored.isNew === true };
  }
}
