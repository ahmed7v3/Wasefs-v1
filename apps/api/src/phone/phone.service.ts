import { Inject, Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { WA_HEARTBEAT_KEY, waStatus, type WaStatus } from "@wasfa/shared/schemas/phone";
import { Redis } from "ioredis";

import { AuthRateLimiter, identifierKey } from "../auth/rate-limiter.js";
import { TurnstileService } from "../auth/turnstile.js";
import { resolveBridgeNumber } from "../auth/whatsapp-login/bridge-number.js";
import { REDIS } from "../common/redis.js";
import { API_ENV } from "../config/config.module.js";
import { SettingsService } from "../settings/settings.service.js";

import { PhoneRepo } from "./phone.repo.js";
import { PHONE_VERIFIER } from "./phone.tokens.js";

import type { PhoneVerifier, VerificationState } from "./phone-verifier.js";
import type { ApiEnv } from "../config/env.js";

const HOUR = 60 * 60;
/** Starts per hour: per user, per phone number, and per IP. */
const START_LIMIT = 3;

export interface Availability {
  /** Phone verification can be offered right now. The UI hides it otherwise; email verification still works. */
  available: boolean;
  /** Why not: switched off by an admin, no number configured, or the bridge is down or logged out. */
  unavailableReason?: "disabled" | "not_configured" | "bridge_down";
  bridge: WaStatus;
}

export interface StartResult {
  status: "pending" | "verified";
  code?: string;
  expiresAt?: string;
  /** `https://wa.me/<number>?text=<pre-filled code message>`; also rendered as a QR code on desktop. */
  waLink?: string;
  waNumber?: string;
}

@Injectable()
export class PhoneService {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PHONE_VERIFIER) private readonly verifier: PhoneVerifier,
    private readonly repo: PhoneRepo,
    private readonly settings: SettingsService,
    private readonly limiter: AuthRateLimiter,
    private readonly turnstile: TurnstileService,
  ) {}

  async availability(): Promise<Availability> {
    const bridge = await this.bridgeStatus();
    if ((await this.settings.get("auth")).phoneVerification !== "whatsapp_inbound") {
      return { available: false, unavailableReason: "disabled", bridge };
    }
    if ((await this.whatsappNumber()) === undefined) {
      return { available: false, unavailableReason: "not_configured", bridge };
    }
    if (bridge !== "connected")
      return { available: false, unavailableReason: "bridge_down", bridge };
    return { available: true, bridge };
  }

  async start(
    user: { id: string },
    phone: string,
    context: { ip: string; turnstileToken: string | undefined },
  ): Promise<StartResult> {
    const availability = await this.availability();
    if (!availability.available) {
      throw new AppError(
        availability.unavailableReason === "bridge_down"
          ? ErrorCode.UPSTREAM_UNAVAILABLE
          : ErrorCode.FORBIDDEN,
        {
          details: {
            reason: `phone_verification_${availability.unavailableReason ?? "unavailable"}`,
          },
        },
      );
    }
    const account = await this.repo.findUser(user.id);
    if (!account) throw new AppError(ErrorCode.AUTH_REQUIRED);
    if (account.phoneVerified && account.phone === phone) return { status: "verified" };

    // Limits first, so a bot cannot spend our Turnstile quota; all of them fail closed.
    await this.limiter.hit(`phone:start:user:${user.id}`, START_LIMIT, HOUR);
    await this.limiter.hit(`phone:start:phone:${identifierKey(phone)}`, START_LIMIT, HOUR);
    await this.limiter.hit(`phone:start:ip:${context.ip}`, START_LIMIT, HOUR);
    if (this.turnstile.enabled) {
      if (!context.turnstileToken) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, {
          details: { reason: "turnstile_required" },
        });
      }
      if (!(await this.turnstile.verify(context.turnstileToken, context.ip))) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, {
          details: { reason: "turnstile_failed" },
        });
      }
    }

    const started = await this.verifier.start({ userId: user.id, phone, locale: account.locale });
    const number = (await this.whatsappNumber())?.digits ?? "";
    return {
      status: "pending",
      code: started.code,
      expiresAt: new Date(started.expiresAt).toISOString(),
      waLink: `https://wa.me/${number}?text=${encodeURIComponent(started.text)}`,
      waNumber: `+${number}`,
    };
  }

  async status(user: { id: string }): Promise<VerificationState & Availability> {
    const [state, availability] = await Promise.all([
      this.verifier.status(user.id),
      this.availability(),
    ]);
    return { ...state, ...availability };
  }

  /**
   * The number users send their code to: the admin's setting first, `WHATSAPP_NUMBER` as the
   * fallback. Digits with country code, no `+` (what `wa.me` takes).
   */
  async whatsappNumber(): Promise<{ digits: string; source: "setting" | "env" } | undefined> {
    return resolveBridgeNumber(this.settings, this.env);
  }

  private async bridgeStatus(): Promise<WaStatus> {
    try {
      return waStatus(await this.redis.get(WA_HEARTBEAT_KEY));
    } catch {
      // Cannot read Redis: report the bridge as down rather than failing the status call.
      return "down";
    }
  }
}
