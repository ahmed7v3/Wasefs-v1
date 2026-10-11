import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { isPlaceholderEmail, USAGE_INTENTS, type UsageIntent } from "@wasfa/shared/identity";
import { PinoLogger } from "nestjs-pino";

import { AuditService } from "../../audit/audit.service.js";
import { hasPermission } from "../../common/current-user.js";
import { EmailQueue } from "../../notifications/email-queue.js";
import { RbacService, SUPER_ADMIN_ROLE } from "../../rbac/rbac.service.js";
import { AdminAuditService } from "../audit/admin-audit.service.js";
import { decodeCursor, toPage } from "../common/keyset.js";
import { AdminRolesService } from "../roles/admin-roles.service.js";

import { AdminUsersRepo, type UserDetailRow, type UserListRow } from "./admin-users.repo.js";

import type { AuditScope } from "../../audit/audited.decorator.js";
import type { AuthenticatedUser } from "../../common/current-user.js";
import type { AdminUser, AdminUserDetail, AdminUserListQuery } from "@wasfa/shared/schemas/admin";
import type { FastifyRequest } from "fastify";

const isUsageIntent = (value: string): value is UsageIntent =>
  (USAGE_INTENTS as readonly string[]).includes(value);

const toAdminUser = (row: UserListRow | UserDetailRow, roles: string[]): AdminUser => ({
  id: row.id,
  name: row.name,
  // Phone-only accounts carry a placeholder address; it is never shown.
  email: isPlaceholderEmail(row.email) ? null : row.email,
  phone: row.phone,
  emailVerified: row.emailVerified,
  phoneVerified: row.phoneVerified,
  status: row.status,
  roles,
  accountType: row.accountType,
  createdAt: row.createdAt.toISOString(),
  lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
});

