import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_KEYS,
  isPermission,
  type Permission,
  type PermissionGroup,
} from "@wasfa/shared/permissions";

import { RbacService, SUPER_ADMIN_ROLE } from "../../rbac/rbac.service.js";

import { AdminRolesRepo, type RoleRow } from "./admin-roles.repo.js";

import type { AuditScope } from "../../audit/audited.decorator.js";
import type { AuthenticatedUser } from "../../common/current-user.js";
import type { AdminRole, PermissionCatalog } from "@wasfa/shared/schemas/admin";

interface CreateRoleInput {
  key: string;
  nameAr: string;
  nameEn: string;
  permissions: readonly Permission[];
}

interface UpdateRoleInput {
  nameAr?: string | undefined;
  nameEn?: string | undefined;
  permissions?: readonly Permission[] | undefined;
}

const catalogOrder = (permissions: string[]): Permission[] =>
  PERMISSION_KEYS.filter((key) => permissions.includes(key));

/** Fields kept in the audit rows of role changes. */
export const ROLE_AUDIT_FIELDS = ["key", "nameAr", "nameEn", "permissions"] as const;

@Injectable()
export class AdminRolesService {
  constructor(
    private readonly repo: AdminRolesRepo,
    private readonly rbac: RbacService,
  ) {}

  async list(): Promise<{ items: AdminRole[] }> {
    const [roles, byRole] = await Promise.all([this.repo.list(), this.repo.permissionsByRole()]);
    return {
      items: roles.map((role) => ({
        ...this.view(role, byRole.get(role.key) ?? []),
        holders: role.holders,
      })),
    };
  }

  /** The catalog grouped for the role editor; labels come from code, never from the database. */
  catalog(): PermissionCatalog {
    return {
      groups: (Object.keys(PERMISSION_GROUPS) as PermissionGroup[]).map((group) => ({
        key: group,
        label: PERMISSION_GROUPS[group],
        permissions: PERMISSION_KEYS.filter((key) => PERMISSIONS[key].group === group).map(
          (key) => ({ key, label: PERMISSIONS[key].label }),
        ),
      })),
    };
  }

  /** The role and what it grants; `super_admin` holds the whole catalog (wildcard in the resolver). */
  async findWithPermissions(
    key: string,
  ): Promise<(RoleRow & { permissions: Permission[] }) | null> {
    const role = await this.repo.find(key);
    if (!role) return null;
    const stored = key === SUPER_ADMIN_ROLE ? PERMISSION_KEYS : await this.repo.permissionsOf(key);
    return { ...role, permissions: catalogOrder(stored) };
  }

  async create(
    actor: AuthenticatedUser,
    input: CreateRoleInput,
    audit: AuditScope,
  ): Promise<AdminRole> {
    this.requireSuperAdmin(actor);
    const permissions = catalogOrder([...input.permissions]);
    const created = await this.repo.create(
      { key: input.key, nameAr: input.nameAr, nameEn: input.nameEn },
      permissions,
    );
    if (!created) throw new AppError(ErrorCode.CONFLICT, { details: { reason: "role_exists" } });
    audit.targetId = input.key;
    audit.after = {
      key: input.key,
      nameAr: input.nameAr,
      nameEn: input.nameEn,
      permissions,
    };
    return {
      key: input.key,
      nameAr: input.nameAr,
      nameEn: input.nameEn,
      isSystem: false,
      permissions,
      holders: 0,
    };
  }

  async update(
    actor: AuthenticatedUser,
    key: string,
    input: UpdateRoleInput,
    audit: AuditScope,
  ): Promise<AdminRole> {
    this.requireSuperAdmin(actor);
    const role = await this.repo.find(key);
    if (!role) throw new AppError(ErrorCode.NOT_FOUND);
    // The wildcard role is not an editable list of permissions: nobody can weaken or rename it.
    if (key === SUPER_ADMIN_ROLE) {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "role_read_only" } });
    }

    const changes = await this.repo.update(key, {
      nameAr: input.nameAr,
      nameEn: input.nameEn,
      permissions:
        input.permissions === undefined ? undefined : catalogOrder([...input.permissions]),
    });
    if (!changes) throw new AppError(ErrorCode.NOT_FOUND);

    // Holders of the role lose or gain access now, not when their 5-minute cache expires.
    await this.rbac.bustRole(key);
    audit.targetId = key;
    audit.before = changes.before;
    audit.after = changes.after;
    const holders = (await this.repo.list()).find((row) => row.key === key)?.holders ?? 0;
    return {
      key,
      nameAr: changes.after.nameAr,
      nameEn: changes.after.nameEn,
      isSystem: role.isSystem,
      permissions: catalogOrder(changes.after.permissions),
      holders,
    };
  }

  async remove(actor: AuthenticatedUser, key: string, audit: AuditScope): Promise<void> {
    this.requireSuperAdmin(actor);
    const role = await this.findWithPermissions(key);
    if (!role) throw new AppError(ErrorCode.NOT_FOUND);
    if (role.isSystem) {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "system_role" } });
    }

    const outcome = await this.repo.remove(key);
    if (outcome === "not_found") throw new AppError(ErrorCode.NOT_FOUND);
    if (outcome === "in_use") {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "role_in_use" } });
    }
    audit.targetId = key;
    audit.before = {
      key,
      nameAr: role.nameAr,
      nameEn: role.nameEn,
      permissions: role.permissions,
    };
  }

  /** Role editing is `super_admin` only (SECURITY.md section 5.4), on top of `roles.write`. */
  private requireSuperAdmin(actor: AuthenticatedUser): void {
    if (!actor.isSuperAdmin) {
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: "super_admin_only" } });
    }
  }

  private view(role: RoleRow, stored: string[]): Omit<AdminRole, "holders"> {
    // Stale strings (a permission dropped from the catalog) are hidden, like the resolver ignores them.
    const permissions =
      role.key === SUPER_ADMIN_ROLE ? PERMISSION_KEYS : catalogOrder(stored.filter(isPermission));
    return {
      key: role.key,
      nameAr: role.nameAr,
      nameEn: role.nameEn,
      isSystem: role.isSystem,
      permissions,
    };
  }
}
