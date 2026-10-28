import { randomBytes } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { t } from "@wasfa/shared/i18n";
import {
  WA_HEARTBEAT_KEY,
  WA_REPLY_STREAM,
  waStatus,
  type ReplyOutcome,
} from "@wasfa/shared/schemas/phone";
import {
  WA_LOGOUT_WINDOW_MS,
  formatLoginToken,
  displayLoginToken,
  waLoginTokenSchema,
  type WaLoginEntry,
  type WaLoginStartResponse,
  type WaLoginStatusReason,
} from "@wasfa/shared/schemas/wa-login";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { AuditService } from "../../audit/audit.service.js";
import { REDIS } from "../../common/redis.js";
import { API_ENV } from "../../config/config.module.js";
import { SettingsService } from "../../settings/settings.service.js";

import { resolveBridgeNumber } from "./bridge-number.js";
import { createWhatsAppUser, WhatsAppSignupClosedError } from "./create-whatsapp-user.js";
import { deviceLabel } from "./device-label.js";
import { whatsappLoginRefusal } from "./refusal.js";
import { WaLoginStore, hashNonce } from "./wa-login.store.js";
import { WhatsAppLoginRepo } from "./whatsapp-login.repo.js";

import type { ApiEnv } from "../../config/env.js";

export type WaLoginUnavailableReason = "disabled" | "not_configured" | "bridge_down";

/** "Continue with WhatsApp" cannot be offered right now. */
export class WaLoginUnavailableError extends Error {
  constructor(readonly reason: WaLoginUnavailableReason) {
    super(`WhatsApp sign-in unavailable: ${reason}`);
    this.name = "WaLoginUnavailableError";
  }
}

export type PollResult =
  | { status: "pending" | "expired" }
  | { status: "refused"; reason: WaLoginStatusReason }
  | { status: "approved"; userId: string; isNew: boolean };

/** The nonce cookie holds 32 random bytes; anything much longer is not ours. */
const MAX_NONCE_LENGTH = 128;

/** The token as typed or shown (`ab12-cd34`) to the stored 8 characters, or null. */
export function normalizeLoginToken(raw: string | undefined): string | null {
  const candidate = (raw ?? "").replace(/[-\s]/g, "").toUpperCase();
  return waLoginTokenSchema.safeParse(candidate).success ? candidate : null;
}

/**
 * The business of "Continue with WhatsApp": starting a challenge for a browser, answering its polls,
 * and resolving what the bridge reports (docs/WA-SIGNUP.md). The better-auth plugin (cookies,
 * sessions) and the stream consumer are thin shells around this.
 */