const conflict = (reason: string) => new AppError(ErrorCode.CONFLICT, { details: { reason } });
const forbidden = (reason: string) => new AppError(ErrorCode.FORBIDDEN, { details: { reason } });

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly repo: AdminUsersRepo,
    private readonly roles: AdminRolesService,
    private readonly auditView: AdminAuditService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly emails: EmailQueue,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("AdminUsers");
  }

  async list(query: AdminUserListQuery) {
    const rows = await this.repo.list(
      { q: query.q, status: query.status, role: query.role },
      decodeCursor(query.cursor, "uuid"),
      query.limit,
    );
    const page = toPage(rows, query.limit, (row) => ({ at: row.cursorAt, key: row.id }));
    const roles = await this.repo.rolesOf(page.items.map((row) => row.id));
    return {
      items: page.items.map((row) => toAdminUser(row, roles.get(row.id) ?? [])),
      nextCursor: page.nextCursor,
    };
  }

  async detail(userId: string): Promise<AdminUserDetail> {
    const row = await this.repo.find(userId);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    const [roles, profile, organizations, sessions, recentAudit] = await Promise.all([
      this.repo.roleKeys(userId),
      this.repo.profile(userId),
      this.repo.memberships(userId),
      this.repo.liveSessions(userId),
      this.auditView.recentForUser(userId),
    ]);
    return {
      user: {
        ...toAdminUser(row, roles),
        suspendedReason: row.suspendedReason,
        twoFactorEnabled: row.twoFactorEnabled,
        deletedAt: row.deletedAt?.toISOString() ?? null,
        locale: row.locale,
      },
      profile: {
        displayName: profile?.displayName ?? null,
        profession: profile?.profession ?? null,
        usageIntent: (profile?.usageIntent ?? []).filter(isUsageIntent),
        country: profile?.country ?? null,
        city: profile?.city ?? null,
      },
      organizations,
      sessions: [...sessions]
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .map((session) => ({
          id: session.id,
          createdAt: session.createdAt.toISOString(),
          lastSeenAt: session.updatedAt.toISOString(),
          expiresAt: session.expiresAt.toISOString(),
          ipAddress: session.ipAddress,
          userAgent: session.userAgent,
        })),
      recentAudit,
    };
  }

  /** Suspends, ends every session of the target and tells them by email. Audited by the route. */
  async suspend(
    actor: AuthenticatedUser,
    targetId: string,
    reason: string,
    audit: AuditScope,
  ): Promise<{ status: "suspended" }> {
    if (actor.id === targetId) throw conflict("self_action");
    // A suspended super admin could not be undone by anyone but a super admin: only one may do it.
    if (!actor.isSuperAdmin && (await this.repo.roleKeys(targetId)).includes(SUPER_ADMIN_ROLE)) {
      throw forbidden("super_admin_only");
    }

    const outcome = await this.repo.suspend(targetId, reason);
    if (outcome.kind === "not_found") throw new AppError(ErrorCode.NOT_FOUND);
    if (outcome.kind === "invalid_status") throw conflict("invalid_status");

    await this.rbac.bustUser(targetId);
    await this.notifySuspended(targetId, outcome);
    audit.before = { status: "active" };
    audit.after = { status: "suspended", reason };
    return { status: "suspended" };
  }

  async unsuspend(
    actor: AuthenticatedUser,
    targetId: string,
    reason: string,
    audit: AuditScope,
  ): Promise<{ status: "active" }> {
    if (actor.id === targetId) throw conflict("self_action");
    // Symmetric with suspend: a super admin suspended by another super admin (e.g. a compromised
    // account) must not be restored by a plain admin.
    if (!actor.isSuperAdmin && (await this.repo.roleKeys(targetId)).includes(SUPER_ADMIN_ROLE)) {
      throw forbidden("super_admin_only");
    }
    const outcome = await this.repo.unsuspend(targetId);
    if (outcome === "not_found") throw new AppError(ErrorCode.NOT_FOUND);
    if (outcome === "invalid_status") throw conflict("invalid_status");
    audit.before = { status: "suspended" };
    audit.after = { status: "active", reason };
    return { status: "active" };
  }

  grantRole(
    actor: AuthenticatedUser,
    request: FastifyRequest,
    targetId: string,
    roleKey: string,
    reason: string,
  ) {
    return this.changeRole("role.grant", actor, request, targetId, roleKey, reason);
  }

  revokeRole(
    actor: AuthenticatedUser,
    request: FastifyRequest,
    targetId: string,
    roleKey: string,
    reason: string,
  ) {
    return this.changeRole("role.revoke", actor, request, targetId, roleKey, reason);
  }

  /**
   * SECURITY.md section 5: nobody changes their own roles; only `super_admin` touches `super_admin`;
   * anyone else may only hand out (or take away) roles whose every permission they hold themselves,
   * otherwise `users.roles.write` would let an admin promote anyone, themselves included.
   * Grant and revoke are idempotent: nothing changes, so nothing is audited.
   */
  private async changeRole(
    action: "role.grant" | "role.revoke",
    actor: AuthenticatedUser,
    request: FastifyRequest,
    targetId: string,
    roleKey: string,
    reason: string,
  ): Promise<{ roles: string[]; changed: boolean }> {
    // `user` is implicit: every account has it, and it has no row to add or remove.
    if (roleKey === "user") {
      throw new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: ["roleKey"] } });
    }
    if (actor.id === targetId) throw conflict("self_action");
    const role = await this.roles.findWithPermissions(roleKey);
    if (!role) throw new AppError(ErrorCode.NOT_FOUND);
    if (roleKey === SUPER_ADMIN_ROLE && !actor.isSuperAdmin) throw forbidden("super_admin_only");
    if (!actor.isSuperAdmin && !role.permissions.every((p) => hasPermission(actor, p))) {
      throw forbidden("not_enough_permissions");
    }
    const target = await this.repo.find(targetId);
    if (!target) throw new AppError(ErrorCode.NOT_FOUND);
    if (target.status === "deleted") throw conflict("invalid_status");

    let changed: boolean;
    if (action === "role.grant") {
      changed = await this.repo.grantRole(targetId, roleKey, actor.id);
    } else {
      const outcome = await this.repo.revokeRole(targetId, roleKey, roleKey === SUPER_ADMIN_ROLE);
      if (outcome === "last_super_admin") throw conflict("last_super_admin");
      changed = outcome === "revoked";
    }

    if (changed) {
      await this.rbac.bustUser(targetId);
      await this.audit.recordFor(
        request,
        { actorId: actor.id, action, targetType: "user", targetId, after: { roleKey, reason } },
        { fields: ["roleKey", "reason"] },
      );
    }
    return { roles: await this.repo.roleKeys(targetId), changed };
  }

  private async notifySuspended(
    userId: string,
    target: { email: string; name: string; locale: "ar" | "en" },
  ): Promise<void> {
    if (isPlaceholderEmail(target.email)) return;
    try {
      await this.emails.sendAccountSuspended({
        to: target.email,
        name: target.name,
        locale: target.locale,
      });
    } catch (error) {
      // The suspension stands; a missing notice must not turn it into an error. Name only, no address.
      this.logger.warn(
        { userId, error: (error as Error).name },
        "Account suspended notice was not queued",
      );
    }
  }
}
