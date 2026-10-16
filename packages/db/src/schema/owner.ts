import { sql } from "drizzle-orm";
import { check, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

import { organizations } from "./organizations.js";
import { users } from "./users.js";

/*
 * Owner pattern of every Phase 2 table that belongs to a user or an organization (DATABASE.md,
 * Phase 2). Two nullable columns with real foreign keys instead of a polymorphic
 * `(owner_type, owner_id)`, which could not have one. The user FK is RESTRICT (users are anonymized,
 * never deleted); the organization FK is CASCADE (an organization's data goes with it).
 */
export const ownerColumns = () => ({
  ownerUserId: uuid().references(() => users.id, { onDelete: "restrict" }),
  ownerOrgId: uuid().references(() => organizations.id, { onDelete: "cascade" }),
});

/**
 * Owner pattern of money tables (orders, subscriptions, taste grants): the same two columns, but the
 * organization FK is RESTRICT. Money history must never cascade away with an organization.
 */
export const billingOwnerColumns = () => ({
  ownerUserId: uuid().references(() => users.id, { onDelete: "restrict" }),
  ownerOrgId: uuid().references(() => organizations.id, { onDelete: "restrict" }),
});

interface OwnerTable {
  ownerUserId: AnyPgColumn;
  ownerOrgId: AnyPgColumn;
}

/** `<table>_owner_check`: exactly one owner. */
export function ownerCheck(tableName: string, table: OwnerTable) {
  return check(
    `${tableName}_owner_check`,
    sql`num_nonnulls(${table.ownerUserId}, ${table.ownerOrgId}) = 1`,
  );
}

/** `<table>_owner_check` for rows that may belong to nobody (system calls in `ai_usage`): at most one owner. */
export function optionalOwnerCheck(tableName: string, table: OwnerTable) {
  return check(
    `${tableName}_owner_check`,
    sql`num_nonnulls(${table.ownerUserId}, ${table.ownerOrgId}) <= 1`,
  );
}
