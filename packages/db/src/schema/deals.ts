import { ORG_MEMBER_ROLES } from "@wasfa/shared/identity";
import {
  DEAL_STATUSES,
  DEAL_TARGET_KINDS,
  EMAIL_DOMAIN_PATTERN,
  JOIN_LINK_APPROVALS,
  SLUG_PATTERN,
} from "@wasfa/shared/rewards";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { idColumn, inList, matches, timestamps } from "./columns.js";
import { organizationMembers, organizations } from "./organizations.js";
import { referralCodes } from "./referral-codes.js";
import { users } from "./users.js";

/*
 * Deals (Phase 3, Task 3.1; REFERRALS-REWARDS §7): a named bundle of terms assigned to targets.
 * `terms` is validated by `dealTermsSchema` (strict at every level) before every write.
 */
export const deals = pgTable(
  "deals",
  {
    id: idColumn(),
    name: text().notNull(),
    status: text({ enum: DEAL_STATUSES }).notNull().default("draft"),
    startsAt: timestamp({ withTimezone: true }),
    endsAt: timestamp({ withTimezone: true }),
    terms: jsonb().$type<Record<string, unknown>>().notNull(),
    // Internal.
    notes: text(),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    check("deals_status_check", inList(table.status, DEAL_STATUSES)),
    check(
      "deals_period_check",
      sql`${table.startsAt} is null or ${table.endsAt} is null or ${table.endsAt} > ${table.startsAt}`,
    ),
    check("deals_terms_check", sql`jsonb_typeof(${table.terms}) = 'object'`),
    check("deals_name_check", sql`char_length(btrim(${table.name})) > 0`),
  ],
);

/** Who a deal applies to. Exactly one target column is set, the one `target_kind` names. */
export const dealTargets = pgTable(
  "deal_targets",
  {
    id: idColumn(),
    dealId: uuid()
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    targetKind: text({ enum: DEAL_TARGET_KINDS }).notNull(),
    targetUserId: uuid().references(() => users.id, { onDelete: "cascade" }),
    targetOrgId: uuid().references(() => organizations.id, { onDelete: "cascade" }),
    referralCodeId: uuid().references(() => referralCodes.id, { onDelete: "cascade" }),
    // A verified email domain, e.g. `alnour-pharmacy.com`.
    emailDomain: text(),
    // The deal applies to organization members, not to the organization itself.
    memberOnly: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("deal_targets_kind_check", inList(table.targetKind, DEAL_TARGET_KINDS)),
    check(
      "deal_targets_target_check",
      sql`num_nonnulls(${table.targetUserId}, ${table.targetOrgId}, ${table.referralCodeId}, ${table.emailDomain}) = 1
        and (
          (${table.targetKind} = 'user' and ${table.targetUserId} is not null)
          or (${table.targetKind} = 'organization' and ${table.targetOrgId} is not null)
          or (${table.targetKind} = 'referral_code' and ${table.referralCodeId} is not null)
          or (${table.targetKind} = 'email_domain' and ${table.emailDomain} is not null)
        )`,
    ),
    check(
      "deal_targets_email_domain_check",
      sql`${table.emailDomain} is null or ${matches(table.emailDomain, EMAIL_DOMAIN_PATTERN.source)}`,
    ),
    index("deal_targets_deal_idx").on(table.dealId),
    index("deal_targets_user_idx")
      .on(table.targetUserId)
      .where(sql`${table.targetUserId} is not null`),
    index("deal_targets_org_idx")
      .on(table.targetOrgId)
      .where(sql`${table.targetOrgId} is not null`),
    index("deal_targets_code_idx")
      .on(table.referralCodeId)
      .where(sql`${table.referralCodeId} is not null`),
    index("deal_targets_domain_idx")
      .on(table.emailDomain)
      .where(sql`${table.emailDomain} is not null`),
  ],
);

/** `/join/<slug>`: an institution's invitation link, optionally carrying a deal (REFERRALS §7.4). */
export const organizationJoinLinks = pgTable(
  "organization_join_links",
  {
    id: idColumn(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    slug: text().notNull().unique("organization_join_links_slug_key"),
    role: text({ enum: ORG_MEMBER_ROLES }).notNull().default("org_member"),
    dealId: uuid().references(() => deals.id, { onDelete: "set null" }),
    maxUses: integer(),
    usedCount: integer().notNull().default(0),
    expiresAt: timestamp({ withTimezone: true }),
    approval: text({ enum: JOIN_LINK_APPROVALS }).notNull().default("auto_approve"),
    active: boolean().notNull().default(true),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    check("organization_join_links_slug_check", matches(table.slug, SLUG_PATTERN.source)),
    check("organization_join_links_role_check", inList(table.role, ORG_MEMBER_ROLES)),
    check("organization_join_links_approval_check", inList(table.approval, JOIN_LINK_APPROVALS)),
    check(
      "organization_join_links_uses_check",
      sql`${table.usedCount} >= 0 and (${table.maxUses} is null or (${table.maxUses} > 0 and ${table.usedCount} <= ${table.maxUses}))`,
    ),
    index("organization_join_links_org_idx").on(table.orgId),
  ],
);

/** Optional monthly credit cap for one member, set by an organization admin. */
export const organizationMemberLimits = pgTable(
  "organization_member_limits",
  {
    orgId: uuid().notNull(),
    userId: uuid().notNull(),
    monthlyCreditCap: integer().notNull(),
    setBy: uuid().references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.userId], name: "organization_member_limits_pkey" }),
    // The limit goes away with the membership. (Explicit name: the generated one is over 63 characters.)
    foreignKey({
      name: "organization_member_limits_member_fk",
      columns: [table.orgId, table.userId],
      foreignColumns: [organizationMembers.orgId, organizationMembers.userId],
    }).onDelete("cascade"),
    check("organization_member_limits_cap_check", sql`${table.monthlyCreditCap} >= 0`),
  ],
);

export type Deal = typeof deals.$inferSelect;
export type NewDeal = typeof deals.$inferInsert;
export type DealTarget = typeof dealTargets.$inferSelect;
export type NewDealTarget = typeof dealTargets.$inferInsert;
export type OrganizationJoinLink = typeof organizationJoinLinks.$inferSelect;
export type NewOrganizationJoinLink = typeof organizationJoinLinks.$inferInsert;
export type OrganizationMemberLimit = typeof organizationMemberLimits.$inferSelect;
export type NewOrganizationMemberLimit = typeof organizationMemberLimits.$inferInsert;
