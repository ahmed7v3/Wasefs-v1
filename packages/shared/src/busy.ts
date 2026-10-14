/*
 * The "one long task at a time per user" lock. The api takes it when a prescription analysis or a
 * chat stream starts (QuotaService); the worker frees it when its rx job ends, so both must build
 * the very same key.
 */

export type BusyKind = "rx" | "chat";

/** Redis key of one user's lock for one kind of work. */
export const busyLockKey = (userId: string, kind: BusyKind): string => `busy:${userId}:${kind}`;
