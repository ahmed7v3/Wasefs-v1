import { createHmac, timingSafeEqual } from "node:crypto";

import {
  GROWTH_EVENT_PROPS_MAX_BYTES,
  GROWTH_RETENTION_MONTHS,
  TASTE_FEATURE,
  type GrowthEventName,
} from "@wasfa/shared/growth";
import { growthSettingsSchema } from "@wasfa/shared/settings";
import { and, eq, gte, isNull, sql } from "drizzle-orm";

import { moveCreditsInTransaction, type Transaction } from "./credits-ledger.js";
import {
  growthEvents,
  growthRules,
  personalOffers,
  promotions,
  rxAnalyses,
  siteSettings,
  tasteGrants,
  type GrowthRule,
  type PersonalOffer,
  type Subscription,
  type TasteGrant,
} from "./schema/index.js";

import type { Database } from "./client.js";
import type { SubscriptionLifecycleHooks } from "./subscriptions.js";
import type { SubscriptionReminderSlot } from "@wasfa/shared/subscriptions";

/*
 * The conversion engine's database side (Phase 3, Task 3.14; docs/GROWTH-STRATEGY.md): event
 * recording that can never break a money transaction, lifecycle rules and personal offers, the taste
 * grant ledger moves, retention. Plain functions over a `Database` or a transaction, like the other
 * state machines, so the API and the worker run the same code.
 */

type Handle = Database | Transaction;

/** `Database` and a transaction both open a (nested) transaction: a savepoint inside one. */
interface CanNest {
  transaction<T>(run: (tx: Transaction) => Promise<T>): Promise<T>;
}
const nestable = (handle: Handle): CanNest => handle as unknown as CanNest;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

// --- Settings ----------------------------------------------------------------------------------------

/** The `growth` settings read inside the caller's connection (the worker has no settings cache). */
export async function growthSettingsOf(handle: Handle) {
  const [row] = await handle.select().from(siteSettings).where(eq(siteSettings.key, "growth"));
  const parsed = growthSettingsSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : growthSettingsSchema.parse({});
}

// --- Events --------------------------------------------------------------------------------------------

export interface GrowthEventRecord {
  name: GrowthEventName;
  /** 8 to 64 characters; server-side events use `serverSessionId`. */
  sessionId: string;
  userId?: string | null;
  props?: Record<string, string | number | boolean>;
  variant?: string | null;
  occurredAt?: Date;
}

/** The session id of an event the server writes itself (no browser session is known). */
export function serverSessionId(userId: string | null, fallback: string): string {
  return `srv:${userId ?? fallback}`.slice(0, 64);
}

/**
 * Records one funnel event. It NEVER throws into the caller: money handlers call it from inside
 * their transaction, and a failed analytics insert must not roll a payment back. The insert runs in
 * a savepoint, so even a database error leaves the outer transaction usable, and the row is checked
 * before it is sent. Returns whether the event was stored.
 */
export async function recordGrowthEvent(
  handle: Handle,
  event: GrowthEventRecord,
): Promise<boolean> {
  const props = event.props ?? {};
  if (event.sessionId.length < 8 || event.sessionId.length > 64) return false;
  if (JSON.stringify(props).length > GROWTH_EVENT_PROPS_MAX_BYTES) return false;
  try {
    await nestable(handle).transaction(async (savepoint) => {
      await savepoint.insert(growthEvents).values({
        name: event.name,
        sessionId: event.sessionId,
        userId: event.userId ?? null,
        props,
        variant: event.variant ?? null,
        ...(event.occurredAt ? { occurredAt: event.occurredAt } : {}),
      });
    });
    return true;
  } catch {
    return false;
  }
}

// --- Rules and personal offers ----------------------------------------------------------------------------

interface DefaultRuleSeed {
  key: string;
  name: string;
  kind: GrowthRule["kind"];
  condition: Record<string, unknown>;
  validityHours: number;
  active: boolean;
  percentBps: number;
  months: number[];
  titleAr: string;
  titleEn: string;
}

/**
 * GROWTH §6: the welcome offer on day 6 for a free user with at least 3 analyses (20% off the first
 * month, 48 hours), the win-back 3 days after expiry (15%, 7 days), and a renewal perk that stays off
 * until an admin turns it on.
 */
