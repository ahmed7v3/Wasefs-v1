import { BILLING_KEY_PATTERN } from "@wasfa/shared/billing";
import {
  REFERRAL_CODE_KINDS,
  REFERRAL_CODE_PATTERN,
  REFERRAL_PROGRAM_KINDS,
} from "@wasfa/shared/rewards";
import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { idColumn, inList, matches, timestamps } from "./columns.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";

/*
 * Referral programs and codes (Phase 3, Task 3.1; docs/REFERRALS-REWARDS.md §2-§3). Kept apart from
 * rewards.ts so that deals can point at a code without a module cycle through files.ts, which would
 * evaluate the owner-column helpers before they exist.
 */
export const referralPrograms = pgTable(
  "referral_programs",
  {
    id: idColumn(),
    key: text().notNull().unique("referral_programs_key_key"),
    kind: text({ enum: REFERRAL_PROGRAM_KINDS }).notNull(),
    nameAr: text().notNull(),
    nameEn: text().notNull(),
    // A paused program evaluates no new rewards.
    active: boolean().notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    check("referral_programs_key_check", matches(table.key, BILLING_KEY_PATTERN.source)),
    check("referral_programs_kind_check", inList(table.kind, REFERRAL_PROGRAM_KINDS)),
  ],
);

export const referralCodes = pgTable(
  "referral_codes",
  {
    id: idColumn(),
    code: text().notNull().unique("referral_codes_code_key"),
    kind: text({ enum: REFERRAL_CODE_KINDS }).notNull(),
    programId: uuid()
      .notNull()
      .references(() => referralPrograms.id, { onDelete: "restrict" }),
    // Campaign codes belong to nobody; a user code and a partner code to a user; an org code to an org.
    ownerUserId: uuid().references(() => users.id, { onDelete: "restrict" }),
    ownerOrgId: uuid().references(() => organizations.id, { onDelete: "cascade" }),
    // The one-time vanity edit has been used.
    vanityEdited: boolean().notNull().default(false),
    active: boolean().notNull().default(true),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    check("referral_codes_code_check", matches(table.code, REFERRAL_CODE_PATTERN.source)),
    check("referral_codes_kind_check", inList(table.kind, REFERRAL_CODE_KINDS)),
    check(
      "referral_codes_owner_check",
      sql`num_nonnulls(${table.ownerUserId}, ${table.ownerOrgId}) <= 1`,
    ),
    // Every user has at most one personal code.
    uniqueIndex("referral_codes_user_kind_key")
      .on(table.ownerUserId)
      .where(sql`${table.kind} = 'user'`),
    index("referral_codes_owner_user_idx")
      .on(table.ownerUserId)
      .where(sql`${table.ownerUserId} is not null`),
  ],
);

export type ReferralProgram = typeof referralPrograms.$inferSelect;
export type NewReferralProgram = typeof referralPrograms.$inferInsert;
export type ReferralCode = typeof referralCodes.$inferSelect;
export type NewReferralCode = typeof referralCodes.$inferInsert;