@Injectable()
export class WhatsAppLoginService {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly settings: SettingsService,
    private readonly store: WaLoginStore,
    private readonly repo: WhatsAppLoginRepo,
    private readonly audit: AuditService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("WhatsAppLogin");
  }

  /** The button is drawn: the setting is on and a bridge number is configured. */
  async available(): Promise<boolean> {
    return (await this.unavailableReason()) === null;
  }

  private async unavailableReason(): Promise<WaLoginUnavailableReason | null> {
    if (!(await this.settings.get("auth")).whatsappLogin) return "disabled";
    if ((await resolveBridgeNumber(this.settings, this.env)) === undefined) return "not_configured";
    return null;
  }

  /** `POST /auth/whatsapp/start`: a challenge for this browser. The raw nonce goes into its cookie. */
  async start(userAgent: string | null | undefined): Promise<{
    response: WaLoginStartResponse;
    nonce: string;
  }> {
    const reason = await this.unavailableReason();
    if (reason !== null) throw new WaLoginUnavailableError(reason);
    if (waStatus(await this.redis.get(WA_HEARTBEAT_KEY), Date.now()) !== "connected") {
      throw new WaLoginUnavailableError("bridge_down");
    }
    const number = await resolveBridgeNumber(this.settings, this.env);
    if (number === undefined) throw new WaLoginUnavailableError("not_configured");

    const nonce = randomBytes(32).toString("base64url");
    const { token, expiresAt } = await this.store.create(hashNonce(nonce), deviceLabel(userAgent));
    const text = t("auth.whatsapp.waMessage", { token: formatLoginToken(token) });
    return {
      nonce,
      response: {
        token: displayLoginToken(token),
        waLink: `https://wa.me/${number.digits}?text=${encodeURIComponent(text)}`,
        expiresAt: new Date(expiresAt).toISOString(),
      },
    };
  }

  /**
   * `GET /auth/whatsapp/status`: what the browser that asked may be told. Anything that is not an
   * exact token + cookie match is `pending`. An approved result is re-checked against the account
   * (two-factor or a role may have appeared since the message) before a session is minted.
   */
  async poll(rawToken: string | undefined, nonce: string | undefined): Promise<PollResult> {
    const token = normalizeLoginToken(rawToken);
    if (token === null || !nonce || nonce.length > MAX_NONCE_LENGTH) return { status: "pending" };
    const result = await this.store.take(token, hashNonce(nonce));
    if (result.status !== "approved") return result;

    const account = await this.repo.findById(result.userId);
    const reason = account === null ? "inactive" : whatsappLoginRefusal(account);
    if (reason !== null) return { status: "refused", reason };
    return result;
  }

  /** Tags a freshly minted session so the chat's undo can find it. */
  tagSession(sessionId: string): Promise<void> {
    return this.repo.tagSession(sessionId);
  }

  discardSession(sessionId: string): Promise<void> {
    return this.repo.deleteSession(sessionId);
  }

  /** One entry of `wa:login:in`. Never throws for a bad claim: the sender is answered or ignored. */
  async handleEntry(entry: WaLoginEntry): Promise<void> {
    if (!(await this.settings.get("auth")).whatsappLogin) return;
    if (entry.kind === "logout") {
      await this.handleLogout(entry);
    } else {
      await this.handleLogin(entry);
    }
  }

  private async handleLogin(entry: Extract<WaLoginEntry, { kind: "login" }>): Promise<void> {
    // Excess claims from one number are ignored without a word: nothing to learn, nothing to flood.
    if (!(await this.store.allowClaim("login", entry.phone))) return;

    // pending -> claimed, once. Unknown, expired and replayed tokens all end here.
    if (!(await this.store.claim(entry.token))) {
      await this.reply(entry, "login_expired");
      return;
    }

    try {
      const created = await createWhatsAppUser(
        {
          repo: this.repo,
          signupOpen: async () => {
            const access = await this.settings.get("access");
            return access.signupOpen && !access.maintenanceMode;
          },
          onSetupFailed: (userId) => {
            this.logger.error(`Invite code setup failed for user ${userId}`);
          },
        },
        { phone: entry.phone, name: entry.pushName },
      );

      const reason = created.existing ? whatsappLoginRefusal(created.existing) : null;
      if (reason !== null) {
        await this.store.settle(entry.token, { status: "refused", reason });
        await this.reply(entry, "login_refused");
        return;
      }
      await this.store.settle(entry.token, {
        status: "approved",
        userId: created.userId,
        isNew: created.isNew,
      });
      if (created.isNew) await this.recordSignup(created.userId);
      await this.reply(entry, "login_ok");
    } catch (error) {
      if (error instanceof WhatsAppSignupClosedError) {
        // The page says so; the chat stays quiet rather than pointing at a password that does not exist.
        await this.store.settle(entry.token, { status: "refused", reason: "signup_closed" });
        return;
      }
      throw error;
    }
  }

  /** The undo word: every WhatsApp-born session of the last 24 h goes; the answer is the same either way. */
  private async handleLogout(entry: Extract<WaLoginEntry, { kind: "logout" }>): Promise<void> {
    if (!(await this.store.allowClaim("logout", entry.phone))) return;
    const account = await this.repo.findByVerifiedPhone(entry.phone);
    if (account) {
      const since = new Date(Date.now() - WA_LOGOUT_WINDOW_MS);
      await this.repo.revokeWhatsAppSessions(account.id, since);
    }
    await this.reply(entry, "logout_ok");
  }

  private async recordSignup(userId: string): Promise<void> {
    try {
      await this.audit.record(
        {
          actorId: userId,
          action: "auth.signup",
          targetType: "user",
          targetId: userId,
          after: { signupMethod: "whatsapp" },
        },
        { verbatim: true },
      );
    } catch {
      this.logger.error(`Sign-up audit could not be written for user ${userId}`);
    }
  }

  private async reply(entry: WaLoginEntry, outcome: ReplyOutcome): Promise<void> {
    await this.redis.xadd(
      WA_REPLY_STREAM,
      "MAXLEN",
      "~",
      1_000,
      "*",
      "data",
      JSON.stringify({ inboundId: entry.id, jid: entry.jid, outcome }),
    );
  }
}
