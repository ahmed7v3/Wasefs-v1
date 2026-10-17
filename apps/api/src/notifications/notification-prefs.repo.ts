import { Inject, Injectable } from "@nestjs/common";
import { customerContact, setWhatsappOptOut, users, type CustomerContact } from "@wasfa/db";
import { and, eq, isNotNull } from "drizzle-orm";

import { DB, type DbHandle } from "../common/database.js";

/** The caller's own contact preferences; every call is scoped to the caller's user id. */
@Injectable()
export class NotificationPrefsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  contact(userId: string): Promise<CustomerContact | null> {
    return customerContact(this.handle.db, userId);
  }

  setWhatsappOptOut(userId: string, optedOut: boolean): Promise<void> {
    return setWhatsappOptOut(this.handle.db, userId, optedOut, "account");
  }

  /** The caller's verified phone (its chat goes into the bridge's opt-out set), or null. */
  async verifiedPhone(userId: string): Promise<string | null> {
    const [row] = await this.handle.db
      .select({ phone: users.phone })
      .from(users)
      .where(and(eq(users.id, userId), isNotNull(users.phoneVerifiedAt)));
    return row?.phone ?? null;
  }
}
