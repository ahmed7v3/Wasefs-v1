import { randomInt, timingSafeEqual } from "node:crypto";

import {
  PHONE_CODE_LENGTH,
  PHONE_VERIFY_TTL_SECONDS,
  WA_REPLY_STREAM,
  verificationMessage,
  type InboundMessage,
  type PhoneVerifyStatus,
  type ReplyOutcome,
} from "@wasfa/shared/schemas/phone";

import { identifierKey } from "../auth/rate-limiter.js";

import type { PhoneRepo } from "./phone.repo.js";
import type { Locale } from "@wasfa/shared/i18n";
import type { Redis } from "ioredis";

export interface StartedVerification {
  /** Not a secret: the proof is the sender of the message, not knowing this. */
  code: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  /** Text pre-filled into the chat. */
  text: string;
}

export interface VerificationState {
  status: PhoneVerifyStatus;
  phone?: string;
  expiresAt?: number;
  /** Set when `status` is `failed`. */
  failureReason?: "phone_in_use";
}

/**
 * How a phone number gets proven. `WhatsAppInboundVerifier` is the first implementation; a Meta
 * Cloud API or SMS verifier can sit behind the same interface when the number or the budget changes.
 */
export interface PhoneVerifier {
  readonly method: "whatsapp_inbound";
  start: (input: { userId: string; phone: string; locale: Locale }) => Promise<StartedVerification>;
  status: (userId: string) => Promise<VerificationState>;
}

interface Challenge {
  phone: string;
  code: string;
  expiresAt: number;
}

export interface InboundResult {
  outcome: ReplyOutcome | "ignored";
  userId?: string;
}

const MAX_CODE_ATTEMPTS = 5;
/** More wrong claims than this per sender and hour: log it, and stop answering that sender. */
const ABUSE_LOG_THRESHOLD = 10;
const ABUSE_SILENCE_THRESHOLD = 5;
const CLOCK_SKEW_MS = 5_000;

const phoneHash = identifierKey;

/**
 * Reverse OTP over WhatsApp. `start` creates a challenge (code, 10 minutes). The user sends that
 * code from their own WhatsApp; the bridge reports `{ sender phone, code }`; `handleInbound`
 * resolves the challenge only if the code AND the sender number match the one that was claimed.
 *
 * Keys: `phone:ch:<user>` the challenge; `phone:code:<hash(phone)>:<code>` -> user (looked up by the
 * inbound message, deleted atomically so a code works once); `phone:result:<user>` the outcome the
 * status endpoint shows; `phone:abuse:<hash(sender)>` wrong claims per hour.
 */
export class WhatsAppInboundVerifier implements PhoneVerifier {
  readonly method = "whatsapp_inbound";

  constructor(
    private readonly redis: Redis,
    private readonly repo: PhoneRepo,
    private readonly log: (level: "info" | "warn", message: string) => void,
    private readonly now: () => number = Date.now,
  ) {}

  async start(input: {
    userId: string;
    phone: string;
    locale: Locale;
  }): Promise<StartedVerification> {
    const { userId, phone, locale } = input;
    await this.cancel(userId);

    const expiresAt = this.now() + PHONE_VERIFY_TTL_SECONDS * 1000;
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const code = String(randomInt(0, 10 ** PHONE_CODE_LENGTH)).padStart(PHONE_CODE_LENGTH, "0");
      // `NX`: two users claiming the same number must not share a code.
      const taken = await this.redis.set(
        this.codeKey(phone, code),
        userId,
        "EX",
        PHONE_VERIFY_TTL_SECONDS,
        "NX",
      );
      if (taken !== "OK") continue;
      const challenge: Challenge = { phone, code, expiresAt };
      await this.redis
        .multi()
        .set(`phone:ch:${userId}`, JSON.stringify(challenge), "EX", PHONE_VERIFY_TTL_SECONDS)
        .del(`phone:result:${userId}`)
        .exec();
      return { code, expiresAt, text: verificationMessage(code, locale) };
    }
    throw new Error("Could not allocate a verification code");
  }

  async status(userId: string): Promise<VerificationState> {
    const result = await this.redis.get(`phone:result:${userId}`);
    if (result === "taken") return { status: "failed", failureReason: "phone_in_use" };

    const challenge = await this.challenge(userId);
    if (challenge && challenge.expiresAt > this.now()) {
      return { status: "pending", phone: challenge.phone, expiresAt: challenge.expiresAt };
    }
    const user = await this.repo.findUser(userId);
    if (user?.phoneVerified && user.phone) return { status: "verified", phone: user.phone };
    return { status: "none" };
  }

  /** Resolves one message from the bridge. Safe to run twice for the same message. */
  async handleInbound(message: InboundMessage): Promise<InboundResult> {
    // GETDEL: the first reader wins, a replay finds nothing.
    const userId = await this.redis.getdel(this.codeKey(message.phone, message.code));
    if (userId === null) return { outcome: await this.recordWrongClaim(message.phone) };

    const challenge = await this.challenge(userId);
    const valid =
      challenge !== null &&
      sameString(challenge.code, message.code) &&
      sameString(challenge.phone, message.phone) &&
      message.receivedAt <= challenge.expiresAt + CLOCK_SKEW_MS;
    if (!valid) return { outcome: "invalid", userId };

    await this.redis.del(`phone:ch:${userId}`);
    const verified = await this.repo.markVerified(userId, message.phone);
    if (verified === "taken") {
      await this.redis.set(`phone:result:${userId}`, "taken", "EX", PHONE_VERIFY_TTL_SECONDS);
      this.log("info", "Phone verification refused: number already verified on another account");
      return { outcome: "invalid", userId };
    }
    await this.redis.set(`phone:result:${userId}`, "verified", "EX", PHONE_VERIFY_TTL_SECONDS);
    return { outcome: "verified", userId };
  }

  /** Asks the bridge to answer an inbound message with one of its two fixed sentences. */
  async requestReply(message: InboundMessage, outcome: ReplyOutcome): Promise<void> {
    await this.redis.xadd(
      WA_REPLY_STREAM,
      "MAXLEN",
      "~",
      1_000,
      "*",
      "data",
      JSON.stringify({ inboundId: message.id, jid: message.jid, outcome }),
    );
  }

  /** Whether a sender has sent so many wrong codes that we stop answering them. */
  async isSilenced(sender: string): Promise<boolean> {
    const count = Number((await this.redis.get(`phone:abuse:${phoneHash(sender)}`)) ?? 0);
    return count > ABUSE_SILENCE_THRESHOLD;
  }

  private async cancel(userId: string): Promise<void> {
    const previous = await this.challenge(userId);
    if (previous) await this.redis.del(this.codeKey(previous.phone, previous.code));
  }

  private async challenge(userId: string): Promise<Challenge | null> {
    const raw = await this.redis.get(`phone:ch:${userId}`);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as Challenge;
    } catch {
      return null;
    }
  }

  private codeKey(phone: string, code: string): string {
    return `phone:code:${phoneHash(phone)}:${code}`;
  }

  /** A code nobody asked for from this number: wrong sender, expired, or already used. */
  private async recordWrongClaim(sender: string): Promise<"invalid"> {
    const key = `phone:abuse:${phoneHash(sender)}`;
    const results = await this.redis.multi().incr(key).expire(key, 3_600, "NX").exec();
    const count = Number(results?.[0]?.[1]);
    if (count === ABUSE_LOG_THRESHOLD) {
      // Hashed on purpose; the phone number never goes into a log line.
      this.log("warn", "Repeated wrong verification codes from one sender in the last hour");
    }
    return "invalid";
  }
}

function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