export const DEFAULT_GROWTH_RULES: readonly DefaultRuleSeed[] = [
  {
    key: "welcome_offer",
    name: "Welcome offer",
    kind: "welcome",
    condition: { afterDays: 6, minAnalyses: 3, plan: "free" },
    validityHours: 48,
    active: true,
    percentBps: 2_000,
    months: [1],
    titleAr: "خصم الترحيب على الشهر الأول",
    titleEn: "Welcome discount on your first month",
  },
  {
    key: "winback",
    name: "Win-back",
    kind: "winback",
    condition: { afterExpiryDays: 3, periodDays: 90 },
    validityHours: 168,
    active: true,
    percentBps: 1_500,
    months: [],
    titleAr: "خصم العودة",
    titleEn: "Welcome-back discount",
  },
  {
    key: "renewal_perk",
    name: "Renewal perk",
    kind: "renewal",
    condition: { slots: ["d3", "d1"], periodDays: 25 },
    validityHours: 72,
    active: false,
    percentBps: 1_000,
    months: [],
    titleAr: "ميزة التجديد المبكر",
    titleEn: "Early renewal perk",
  },
];

/**
 * Seeds the three default lifecycle rules, with draft promotions as their discount templates, only
 * when the table is empty (insert-only: an admin who edited or removed a rule is never overwritten).
 * A `draft` template never applies on its own; it only prices a personal offer that points at it.
 */
export async function ensureDefaultGrowthRules(db: Database): Promise<number> {
  return db.transaction(async (tx) => {
    // Two first runs at once: the loser waits here and then sees the winner's rows.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('growth_rules_seed'))`);
    const [existing] = await tx.select({ id: growthRules.id }).from(growthRules).limit(1);
    if (existing) return 0;
    for (const seed of DEFAULT_GROWTH_RULES) {
      const [template] = await tx
        .insert(promotions)
        .values({
          kind: "percent",
          name: `${seed.name} (offer template)`,
          titleAr: seed.titleAr,
          titleEn: seed.titleEn,
          value: seed.percentBps,
          months: seed.months,
          status: "draft",
        })
        .returning({ id: promotions.id });
      await tx.insert(growthRules).values({
        key: seed.key,
        name: seed.name,
        kind: seed.kind,
        condition: seed.condition,
        promotionId: template?.id ?? null,
        validityHours: seed.validityHours,
        perOwnerLimit: 1,
        active: seed.active,
      });
    }
    return DEFAULT_GROWTH_RULES.length;
  });
}

export async function activeGrowthRules(handle: Handle): Promise<GrowthRule[]> {
  return handle.select().from(growthRules).where(eq(growthRules.active, true));
}

/**
 * Creates the personal offer of `rule` for one user unless the rule's per-owner limit is used up (in
 * the rule's `periodDays` window when it has one, else ever). The deadline is a server value fixed
 * here: every tab and device reads the same `expires_at`. Returns the offer, or `null` when the user
 * already has the allowed number. Serialized per user and rule, so a repeated run adds nothing.
 */
