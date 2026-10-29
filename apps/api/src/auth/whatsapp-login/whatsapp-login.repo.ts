import { Inject, Injectable } from "@nestjs/common";
import {
  ensureReferralCode,
  requestSignupCheck,
  sessions,
  userRoles,
  users,
  isUniqueViolation,
} from "@wasfa/db";
import { WA_LOGIN_METHOD } from "@wasfa/shared/schemas/wa-login";
import { and, eq, gte, isNotNull, type SQL } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

import type { WhatsAppLoginSubject } from "./refusal.js";

export interface WhatsAppAccount extends WhatsAppLoginSubject {
  id: string;
  name: string;
}

const UNIQUE_VERIFIED_PHONE = "users_phone_verified_key";

/** The only place "Continue with WhatsApp" touches the database. */
@Injectable()
export class WhatsAppLoginRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** The account whose **verified** number this is (unverified claims never count), with what decides refusal. */
  async findByVerifiedPhone(phone: string): Promise<WhatsAppAccount | null> {
    return this.findAccount(and(eq(users.phone, phone), isNotNull(users.phoneVerifiedAt)));
  }

  findById(userId: string): Promise<WhatsAppAccount | null> {
    return this.findAccount(eq(users.id, userId));
  }

  private async findAccount(where: SQL | undefined): Promise<WhatsAppAccount | null> {
    const [row] = await this.handle.db
      .select({
        id: users.id,
        name: users.name,
        status: users.status,
        twoFactorEnabled: users.twoFactorEnabled,
        anonymizedAt: users.anonymizedAt,
      })
      .from(users)
      .where(where)
      .limit(1);
    if (!row) return null;
    const roles = await this.handle.db
      .select({ roleKey: userRoles.roleKey })
      .from(userRoles)
      .where(eq(userRoles.userId, row.id))
      .limit(1);
    return { ...row, hasPlatformRole: roles.length > 0 };
  }

  /**
   * Inserts the account: no password, phone proven by WhatsApp itself. `taken` when another account
   * verified this number in the meantime (the caller then treats that one as the account).
   */
  async insertUser(input: {
    name: string;
    email: string;
    phone: string;
  }): Promise<{ id: string } | "taken"> {
    try {
      return await this.handle.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(users)
          .values({
            name: input.name,
            email: input.email,
            emailVerified: false,
            phone: input.phone,
            phoneVerified: true,
            phoneVerifiedAt: new Date(),
          })
          .returning({ id: users.id });
        if (!row) throw new Error("User insert returned no row");
        // Same as `markVerified`: a verified phone may complete a referred person's sign-up conditions.
        await requestSignupCheck(tx, row.id, "phone");
        return { id: row.id };
      });
    } catch (error) {
      if (isUniqueViolation(error, UNIQUE_VERIFIED_PHONE)) return "taken";
      throw error;
    }
  }

  /** Every new account gets its own invite code (what Better Auth's user-create hook does). */
  async ensureReferralCode(userId: string): Promise<void> {
    await ensureReferralCode(this.handle.db, userId);
  }

  /** Marks a session as born from WhatsApp sign-in, so the chat's undo can find it. */
  async tagSession(sessionId: string): Promise<void> {
    await this.handle.db
      .update(sessions)
      .set({ loginMethod: WA_LOGIN_METHOD })
      .where(eq(sessions.id, sessionId));
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.handle.db.delete(sessions).where(eq(sessions.id, sessionId));
  }

  /** Deletes the user's WhatsApp-born sessions created since `since`; returns how many. */
  async revokeWhatsAppSessions(userId: string, since: Date): Promise<number> {
    const deleted = await this.handle.db
      .delete(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          eq(sessions.loginMethod, WA_LOGIN_METHOD),
          gte(sessions.createdAt, since),
        ),
      )
      .returning({ id: sessions.id });
    return deleted.length;
  }
}
