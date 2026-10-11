import { auditLogs, roles, userRoles, users, type Database } from "@wasfa/db";
import { eq } from "drizzle-orm";

/** The role the bootstrap command hands out (it must already be seeded). */
export const BOOTSTRAP_ROLE = "super_admin";

export type GrantResult =
  | { kind: "granted"; userId: string }
  | { kind: "already_granted"; userId: string }
  | { kind: "not_found" }
  | { kind: "not_active" }
  | { kind: "email_not_verified" }
  | { kind: "role_missing" };

/**
 * Makes the account with this email a super admin. Only an ACTIVE account whose email is verified
 * qualifies, so a typo or a squatted address cannot be promoted. The grant and its audit row
 * (actor null = the system, `via: "cli"`) are written in one transaction, and only when the role
 * was actually added: running it twice leaves one audit row.
 *
 * The caller needs no Redis: the API caches permissions for 5 minutes, so the new role is picked
 * up by itself within that time.
 */
export function grantSuperAdmin(db: Database, email: string): Promise<GrantResult> {
  return db.transaction(async (tx): Promise<GrantResult> => {
    const [user] = await tx
      .select({ id: users.id, status: users.status, emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.email, email));
    if (!user) return { kind: "not_found" };
    if (user.status !== "active") return { kind: "not_active" };
    if (!user.emailVerified) return { kind: "email_not_verified" };

    const [role] = await tx
      .select({ key: roles.key })
      .from(roles)
      .where(eq(roles.key, BOOTSTRAP_ROLE));
    if (!role) return { kind: "role_missing" };

    const inserted = await tx
      .insert(userRoles)
      .values({ userId: user.id, roleKey: BOOTSTRAP_ROLE, grantedBy: null })
      .onConflictDoNothing()
      .returning({ roleKey: userRoles.roleKey });
    if (inserted.length === 0) return { kind: "already_granted", userId: user.id };

    await tx.insert(auditLogs).values({
      actorId: null,
      action: "role.grant",
      targetType: "user",
      targetId: user.id,
      after: { roleKey: BOOTSTRAP_ROLE, via: "cli" },
    });
    return { kind: "granted", userId: user.id };
  });
}
