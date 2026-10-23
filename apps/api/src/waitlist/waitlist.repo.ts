import { Inject, Injectable } from "@nestjs/common";
import { appWaitlist, type AppWaitlistEntry, type NewAppWaitlistEntry } from "@wasfa/db";
import { and, asc, count, desc, eq, type SQL } from "drizzle-orm";

import { afterCursor, stamp, type Cursor } from "../admin/common/keyset.js";
import { DB, type DbHandle } from "../common/database.js";

import type { AppPlatform } from "@wasfa/shared/schemas/public-site";

export interface WaitlistListRow extends AppWaitlistEntry {
  /** `created_at` as exact text, for the cursor. */
  cursorAt: string;
}

/** The only place the apps waitlist touches the database. */
@Injectable()
export class WaitlistRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** True when the address was new. A repeat is a no-op (the first consent and platform stay). */
  async join(entry: NewAppWaitlistEntry): Promise<boolean> {
    const inserted = await this.handle.db
      .insert(appWaitlist)
      .values(entry)
      .onConflictDoNothing({ target: appWaitlist.email })
      .returning({ id: appWaitlist.id });
    return inserted.length > 0;
  }

  /** `limit + 1` rows, newest first. */
  list(
    platform: AppPlatform | undefined,
    cursor: Cursor | undefined,
    limit: number,
  ): Promise<WaitlistListRow[]> {
    const conditions: (SQL | undefined)[] = [
      platform === undefined ? undefined : eq(appWaitlist.platform, platform),
      cursor === undefined
        ? undefined
        : afterCursor(appWaitlist.createdAt, appWaitlist.id, cursor, "uuid"),
    ];
    return this.handle.db
      .select({ ...appWaitlistColumns(), cursorAt: stamp(appWaitlist.createdAt) })
      .from(appWaitlist)
      .where(and(...conditions))
      .orderBy(desc(appWaitlist.createdAt), desc(appWaitlist.id))
      .limit(limit + 1);
  }

  async total(): Promise<number> {
    const [row] = await this.handle.db.select({ n: count() }).from(appWaitlist);
    return row?.n ?? 0;
  }

  /** Oldest first, for the CSV export (the list is small: one row per interested visitor). */
  all(): Promise<AppWaitlistEntry[]> {
    return this.handle.db
      .select()
      .from(appWaitlist)
      .orderBy(asc(appWaitlist.createdAt), asc(appWaitlist.id));
  }
}

function appWaitlistColumns() {
  return {
    id: appWaitlist.id,
    email: appWaitlist.email,
    platform: appWaitlist.platform,
    locale: appWaitlist.locale,
    consentAt: appWaitlist.consentAt,
    notifiedAt: appWaitlist.notifiedAt,
    createdAt: appWaitlist.createdAt,
    updatedAt: appWaitlist.updatedAt,
  };
}
