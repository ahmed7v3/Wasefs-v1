import { Inject, Injectable } from "@nestjs/common";
import { accounts, sessions, users } from "@wasfa/db";
import { and, eq } from "drizzle-orm";

import { DB, type DbHandle } from "../common/database.js";

import { holdsPlatformRole } from "./auth.config.js";

export interface AuthUserRow {
  status: string;
  phoneVerified: boolean;
}

export interface SessionRow {
  reauthAt: Date;
  mfaVerifiedAt: Date | null;
}

/** The queries behind `AuthService`: sessions, account status and the credential hash. */
@Injectable()
export class AuthRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async userRow(userId: string): Promise<AuthUserRow | undefined> {
    const [row] = await this.handle.db
      .select({ status: users.status, phoneVerified: users.phoneVerified })
      .from(users)
      .where(eq(users.id, userId));
    return row;
  }

  async sessionRow(sessionId: string): Promise<SessionRow | undefined> {
    const [row] = await this.handle.db
      .select({ reauthAt: sessions.reauthAt, mfaVerifiedAt: sessions.mfaVerifiedAt })
      .from(sessions)
      .where(eq(sessions.id, sessionId));
    return row;
  }

  async deleteUserSessions(userId: string): Promise<void> {
    await this.handle.db.delete(sessions).where(eq(sessions.userId, userId));
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.handle.db.delete(sessions).where(eq(sessions.id, sessionId));
  }

  holdsPlatformRole(userId: string): Promise<boolean> {
    return holdsPlatformRole(this.handle.db, userId);
  }

  /** Argon2id hash of the user's own password, or undefined for accounts that only use Google. */
  async credentialHash(userId: string): Promise<string | undefined> {
    const [row] = await this.handle.db
      .select({ password: accounts.password })
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")));
    return row?.password ?? undefined;
  }

  async markReauthenticated(sessionId: string, at: Date): Promise<void> {
    await this.handle.db.update(sessions).set({ reauthAt: at }).where(eq(sessions.id, sessionId));
  }
}
