import { jidForPhone } from "@wasfa/shared/customer-messages";
import { hasMarketingConsent, type MarketingOptOutVia } from "@wasfa/shared/growth";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { notificationPrefs, type WHATSAPP_OPT_OUT_SOURCES } from "./schema/notification-prefs.js";
import { users } from "./schema/users.js";

import type { Database } from "./client.js";
import type { Transaction } from "./credits-ledger.js";

type Handle = Database | Transaction;

/** Where a customer can be reached right now, without the global switch and caps (the worker adds those). */
export interface CustomerContact {
  userId: string;
  name: string;
  email: string;
  locale: "ar" | "en";
  active: boolean;
  /** The verified phone's WhatsApp chat, or null when WhatsApp is not possible for this person. */
  whatsappJid: string | null;
  /** The person has a verified phone but turned WhatsApp messages off. */
  whatsappOptedOut: boolean;
}

/**
 * A verified phone is one the person proved by sending our WhatsApp number the code, so that chat
 * exists and they started it. Anonymized and inactive accounts are never messaged.
 */
export async function customerContact(db: Handle, userId: string): Promise<CustomerContact | null> {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      locale: users.locale,
      status: users.status,
      anonymizedAt: users.anonymizedAt,
      phone: users.phone,
      phoneVerifiedAt: users.phoneVerifiedAt,
      optedOutAt: notificationPrefs.whatsappOptedOutAt,
    })
    .from(users)
    .leftJoin(notificationPrefs, eq(notificationPrefs.userId, users.id))
    .where(eq(users.id, userId));
  if (!row) return null;
  const active = row.status === "active" && row.anonymizedAt === null;
  const verified = row.phone !== null && row.phoneVerifiedAt !== null;
  const optedOut = row.optedOutAt !== null;
  return {
    userId: row.id,
    name: row.name,
    email: row.email,
    locale: row.locale === "en" ? "en" : "ar",
    active,
    whatsappJid: active && verified && !optedOut && row.phone ? jidForPhone(row.phone) : null,
    whatsappOptedOut: verified && optedOut,
  };
}

/** Turns WhatsApp messages off (`optedOut`) or back on for one person. Idempotent. */
export async function setWhatsappOptOut(
  db: Handle,
  userId: string,
  optedOut: boolean,
  via: (typeof WHATSAPP_OPT_OUT_SOURCES)[number],
  now = new Date(),
): Promise<void> {
  await db
    .insert(notificationPrefs)
    .values({
      userId,
      whatsappOptedOutAt: optedOut ? now : null,
      whatsappOptedOutVia: optedOut ? via : null,
    })
    .onConflictDoUpdate({
      target: notificationPrefs.userId,
      set: {
        // Keep the first opt-out time when STOP arrives twice.
        whatsappOptedOutAt: optedOut
          ? sql`coalesce(${notificationPrefs.whatsappOptedOutAt}, ${now.toISOString()}::timestamptz)`
          : null,
        whatsappOptedOutVia: optedOut
          ? sql`coalesce(${notificationPrefs.whatsappOptedOutVia}, ${via})`
          : null,
        updatedAt: now,
      },
    });
}

/** The active account whose VERIFIED phone is `e164`, if any (one at most: unique index). */
export async function userIdForVerifiedPhone(db: Handle, e164: string): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.phone, e164),
        isNotNull(users.phoneVerifiedAt),
        eq(users.status, "active"),
        isNull(users.anonymizedAt),
      ),
    );
  return row?.id ?? null;
}

// --- Marketing consent (Phase 3, Task 3.14; GROWTH §6) -------------------------------------------------

/** What decides whether lifecycle (marketing) mail may go to one person. */
export interface MarketingState {
  optedInAt: Date | null;
  optedOutAt: Date | null;
  silencedUntil: Date | null;
  /** Opted in, and no opt-out since. */
  consent: boolean;
}

export async function marketingState(db: Handle, userId: string): Promise<MarketingState> {
  const [row] = await db
    .select({
      optedInAt: notificationPrefs.marketingOptedInAt,
      optedOutAt: notificationPrefs.marketingOptedOutAt,
      silencedUntil: notificationPrefs.marketingSilencedUntil,
    })
    .from(notificationPrefs)
    .where(eq(notificationPrefs.userId, userId));
  const state = row ?? { optedInAt: null, optedOutAt: null, silencedUntil: null };
  return {
    ...state,
    consent: hasMarketingConsent({
      marketingOptedInAt: state.optedInAt,
      marketingOptedOutAt: state.optedOutAt,
    }),
  };
}

/** Records an explicit opt-in (register checkbox or the account switch). Clears an earlier opt-out. Idempotent. */
export async function setMarketingOptIn(
  db: Handle,
  userId: string,
  now = new Date(),
): Promise<void> {
  await db
    .insert(notificationPrefs)
    .values({ userId, marketingOptedInAt: now })
    .onConflictDoUpdate({
      target: notificationPrefs.userId,
      set: {
        // The first consent time is kept when the person confirms again.
        marketingOptedInAt: sql`case when ${notificationPrefs.marketingOptedInAt} is not null and ${notificationPrefs.marketingOptedOutAt} is null then ${notificationPrefs.marketingOptedInAt} else ${now.toISOString()}::timestamptz end`,
        marketingOptedOutAt: null,
        marketingOptedOutVia: null,
        updatedAt: now,
      },
    });
}

/**
 * Turns marketing mail off. Idempotent: a second opt-out keeps the first time and route. Someone who
 * never opted in is recorded too, so a later opt-in has to be a new, deliberate act.
 */
export async function setMarketingOptOut(
  db: Handle,
  userId: string,
  via: MarketingOptOutVia,
  now = new Date(),
): Promise<void> {
  await db
    .insert(notificationPrefs)
    .values({ userId, marketingOptedOutAt: now, marketingOptedOutVia: via })
    .onConflictDoUpdate({
      target: notificationPrefs.userId,
      set: {
        marketingOptedOutAt: sql`coalesce(${notificationPrefs.marketingOptedOutAt}, ${now.toISOString()}::timestamptz)`,
        marketingOptedOutVia: sql`coalesce(${notificationPrefs.marketingOptedOutVia}, ${via})`,
        updatedAt: now,
      },
    });
}

/** No marketing for `days` days from `now` (never shortens an existing silence). */
export async function silenceMarketing(
  db: Handle,
  userId: string,
  days: number,
  now = new Date(),
): Promise<void> {
  const until = new Date(now.getTime() + days * 86_400_000);
  await db
    .insert(notificationPrefs)
    .values({ userId, marketingSilencedUntil: until })
    .onConflictDoUpdate({
      target: notificationPrefs.userId,
      set: {
        marketingSilencedUntil: sql`greatest(coalesce(${notificationPrefs.marketingSilencedUntil}, ${until.toISOString()}::timestamptz), ${until.toISOString()}::timestamptz)`,
        updatedAt: now,
      },
    });
}
