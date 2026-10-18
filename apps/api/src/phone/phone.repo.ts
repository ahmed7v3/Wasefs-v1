import { Inject, Injectable } from "@nestjs/common";
import { requestSignupCheck, users } from "@wasfa/db";
import { eq } from "drizzle-orm";

import { DB, type DbHandle } from "../common/database.js";

import type { Locale } from "@wasfa/shared/i18n";

export interface PhoneUser {
  phone: string | null;
  phoneVerified: boolean;
  locale: Locale;
}

const UNIQUE_VERIFIED_PHONE = "users_phone_verified_key";

function violatedConstraint(error: unknown): string | undefined {
  const candidate = (error as { cause?: unknown } | null)?.cause ?? error;
  const name = (candidate as { constraint_name?: unknown } | null)?.constraint_name;
  return typeof name === "string" ? name : undefined;
}

/** The only place phone verification touches the database. */
@Injectable()
export class PhoneRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async findUser(userId: string): Promise<PhoneUser | null> {
    const [row] = await this.handle.db
      .select({ phone: users.phone, phoneVerified: users.phoneVerified, locale: users.locale })
      .from(users)
      .where(eq(users.id, userId));
    return row ?? null;
  }

  /**
   * Marks `phone` as this user's verified number. One verified account per number: if another
   * account already holds it, nothing changes and the result is `taken`.
   */
  async markVerified(userId: string, phone: string): Promise<"verified" | "taken"> {
    try {
      // The referral check is queued in the same transaction: a verified phone is never missed.
      return await this.handle.db.transaction(async (tx) => {
        const updated = await tx
          .update(users)
          .set({ phone, phoneVerified: true, phoneVerifiedAt: new Date() })
          .where(eq(users.id, userId))
          .returning({ id: users.id });
        if (updated.length === 0) return "taken";
        await requestSignupCheck(tx, userId, "phone");
        return "verified";
      });
    } catch (error) {
      if (violatedConstraint(error) === UNIQUE_VERIFIED_PHONE) return "taken";
      throw error;
    }
  }
}