export async function createOfferFromRule(
  handle: Handle,
  rule: GrowthRule,
  userId: string,
  now: Date,
): Promise<PersonalOffer | null> {
  return nestable(handle).transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`offer:${rule.key}:${userId}`}))`,
    );
    const periodDays = Number((rule.condition as { periodDays?: unknown }).periodDays ?? 0);
    const since = periodDays > 0 ? new Date(now.getTime() - periodDays * DAY_MS) : null;
    const [used] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(personalOffers)
      .where(
        and(
          eq(personalOffers.ownerUserId, userId),
          eq(personalOffers.ruleKey, rule.key),
          since === null ? undefined : gte(personalOffers.createdAt, since),
        ),
      );
    if ((used?.total ?? 0) >= rule.perOwnerLimit) return null;
    const [offer] = await tx
      .insert(personalOffers)
      .values({
        ownerUserId: userId,
        kind: rule.kind,
        promotionId: rule.promotionId,
        ruleKey: rule.key,
        expiresAt: new Date(now.getTime() + rule.validityHours * HOUR_MS),
      })
      .returning();
    return offer ?? null;
  });
}

/**
 * The conversion engine's side of the subscription lifecycle (Task 3.5 seam). An expiring paid
 * period gets the renewal perk when that rule is switched on. A failure here must never stop a
 * subscription from advancing, so each hook runs in a savepoint and swallows its own errors.
 */
export const growthLifecycleHooks: SubscriptionLifecycleHooks = {
  async onExpiring(tx, { subscription, slot, now }) {
    try {
      await nestable(tx).transaction(async (savepoint) => {
        await renewalPerk(savepoint, subscription, slot, now);
      });
    } catch {
      // The renewal reminder itself is already queued; the perk is a bonus.
    }
  },
  onExpired() {
    // The win-back offer is created three days after expiry by the `growth.lifecycle` job.
    return Promise.resolve();
  },
};

async function renewalPerk(
  tx: Transaction,
  subscription: Subscription,
  slot: SubscriptionReminderSlot,
  now: Date,
): Promise<void> {
  if (subscription.ownerUserId === null || subscription.source !== "paid") return;
  const settings = await growthSettingsOf(tx);
  if (settings.killSwitch) return;
  const [rule] = await tx
    .select()
    .from(growthRules)
    .where(and(eq(growthRules.key, "renewal_perk"), eq(growthRules.active, true)));
  if (!rule) return;
  const slots = (rule.condition as { slots?: unknown }).slots;
  if (Array.isArray(slots) && !slots.includes(slot)) return;
  await createOfferFromRule(tx, rule, subscription.ownerUserId, now);
}

// --- Taste grants ---------------------------------------------------------------------------------------------

/** One idempotent period key per taste request (`taste_grants` is unique per owner, feature and period). */
export function tastePeriodKey(requestId: string): string {
  return `t:${requestId.replaceAll("-", "").slice(0, 28)}`;
}

export interface TasteUsage {
  /** Grants of this user in the window. */
  userGrants: number;
  /** All grants in the window, and the credits they cost. */
  globalGrants: number;
  globalCredits: number;
}

/** Tastes granted since `since` (a rolling week), for the per-user and global caps. */
export async function tasteUsageSince(
  handle: Handle,
  userId: string,
  since: Date,
): Promise<TasteUsage> {
  const [row] = await handle
    .select({
      globalGrants: sql<number>`count(*)::int`,
      globalCredits: sql<number>`coalesce(sum(${tasteGrants.credits}), 0)::int`,
      userGrants: sql<number>`count(*) filter (where ${tasteGrants.ownerUserId} = ${userId})::int`,
    })
    .from(tasteGrants)
    .where(and(gte(tasteGrants.grantedAt, since), eq(tasteGrants.feature, TASTE_FEATURE)));
  return {
    userGrants: row?.userGrants ?? 0,
    globalGrants: row?.globalGrants ?? 0,
    globalCredits: row?.globalCredits ?? 0,
  };
}

/**
 * Inserts the grant and puts its credits in the user's wallet through the ledger (`trial_grant`, key
 * `taste:<grantId>`), in the caller's transaction. The credits pay for the one Deep analysis through
 * the normal reserve -> settle path; whatever that does not use is taken back by `expireTasteRemainder`.
 */
export async function createTasteGrant(
  tx: Transaction,
  input: {
    userId: string;
    requestId: string;
    sourceAnalysisId: string;
    credits: number;
    now: Date;
  },
): Promise<{ grant: TasteGrant; created: boolean }> {
  const periodKey = tastePeriodKey(input.requestId);
  const [existing] = await tx
    .select()
    .from(tasteGrants)
    .where(
      and(
        eq(tasteGrants.ownerUserId, input.userId),
        eq(tasteGrants.feature, TASTE_FEATURE),
        eq(tasteGrants.periodKey, periodKey),
      ),
    );
  if (existing) return { grant: existing, created: false };
  const [grant] = await tx
    .insert(tasteGrants)
    .values({
      ownerUserId: input.userId,
      feature: TASTE_FEATURE,
      periodKey,
      grantedAt: input.now,
      // The credits are for the analysis that starts right now; an hour is generous.
      expiresAt: new Date(input.now.getTime() + HOUR_MS),
      sourceAnalysisId: input.sourceAnalysisId,
      credits: input.credits,
    })
    .returning();
  if (!grant) throw new Error("Taste grant was not stored");
  await moveCreditsInTransaction(tx, { type: "user", id: input.userId }, {
    kind: "trial_grant",
    amount: input.credits,
    idempotencyKey: `taste:${grant.id}`,
    reason: `taste:${TASTE_FEATURE}`,
  });
  return { grant, created: true };
}

/** Links the new Deep analysis to its grant and marks the grant used. Only once, only when unused. */
export async function attachTasteAnalysis(
  handle: Handle,
  grantId: string,
  analysisId: string,
  now: Date,
): Promise<boolean> {
  const rows = await handle
    .update(tasteGrants)
    .set({ analysisId, usedAt: now })
    .where(and(eq(tasteGrants.id, grantId), isNull(tasteGrants.analysisId)))
    .returning({ id: tasteGrants.id });
  return rows.length > 0;
}

/**
 * Takes back the part of a taste's credits that the Deep analysis did not use: a failed or refunded
 * analysis, a free cache hit, or a taste that never started. What was charged is the analysis' own
 * `credits_charged`, so a successful taste leaves nothing to take. Idempotent (ledger key
 * `taste:<id>:expire`) and bounded by the wallet balance, so the person's other credits are safe.
 * Does nothing while the analysis is still running. `force` takes an unlinked grant back at once (the
 * Deep analysis could not be started, so the credits must not stay spendable). Returns the credits taken back.
 */
export async function expireTasteRemainder(
  db: Database,
  grantId: string,
  options: { force?: boolean } = {},
): Promise<number> {
  return db.transaction(async (tx) => {
    const [grant] = await tx
      .select()
      .from(tasteGrants)
      .where(eq(tasteGrants.id, grantId))
      .for("update");
    if (!grant || grant.credits <= 0 || grant.ownerUserId === null) return 0;
    let charged = 0;
    if (grant.analysisId !== null) {
      const [analysis] = await tx
        .select({ status: rxAnalyses.status, charged: rxAnalyses.creditsCharged })
        .from(rxAnalyses)
        .where(eq(rxAnalyses.id, grant.analysisId));
      if (analysis && ["queued", "processing", "verifying"].includes(analysis.status)) return 0;
      charged = analysis?.status === "done" ? analysis.charged : 0;
    } else if (options.force !== true && grant.expiresAt.getTime() > Date.now()) {
      // Not linked yet and still inside its hour: the request that made it may be about to link it.
      return 0;
    }
    const remainder = grant.credits - charged;
    if (remainder <= 0) return 0;
    const written = await moveCreditsInTransaction(
      tx,
      { type: "user", id: grant.ownerUserId },
      {
        kind: "expiry",
        amount: -remainder,
        idempotencyKey: `taste:${grant.id}:expire`,
        reason: "taste_unused",
      },
    );
    return written === null || written.replayed ? 0 : -written.entry.amount;
  });
}

/** The unlinked or finished grants whose unused credits are still in the wallet (the lifecycle job's sweep). */
export async function tasteGrantsToSettle(db: Database, now: Date, limit = 200): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    select g.id
    from taste_grants g
    left join rx_analyses a on a.id = g.analysis_id
    where g.credits > 0
      and g.granted_at > ${new Date(now.getTime() - 3 * DAY_MS).toISOString()}::timestamptz
      and (
        (g.analysis_id is null and g.expires_at <= ${now.toISOString()}::timestamptz)
        or a.status in ('failed', 'refunded')
        or (a.status = 'done' and a.credits_charged < g.credits)
      )
      and not exists (
        select 1 from credit_ledger l where l.idempotency_key = 'taste:' || g.id::text || ':expire'
      )
    order by g.granted_at
    limit ${limit}
  `);
  return rows.map((row) => row.id);
}

