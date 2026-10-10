import { Inject, Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { ADMIN_SESSION_SECONDS, type AuthInstance } from "./auth.config.js";
import { AuthRepo } from "./auth.repo.js";
import { PASSWORD_HASHER, type PasswordHasher } from "./password.js";
import { AuthRateLimiter } from "./rate-limiter.js";

import type { IncomingHttpHeaders } from "node:http";

export const AUTH = Symbol("AUTH");

const REAUTH_WINDOW_SECONDS = 15 * 60;

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  phoneVerified: boolean;
}

export interface ResolvedSession {
  sessionId: string;
  user: SessionUser;
  createdAt: Date;
  /** Last time the person proved who they are in this session (creation, or `POST /auth/reauth`). */
  reauthAt: Date;
  /** Set when the session came out of a completed two-factor challenge. */
  mfaVerifiedAt: Date | null;
}

/** Converts Node request headers into the `Headers` Better Auth expects. */
export function toHeaders(source: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

/**
 * The one place the rest of the API turns a cookie into a user (the global `AuthGuard` builds on
 * it). Suspended and deleted users resolve to `null` and their session rows are removed, so a
 * suspension also ends sessions that were opened before it.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH) private readonly auth: AuthInstance,
    private readonly repo: AuthRepo,
    private readonly limiter: AuthRateLimiter,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasher,
  ) {}

  async getSession(headers: IncomingHttpHeaders): Promise<ResolvedSession | null> {
    const found = await this.auth.api.getSession({ headers: toHeaders(headers) });
    if (!found) return null;
    const { session, user } = found;

    // Better Auth does not expose our own columns, so read them ourselves.
    const row = await this.repo.userRow(user.id);
    if (row?.status !== "active") {
      await this.repo.deleteUserSessions(user.id);
      return null;
    }

    // Admin sessions are absolute: Better Auth's sliding refresh must not stretch them past 12 hours.
    if (await this.repo.holdsPlatformRole(user.id)) {
      const age = Date.now() - new Date(session.createdAt).getTime();
      if (age > ADMIN_SESSION_SECONDS * 1000) {
        await this.repo.deleteSession(session.id);
        return null;
      }
    }

    const assurance = await this.repo.sessionRow(session.id);
    if (!assurance) return null;

    return {
      sessionId: session.id,
      createdAt: new Date(session.createdAt),
      reauthAt: assurance.reauthAt,
      mfaVerifiedAt: assurance.mfaVerifiedAt,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        twoFactorEnabled: (user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled === true,
        phoneVerified: row.phoneVerified,
      },
    };
  }

  /**
   * "Confirm it is you": checks the password of the signed-in user and stamps the session, which is
   * what `@RequireFreshAuth` looks at. Limited per user and per IP (failing closed). An account that
   * has no password (Google only) cannot do this: it signs in again instead, which stamps a new session.
   */
  async reauthenticate(
    headers: IncomingHttpHeaders,
    password: string,
    ip: string,
  ): Promise<{ reauthAt: Date }> {
    const session = await this.getSession(headers);
    if (!session) throw new AppError(ErrorCode.AUTH_REQUIRED);

    await this.limiter.hit(`reauth:user:${session.user.id}`, 5, REAUTH_WINDOW_SECONDS);
    await this.limiter.hit(`reauth:ip:${ip}`, 20, REAUTH_WINDOW_SECONDS);

    const stored = await this.repo.credentialHash(session.user.id);
    // Always one verification, so "no password on this account" costs the same as a wrong one.
    const matches = await this.passwords.verify({
      hash: stored ?? (await this.passwords.dummyHash()),
      password,
    });
    if (stored === undefined || !matches) {
      throw new AppError(ErrorCode.AUTH_REQUIRED, { details: { reason: "invalid_credentials" } });
    }
    const reauthAt = new Date();
    await this.repo.markReauthenticated(session.sessionId, reauthAt);
    return { reauthAt };
  }
}
