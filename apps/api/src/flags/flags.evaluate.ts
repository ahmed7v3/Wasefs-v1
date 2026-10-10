import { createHash } from "node:crypto";

import { flagRulesSchema } from "@wasfa/shared/settings";

export interface FlagRow {
  key: string;
  enabled: boolean;
  /** As stored; checked against `flagRulesSchema` on every evaluation. */
  rules: unknown;
}

export interface FlagSubject {
  userId: string;
  orgIds: readonly string[];
  /** The subscription plan key. Plans arrive in Phase 2: `null` means `plan` rules never match. */
  plan: string | null;
}

/**
 * The stable bucket (0 to 99) of a user for one flag: the first four bytes of
 * `sha256(key:userId)`. Hashing the flag key in means the same user is not always in the first
 * percent of every rollout, and the same user always lands in the same bucket for the same flag,
 * so raising a percentage only ever adds users.
 */
export function bucket(key: string, userId: string): number {
  return createHash("sha256").update(`${key}:${userId}`).digest().readUInt32BE(0) % 100;
}

/** Pure: is this flag on for this subject? Unreadable rules mean off (fail closed). */
export function evaluateFlag(flag: FlagRow, subject: FlagSubject): boolean {
  if (!flag.enabled) return false;
  const parsed = flagRulesSchema.safeParse(flag.rules);
  if (!parsed.success) return false;
  const rules = parsed.data;
  switch (rules.type) {
    case "all":
      return true;
    case "user":
      return rules.userIds.includes(subject.userId);
    case "org":
      return rules.orgIds.some((orgId) => subject.orgIds.includes(orgId));
    case "percentage":
      return bucket(flag.key, subject.userId) < rules.percentage;
    case "plan":
      return subject.plan !== null && rules.plans.includes(subject.plan);
  }
}
