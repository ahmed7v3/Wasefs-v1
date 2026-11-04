import { Inject, Injectable } from "@nestjs/common";
import {
  campaignLinks,
  earlyAccessEvents,
  earlyAccessSignups,
  type EarlyAccessSignup,
  type NewEarlyAccessEvent,
  type NewEarlyAccessSignup,
} from "@wasfa/db";
import { and, count, eq, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../common/database.js";

export interface ActiveCampaign {
  id: string;
  slug: string;
  utm: Record<string, string>;
}

/** Fields a repeat submit may refresh: where the person is now, never how they first arrived. */
export type SignupContextPatch = Partial<
  Pick<
    NewEarlyAccessSignup,
    | "country"
    | "region"
    | "city"
    | "timezone"
    | "latApprox"
    | "lonApprox"
    | "device"
    | "browser"
    | "os"
    | "lang"
    | "sessionId"
  >
>;

export type SignupDetailsPatch = Required<
  Pick<
    NewEarlyAccessSignup,
    "name" | "role" | "probeAnswer" | "fairPriceMinor" | "fairPriceCurrency" | "features"
  >
>;

/** The public side of the early-access tables: events, sign-ups and the counters derived from them. */
@Injectable()
export class EarlyAccessRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async insertEvent(values: NewEarlyAccessEvent): Promise<void> {
    await this.handle.db.insert(earlyAccessEvents).values(values);
  }

  async activeCampaignBySlug(slug: string): Promise<ActiveCampaign | undefined> {
    const [row] = await this.handle.db
      .select({ id: campaignLinks.id, slug: campaignLinks.slug, utm: campaignLinks.utm })
      .from(campaignLinks)
      .where(and(eq(campaignLinks.slug, slug), eq(campaignLinks.active, true)))
      .limit(1);
    return row;
  }

  async signupByPhone(phoneE164: string): Promise<EarlyAccessSignup | undefined> {
    const [row] = await this.handle.db
      .select()
      .from(earlyAccessSignups)
      .where(eq(earlyAccessSignups.phoneE164, phoneE164))
      .limit(1);
    return row;
  }

  async signupById(id: string): Promise<EarlyAccessSignup | undefined> {
    const [row] = await this.handle.db
      .select()
      .from(earlyAccessSignups)
      .where(eq(earlyAccessSignups.id, id))
      .limit(1);
    return row;
  }

  async signupIdByRefCode(refCode: string): Promise<string | undefined> {
    const [row] = await this.handle.db
      .select({ id: earlyAccessSignups.id })
      .from(earlyAccessSignups)
      .where(eq(earlyAccessSignups.refCode, refCode))
      .limit(1);
    return row?.id;
  }

  /**
   * Undefined when the phone or the ref code already exists (a concurrent submit or a code
   * collision); the caller looks the phone up again to tell the two apart.
   */
  async insertSignup(values: NewEarlyAccessSignup): Promise<EarlyAccessSignup | undefined> {
    const [row] = await this.handle.db
      .insert(earlyAccessSignups)
      .values(values)
      .onConflictDoNothing()
      .returning();
    return row;
  }

  async updateContext(id: string, patch: SignupContextPatch): Promise<void> {
    if (Object.keys(patch).length === 0) return;
    await this.handle.db.update(earlyAccessSignups).set(patch).where(eq(earlyAccessSignups.id, id));
  }

  async completeDetails(id: string, patch: SignupDetailsPatch): Promise<void> {
    await this.handle.db
      .update(earlyAccessSignups)
      .set({ ...patch, stepsCompleted: 2 })
      .where(eq(earlyAccessSignups.id, id));
  }

  async joinedCount(): Promise<number> {
    const [row] = await this.handle.db.select({ n: count() }).from(earlyAccessSignups);
    return row?.n ?? 0;
  }

  /** 1-based place by sign-up time (id breaks ties), before the invite boost. */
  async rawRank(id: string): Promise<number> {
    const [row] = await this.handle.db
      .select({ n: count() })
      .from(earlyAccessSignups)
      .where(
        sql`(${earlyAccessSignups.createdAt}, ${earlyAccessSignups.id}) <= (select s.created_at, s.id from early_access_signups s where s.id = ${id})`,
      );
    return row?.n ?? 1;
  }

  async invitedCount(id: string): Promise<number> {
    const [row] = await this.handle.db
      .select({ n: count() })
      .from(earlyAccessSignups)
      .where(eq(earlyAccessSignups.referredById, id));
    return row?.n ?? 0;
  }
}
