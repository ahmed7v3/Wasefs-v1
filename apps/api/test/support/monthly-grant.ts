import { ensureMonthlyGrant, expireUnused, grantPeriod, type Database } from "@wasfa/db";

/**
 * An account that already spent this month's free credits: the month's plan grant is paid and
 * expired at once, so the API's on-demand grant (CreditsService) has nothing left to pay and the
 * balance a test sets up stays exactly what it set up. Call it before seeding any other credits.
 */
export async function useUpMonthlyGrant(
  db: Database,
  userId: string,
  now = new Date(),
): Promise<void> {
  await ensureMonthlyGrant(db, userId, now);
  await expireUnused(db, { type: "user", id: userId }, grantPeriod(now));
}
