import { and, eq, isNull, or, sql } from "drizzle-orm";

import { rolePermissions, userRoles } from "./schema/rbac.js";
import { users } from "./schema/users.js";

import type { Database } from "./client.js";
import type { Transaction } from "./credits-ledger.js";

type QueryHandle = Database | Transaction;

/** Active, non-anonymized admins who can receive alerts of the requested permission. */
export async function adminRecipients(
  db: QueryHandle,
  permission: string,
): Promise<Array<typeof users.$inferSelect>> {
  const superAdmin = db
    .select({ one: sql`1` })
    .from(userRoles)
    .where(and(eq(userRoles.userId, users.id), eq(userRoles.roleKey, "super_admin")));
  const hasReceive = db
    .select({ one: sql`1` })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleKey, userRoles.roleKey))
    .where(and(eq(userRoles.userId, users.id), eq(rolePermissions.permission, "alerts.receive")));
  const hasPermission = db
    .select({ one: sql`1` })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleKey, userRoles.roleKey))
    .where(and(eq(userRoles.userId, users.id), eq(rolePermissions.permission, permission)));
  const rows = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.status, "active"),
        isNull(users.anonymizedAt),
        or(
          sql`exists (${superAdmin})`,
          and(sql`exists (${hasReceive})`, sql`exists (${hasPermission})`),
        ),
      ),
    );
  return rows;
}

/** Uses the RBAC wildcard semantics: super_admin holds every permission. */
export async function holdsPermission(
  db: QueryHandle,
  userId: string,
  permission: string,
): Promise<boolean> {
  const [row] = await db
    .select({ userId: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, userId),
        eq(users.status, "active"),
        isNull(users.anonymizedAt),
        sql`exists (
          select 1 from ${userRoles}
          where ${userRoles.userId} = ${users.id}
            and (${userRoles.roleKey} = 'super_admin' or exists (
              select 1 from ${rolePermissions}
              where ${rolePermissions.roleKey} = ${userRoles.roleKey}
                and ${rolePermissions.permission} = ${permission}
            ))
        )`,
      ),
    );
  return row !== undefined;
}
