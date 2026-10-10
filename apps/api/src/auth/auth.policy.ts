import { Inject, Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  changePasswordSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  sendVerificationEmailSchema,
  signInEmailSchema,
  signInPhoneSchema,
  signInSocialSchema,
  signUpEmailSchema,
  signUpPhoneSchema,
  twoFactorDisableSchema,
  twoFactorEnableSchema,
  twoFactorGenerateBackupCodesSchema,
  twoFactorVerifyBackupCodeSchema,
  twoFactorVerifyTotpSchema,
} from "@wasfa/shared/schemas/auth";

import { API_ENV } from "../config/config.module.js";

import { AuthSettingsReader } from "./auth-settings.reader.js";
import { isProviderEnabled } from "./providers.js";
import { AuthRateLimiter, identifierKey } from "./rate-limiter.js";
import { TurnstileService } from "./turnstile.js";

import type { ApiEnv } from "../config/env.js";
import type { ZodType } from "zod";

const MINUTE = 60;
const FIFTEEN_MINUTES = 15 * MINUTE;
const HOUR = 60 * MINUTE;

interface Limit {
  max: number;
  windowSeconds: number;
}

export interface AuthRoute {
  method: "GET" | "POST";
  /** Path below `/auth`, with `:name` segments. */
  pattern: string;
  /** Strict body schema (POST). Unknown keys are dropped before Better Auth sees the body. */
  body?: ZodType;
  /** Routes sharing a bucket share their counters (login by email and by phone count together). */
  bucket: string;
  perIp?: Limit;
  perIdentifier?: Limit;
  /** Which body field identifies the account being attacked or spammed. */
  identifier?: "email" | "phoneNumber";
  turnstile?: "always" | "after-failures";
  /** Sign-ins: failed attempts are counted per identifier, and a success clears them. */
  tracksFailures?: boolean;
  /** Social routes: the provider (from the body or the `:id` segment) must be `enabled`. */
  provider?: "body" | "param";
  /** Security event written to `audit_logs` when this route succeeds (actor = the signed-in caller). */
  audit?: string;
  /** Field a password complaint should point at. */
  passwordField?: string;
  /** Query parameters forwarded to Better Auth; everything else is dropped. `*` forwards all. */
  query?: readonly string[] | "*";
}

const AFTER_FAILURES_THRESHOLD = 3;
const IP_LOGIN: Limit = { max: 10, windowSeconds: FIFTEEN_MINUTES };
const ID_LOGIN: Limit = { max: 5, windowSeconds: FIFTEEN_MINUTES };
const IP_REGISTER: Limit = { max: 5, windowSeconds: HOUR };
const ID_MAIL: Limit = { max: 3, windowSeconds: HOUR };
const IP_MAIL: Limit = { max: 10, windowSeconds: HOUR };
const IP_LINK: Limit = { max: 20, windowSeconds: FIFTEEN_MINUTES };
const IP_TOTP: Limit = { max: 20, windowSeconds: FIFTEEN_MINUTES };

/**
 * The complete list of Better Auth endpoints that are reachable. Deny by default: everything else
 * Better Auth (or a plugin) ships, such as its phone OTP routes, user update/delete, account
 * linking, session listing and admin routes, answers 404. `/me` and the session endpoints of Task
 * 1.7 are ours and do not go through Better Auth's HTTP surface.
 */
export const AUTH_ROUTES: readonly AuthRoute[] = [
  {
    method: "POST",
    pattern: "/sign-up/email",
    bucket: "register",
    body: signUpEmailSchema,
    perIp: IP_REGISTER,
    identifier: "email",
    turnstile: "always",
    passwordField: "password",
  },
  {
    method: "POST",
    pattern: "/sign-up/phone-number",
    bucket: "register",
    body: signUpPhoneSchema,
    perIp: IP_REGISTER,
    identifier: "phoneNumber",
    turnstile: "always",
    passwordField: "password",
  },
  {
    method: "POST",
    pattern: "/sign-in/email",
    bucket: "login",
    body: signInEmailSchema,
    perIp: IP_LOGIN,
    perIdentifier: ID_LOGIN,
    identifier: "email",
    turnstile: "after-failures",
    tracksFailures: true,
  },
  {
    method: "POST",
    pattern: "/sign-in/phone-number",
    bucket: "login",
    body: signInPhoneSchema,
    perIp: IP_LOGIN,
    perIdentifier: ID_LOGIN,
    identifier: "phoneNumber",
    turnstile: "after-failures",
    tracksFailures: true,
  },
  {
    method: "POST",
    pattern: "/sign-in/social",
    bucket: "social",
    body: signInSocialSchema,
    perIp: IP_LINK,
    provider: "body",
  },
  {
    method: "GET",
    pattern: "/callback/:id",
    bucket: "social-callback",
    perIp: { max: 30, windowSeconds: FIFTEEN_MINUTES },
    provider: "param",
    query: "*",
  },
  {
    method: "POST",
    pattern: "/sign-out",
    bucket: "sign-out",
    perIp: { max: 60, windowSeconds: FIFTEEN_MINUTES },
  },
  {
    method: "GET",
    pattern: "/verify-email",
    bucket: "verify-link",
    perIp: IP_LINK,
    query: ["token", "callbackURL"],
  },
  {
    method: "POST",
    pattern: "/send-verification-email",
    bucket: "verify-mail",
    body: sendVerificationEmailSchema,
    perIp: IP_MAIL,
    perIdentifier: ID_MAIL,
    identifier: "email",
    turnstile: "always",
  },
  {
    method: "POST",
    pattern: "/request-password-reset",
    bucket: "reset",
    body: requestPasswordResetSchema,
    perIp: IP_MAIL,
    perIdentifier: ID_MAIL,
    identifier: "email",
    turnstile: "always",
  },
  {
    method: "GET",
    pattern: "/reset-password/:token",
    bucket: "reset-link",
    perIp: IP_LINK,
    query: ["callbackURL"],
  },
  {
    method: "POST",
    pattern: "/reset-password",
    bucket: "reset-apply",
    body: resetPasswordSchema,
    perIp: IP_LINK,
    passwordField: "newPassword",
  },
  {
    method: "POST",
    pattern: "/change-password",
    bucket: "change-password",
    audit: "auth.password_change",
    body: changePasswordSchema,
    perIp: { max: 10, windowSeconds: FIFTEEN_MINUTES },
    passwordField: "newPassword",
  },
  {
    method: "POST",
    pattern: "/two-factor/enable",
    bucket: "2fa",
    audit: "auth.two_factor_enable",
    body: twoFactorEnableSchema,
    perIp: IP_TOTP,
  },
  {
    method: "POST",
    pattern: "/two-factor/disable",
    bucket: "2fa",
    audit: "auth.two_factor_disable",
    body: twoFactorDisableSchema,
    perIp: IP_TOTP,
  },
  {
    method: "POST",
    pattern: "/two-factor/generate-backup-codes",
    bucket: "2fa",
    audit: "auth.backup_codes_regenerate",
    body: twoFactorGenerateBackupCodesSchema,
    perIp: IP_TOTP,
  },
  {
    method: "POST",
    pattern: "/two-factor/verify-totp",
    bucket: "2fa",
    body: twoFactorVerifyTotpSchema,
    perIp: IP_TOTP,
  },
  {
    method: "POST",
    pattern: "/two-factor/verify-backup-code",
    bucket: "2fa",
    body: twoFactorVerifyBackupCodeSchema,
    perIp: IP_TOTP,
  },
];