// --- Retention ----------------------------------------------------------------------------------------------------

/** Deletes `growth_events` and `growth_mail_log` rows older than 13 months. Returns what it deleted. */
export async function pruneGrowthData(
  db: Database,
  now: Date,
): Promise<{ events: number; mailLog: number }> {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - GROWTH_RETENTION_MONTHS);
  const iso = cutoff.toISOString();
  const events = await db.execute<{ total: number }>(sql`
    with gone as (delete from growth_events where occurred_at < ${iso}::timestamptz returning 1)
    select count(*)::int as total from gone
  `);
  const mailLog = await db.execute<{ total: number }>(sql`
    with gone as (delete from growth_mail_log where sent_at < ${iso}::timestamptz returning 1)
    select count(*)::int as total from gone
  `);
  return { events: events[0]?.total ?? 0, mailLog: mailLog[0]?.total ?? 0 };
}

// --- Unsubscribe links ------------------------------------------------------------------------------------------

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A purpose-bound subkey: an unsubscribe signature can never be replayed as any other token. */
function unsubscribeSignature(key: Buffer, userId: string): Buffer {
  const subkey = createHmac("sha256", key).update("wasfa:unsubscribe:v1").digest();
  return createHmac("sha256", subkey).update(`marketing:${userId}`).digest().subarray(0, 18);
}

/**
 * The token of a lifecycle mail's unsubscribe link: `<userId>.<signature>`, base64url. It does not
 * expire (an old mail must still be able to unsubscribe), names only the user, and can do one thing:
 * turn marketing mail off. Signed with a subkey of the app's `ENCRYPTION_KEY`, shared by api and worker.
 */
export function unsubscribeToken(key: Buffer, userId: string): string {
  return `${userId}.${unsubscribeSignature(key, userId).toString("base64url")}`;
}

/** The user id of a valid token, or null (wrong signature, malformed, another purpose). */
export function verifyUnsubscribeToken(key: Buffer, token: string): string | null {
  const [userId, signature, extra] = token.split(".");
  if (extra !== undefined || !userId || !signature || !UUID_PATTERN.test(userId)) return null;
  const expected = unsubscribeSignature(key, userId.toLowerCase());
  let given: Buffer;
  try {
    given = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return userId.toLowerCase();
}
