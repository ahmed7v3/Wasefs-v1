import { Inject, Injectable } from "@nestjs/common";
import { ReferralError } from "@wasfa/db";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  REFERRAL_COOKIE,
  REFERRAL_COOKIE_MAX_AGE_DAYS,
} from "@wasfa/shared/rewards";

import { API_ENV } from "../config/config.module.js";

import { ReferralsRepo } from "./referrals.repo.js";

import type { ApiEnv } from "../config/env.js";
import type { MeReferral } from "@wasfa/shared/schemas/rewards";

export interface InviteLanding {
  /** Where the visitor goes next: the register page, with the code when it is real. */
  location: string;
  /** The `Set-Cookie` value, only for a code that exists. */
  cookie: string | null;
}

const DAY_SECONDS = 86_400;

/** The caller's invite code and the public `/r/<code>` landing. */
@Injectable()
export class ReferralsService {
  constructor(
    private readonly repo: ReferralsRepo,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private webOrigin(): string {
    return this.env.WEB_ORIGIN[0] ?? "";
  }

  /** The shareable link of a code (the web app forwards `/r/*` to the api). */
  linkFor(code: string): string {
    return `${this.webOrigin()}/r/${code}`;
  }

  /** `GET /me/referral`: the personal code, created on first call. */
  async mine(userId: string): Promise<MeReferral> {
    const row = await this.repo.ensureCode(userId);
    return { code: row.code, link: this.linkFor(row.code), vanityEdited: row.vanityEdited };
  }

  /** `PATCH /me/referral`: the one-time vanity edit. */
  async rename(userId: string, code: string): Promise<MeReferral> {
    try {
      const row = await this.repo.rename(userId, code);
      return { code: row.code, link: this.linkFor(row.code), vanityEdited: row.vanityEdited };
    } catch (error) {
      if (!(error instanceof ReferralError)) throw error;
      switch (error.reason) {
        case "vanity_used":
        case "code_taken":
          throw new AppError(ErrorCode.CONFLICT, { details: { reason: error.reason } });
        case "reserved_code":
        case "invalid_code":
          throw new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: ["code"] } });
        case "program_missing":
          throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, { cause: error });
      }
    }
  }

  /**
   * `GET /r/<code>`: the cookie (30 days, first-party) and the redirect to the register page. A code
   * nobody owns redirects to a plain register page and sets nothing.
   */
  async landing(rawCode: string): Promise<InviteLanding> {
    const register = `${this.webOrigin()}/register`;
    const found = await this.repo.findActive(rawCode);
    if (!found) return { location: register, cookie: null };
    const attributes = [
      `${REFERRAL_COOKIE}=${found.code}`,
      `Max-Age=${String(REFERRAL_COOKIE_MAX_AGE_DAYS * DAY_SECONDS)}`,
      "Path=/",
      "SameSite=Lax",
      "Secure",
      // Shared with the web host when the auth cookies are (so the register form and the api both see it).
      ...(this.env.AUTH_COOKIE_DOMAIN ? [`Domain=${this.env.AUTH_COOKIE_DOMAIN}`] : []),
    ];
    return {
      location: `${register}?ref=${encodeURIComponent(found.code)}`,
      cookie: attributes.join("; "),
    };
  }
}