export interface RouteMatch {
  route: AuthRoute;
  params: Record<string, string>;
}

/** Finds the allowlisted route for a method and a path below `/auth`; `undefined` means 404. */
export function matchAuthRoute(method: string, path: string): RouteMatch | undefined {
  const segments = path.split("/");
  for (const route of AUTH_ROUTES) {
    if (route.method !== method) continue;
    const pattern = route.pattern.split("/");
    if (pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const matches = pattern.every((part, index) => {
      const segment = segments[index] ?? "";
      if (part.startsWith(":")) {
        if (segment === "") return false;
        params[part.slice(1)] = segment;
        return true;
      }
      return part === segment;
    });
    if (matches) return { route, params };
  }
  return undefined;
}

export interface RequestFacts {
  ip: string;
  body: Record<string, unknown> | undefined;
  params: Record<string, string>;
  turnstileToken: string | undefined;
}

/**
 * The checks every auth request passes before Better Auth sees it, in a fixed order that makes the
 * cheapest and least abusable ones run first: provider status, per-IP and per-identifier rate
 * limits, then Turnstile (so bots cannot use our Turnstile quota as an amplifier). Responses never
 * depend on whether an account exists.
 */
@Injectable()
export class AuthPolicy {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly limiter: AuthRateLimiter,
    private readonly turnstile: TurnstileService,
    private readonly settings: AuthSettingsReader,
  ) {}

  /** Is this provider enabled right now? Used by the controller to redirect callbacks of disabled ones. */
  async providerEnabled(id: string): Promise<boolean> {
    return isProviderEnabled(this.env, await this.settings.auth(), id);
  }

  async enforce(match: RouteMatch, facts: RequestFacts): Promise<void> {
    const { route } = match;

    if (route.provider === "body") {
      const provider = facts.body?.["provider"];
      if (typeof provider !== "string" || !(await this.providerEnabled(provider))) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, {
          details: { fields: ["provider"], reason: "provider_unavailable" },
        });
      }
    }

    if (route.perIp) {
      await this.limiter.hit(
        `${route.bucket}:ip:${facts.ip}`,
        route.perIp.max,
        route.perIp.windowSeconds,
      );
    }
    const identifier = this.identifierOf(route, facts);
    if (route.perIdentifier && identifier !== undefined) {
      await this.limiter.hit(
        `${route.bucket}:id:${identifierKey(identifier)}`,
        route.perIdentifier.max,
        route.perIdentifier.windowSeconds,
      );
    }

    if (this.turnstile.enabled && (await this.turnstileRequired(route, identifier))) {
      if (!facts.turnstileToken) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, {
          details: { reason: "turnstile_required" },
        });
      }
      if (!(await this.turnstile.verify(facts.turnstileToken, facts.ip))) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, {
          details: { reason: "turnstile_failed" },
        });
      }
    }
  }

  /** After Better Auth answered: count a failed sign-in, or forget the failures on success. */
  async recordOutcome(match: RouteMatch, facts: RequestFacts, status: number): Promise<void> {
    if (!match.route.tracksFailures) return;
    const identifier = this.identifierOf(match.route, facts);
    if (identifier === undefined) return;
    if (status >= 200 && status < 300) {
      await this.limiter.clearFailures(identifier);
    } else if (status >= 400 && status < 500 && status !== 429) {
      await this.limiter.recordFailure(identifier);
    }
  }

  private identifierOf(route: AuthRoute, facts: RequestFacts): string | undefined {
    if (!route.identifier) return undefined;
    const value = facts.body?.[route.identifier];
    return typeof value === "string" ? value : undefined;
  }

  private async turnstileRequired(
    route: AuthRoute,
    identifier: string | undefined,
  ): Promise<boolean> {
    if (route.turnstile === "always") return true;
    if (route.turnstile === "after-failures" && identifier !== undefined) {
      return (await this.limiter.failures(identifier)) >= AFTER_FAILURES_THRESHOLD;
    }
    return false;
  }
}
