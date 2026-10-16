import {
  COUNTRY_CODE_PATTERN,
  E164_PATTERN,
  ORG_MEMBER_ROLES,
  ORG_TYPES,
} from "@wasfa/shared/identity";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { citext, idColumn, inList, matches, timestamps } from "./columns.js";
import { organizationJoinLinks } from "./deals.js";
import { users } from "./users.js";

/*
 * Organizations are our own tables, not Better Auth's `organization` plugin: custom DB-defined
 * roles, audit on every change and `scopedRepo` all need full control (Phase 1 decision #1).
 * An organization is hard-deleted (no soft delete); members and invites go with it.
 * Invariant kept by the service layer, not the DB: every organization keeps at least one `org_admin`.
 */
export const organizations = pgTable(
  "organizations",
  {
    id: idColumn(),
    name: text().notNull(),
    type: text({ enum: ORG_TYPES }).notNull(),
    country: text().notNull(),
    city: text(),
    // Phase 3 (BILLING §8): may a member fall back to personal credits when the organization wallet is empty?
    allowPersonalFallback: boolean().notNull().default(false),
    // The founder. RESTRICT: users are anonymized, never deleted, so this row can never dangle.
    createdBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (table) => [
    check("organizations_type_check", inList(table.type, ORG_TYPES)),
    check("organizations_country_check", matches(table.country, COUNTRY_CODE_PATTERN.source)),
    check("organizations_name_check", sql`char_length(btrim(${table.name})) > 0`),
  ],
);

/** Membership. Ownership column for org data: every org-scoped query joins through (`org_id`, `user_id`). */
export const organizationMembers = pgTable(
  "organization_members",
  {
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text({ enum: ORG_MEMBER_ROLES }).notNull().default("org_member"),
    invitedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    joinedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // Phase 3: the join link the member arrived through (its deal terms follow the member).
    joinedViaLinkId: uuid(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.userId], name: "organization_members_pkey" }),
    check("organization_members_role_check", inList(table.role, ORG_MEMBER_ROLES)),
    // Explicit name: the generated one is over 63 characters.
    foreignKey({
      name: "organization_members_join_link_fk",
      columns: [table.joinedViaLinkId],
      foreignColumns: [organizationJoinLinks.id],
    }).onDelete("set null"),
    // "Which organizations am I in?" (the primary key already serves "who is in this org?").
    index("organization_members_user_id_idx").on(table.userId),
  ],
);

/** Pending invitation to join. The token is sent by email and only its SHA-256 hash is stored. */
export const organizationInvites = pgTable(
  "organization_invites",
  {
    id: idColumn(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Exactly one of the two identifies the invitee; it must match the account that accepts.
    email: citext(),
    phone: text(),
    tokenHash: text().notNull().unique("organization_invites_token_hash_key"),
    role: text({ enum: ORG_MEMBER_ROLES }).notNull().default("org_member"),
    invitedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    // Single use: set when accepted, never cleared.
    acceptedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("organization_invites_role_check", inList(table.role, ORG_MEMBER_ROLES)),
    check(
      "organization_invites_one_target_check",
      sql`num_nonnulls(${table.email}, ${table.phone}) = 1`,
    ),
    check(
      "organization_invites_phone_format_check",
      sql`${table.phone} is null or ${matches(table.phone, E164_PATTERN.source)}`,
    ),
    index("organization_invites_org_id_idx").on(table.orgId),
  ],
);

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type NewOrganizationMember = typeof organizationMembers.$inferInsert;
export type OrganizationInvite = typeof organizationInvites.$inferSelect;
export type NewOrganizationInvite = typeof organizationInvites.$inferInsert;
