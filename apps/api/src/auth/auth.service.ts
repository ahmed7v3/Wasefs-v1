import { Inject, Injectable } from "@nestjs/common";
import { sessions, users } from "@wasfa/db";
import { eq } from "drizzle-orm";

import { DB, type DbHandle } from "../common/database.js";

import { ADMIN_SESSION_SECONDS, holdsPlatformRole, type AuthInstance } from "./auth.config.js";

import type { IncomingHttpHeaders } from "node:http";

export const AUTH = Symbol("AUTH");

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
}

export interface ResolvedSession {
  sessionId: string;
  user: SessionUser;
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
 * The one place the rest of the API turns a cookie into a user (the auth guard of Task 1.6 and
 * `/me` of Task 1.7 build on it). Suspended and deleted users resolve to `null` and their session
 * rows are removed, so a suspension also ends sessions that were opened before it.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH) private readonly auth: AuthInstance,
    @Inject(DB) private readonly handle: DbHandle,
  ) {}

  async getSession(headers: IncomingHttpHeaders): Promise<ResolvedSession | null> {
    const found = await this.auth.api.getSession({ headers: toHeaders(headers) });
    if (!found) return null;
    const { session, user } = found;

    // Better Auth does not expose our own columns, so read the status ourselves.
    const [row] = await this.handle.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, user.id));
    if (row?.status !== "active") {
      await this.handle.db.delete(sessions).where(eq(sessions.userId, user.id));
      return null;
    }

    // Admin sessions are absolute: Better Auth's sliding refresh must not stretch them past 12 hours.
    if (await holdsPlatformRole(this.handle.db, user.id)) {
      const age = Date.now() - new Date(session.createdAt).getTime();
      if (age > ADMIN_SESSION_SECONDS * 1000) {
        await this.handle.db.delete(sessions).where(eq(sessions.id, session.id));
        return null;
      }
    }

    return {
      sessionId: session.id,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        twoFactorEnabled: (user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled === true,
      },
    };
  }
}
