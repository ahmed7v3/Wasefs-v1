import { Injectable } from "@nestjs/common";
import { isForeignKeyViolation } from "@wasfa/db";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { AuditService } from "../audit/audit.service.js";
import { requireMembership, type OrgMembership } from "../common/scoped-repo.js";
import { RbacService } from "../rbac/rbac.service.js";

import { OrgsRepo, type MemberRow, type OrgChanges } from "./orgs.repo.js";

import type { AuditScope } from "../audit/audited.decorator.js";
import type { AuthenticatedUser } from "../common/current-user.js";
import type { OrgMemberRole } from "@wasfa/shared/identity";
import type { OrgResponse } from "@wasfa/shared/schemas/org";
import type { FastifyRequest } from "fastify";

export interface OrgMemberItem {
  userId: string;
  name: string;
  role: OrgMemberRole;
  joinedAt: string;
  isMe: boolean;
}

/** The fields of an organization that audit rows keep. */
const AUDITED_FIELDS = ["name", "type", "country", "city"] as const;

function auditView(org: Record<(typeof AUDITED_FIELDS)[number], unknown>) {
  return Object.fromEntries(AUDITED_FIELDS.map((field) => [field, org[field]]));
}

@Injectable()
export class OrgsService {
  constructor(
    private readonly repo: OrgsRepo,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The caller's membership in `orgId`, loaded from the database (never from a cache). A non-member
   * gets `NOT_FOUND`, a member without one of `roles` gets `FORBIDDEN`.
   */
  async authorize(
    userId: string,
    orgId: string,
    ...roles: OrgMemberRole[]
  ): Promise<OrgMembership> {
    const membership = await this.repo.membership(orgId, userId);
    return requireMembership(membership ? [{ orgId, role: membership.role }] : [], orgId, ...roles);
  }

  async list(user: AuthenticatedUser): Promise<{ items: OrgResponse[] }> {
    const mine = await this.repo.listForUser(user.id);
    const counts = await this.repo.memberCounts(mine.map(({ org }) => org.id));
    return {
      items: mine.map(({ org, role }) => ({
        id: org.id,
        name: org.name,
        type: org.type,
        country: org.country,
        city: org.city,
        myRole: role,
        memberCount: counts.get(org.id) ?? 0,
        createdAt: org.createdAt.toISOString(),
      })),
    };
  }

  async get(user: AuthenticatedUser, orgId: string): Promise<OrgResponse> {
    const { role } = await this.authorize(user.id, orgId);
    return this.view(orgId, role);
  }

  async update(
    user: AuthenticatedUser,
    orgId: string,
    changes: OrgChanges,
    audit: AuditScope,
  ): Promise<OrgResponse> {
    const { role } = await this.authorize(user.id, orgId, "org_admin");
    const before = await this.repo.findOrg(orgId);
    const after = await this.repo.updateOrg(orgId, changes);
    if (!before || !after) throw new AppError(ErrorCode.NOT_FOUND);
    audit.before = auditView(before);
    audit.after = auditView(after);
    return this.view(orgId, role);
  }

  async listMembers(user: AuthenticatedUser, orgId: string): Promise<{ items: OrgMemberItem[] }> {
    await this.authorize(user.id, orgId);
    const members = await this.repo.listMembers(orgId);
    return { items: members.map((member) => memberItem(member, user.id)) };
  }

  async changeRole(
    user: AuthenticatedUser,
    orgId: string,
    targetId: string,
    role: OrgMemberRole,
    audit: AuditScope,
  ): Promise<OrgMemberItem> {
    await this.authorize(user.id, orgId, "org_admin");
    const previous = await this.repo.withOrgLock(orgId, async (org) => {
      const current = await org.roleOf(targetId);
      if (!current) throw new AppError(ErrorCode.NOT_FOUND);
      if (current === "org_admin" && role === "org_member" && (await org.adminCount()) === 1) {
        throw new AppError(ErrorCode.CONFLICT, { details: { reason: "last_org_admin" } });
      }
      await org.setRole(targetId, role);
      return current;
    });
    audit.before = { role: previous };
    audit.after = { role };
    const member = await this.repo.findMember(orgId, targetId);
    if (!member) throw new AppError(ErrorCode.NOT_FOUND);
    return memberItem(member, user.id);
  }

  async removeMember(user: AuthenticatedUser, orgId: string, targetId: string): Promise<void> {
    await this.authorize(user.id, orgId, "org_admin");
    // Removing yourself would bypass the last-admin rule; leaving has its own endpoint.
    if (targetId === user.id) {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "use_leave" } });
    }
    await this.repo.withOrgLock(orgId, async (org) => {
      if (!(await org.roleOf(targetId))) throw new AppError(ErrorCode.NOT_FOUND);
      // The caller is an org_admin other than the target, so an admin always remains.
      await org.removeMember(targetId);
    });
    await this.rbac.bustUser(targetId);
  }

  /** The last member leaving deletes the organization; the last org_admin cannot leave the others behind. */
  async leave(
    user: AuthenticatedUser,
    orgId: string,
    audit: AuditScope,
    request: FastifyRequest,
  ): Promise<{ orgDeleted: boolean }> {
    await this.authorize(user.id, orgId);
    const orgDeleted = await this.repo
      .withOrgLock(orgId, async (org) => {
        const role = await org.roleOf(user.id);
        if (!role) throw new AppError(ErrorCode.NOT_FOUND);
        if ((await org.memberCount()) === 1) {
          await org.deleteOrg();
          return true;
        }
        if (role === "org_admin" && (await org.adminCount()) === 1) {
          throw new AppError(ErrorCode.CONFLICT, { details: { reason: "last_org_admin" } });
        }
        await org.removeMember(user.id);
        return false;
      })
      .catch((error: unknown) => {
        // Orders and subscriptions are money history and stay: an organization that has billed cannot be deleted.
        if (isForeignKeyViolation(error)) {
          throw new AppError(ErrorCode.CONFLICT, { details: { reason: "org_has_billing" } });
        }
        throw error;
      });
    await this.rbac.bustUser(user.id);
    audit.after = { orgDeleted };
    if (orgDeleted) {
      await this.audit.recordFor(request, {
        action: "org.delete",
        targetType: "org",
        targetId: orgId,
      });
    }
    return { orgDeleted };
  }

  private async view(orgId: string, myRole: OrgMemberRole): Promise<OrgResponse> {
    const org = await this.repo.findOrg(orgId);
    if (!org) throw new AppError(ErrorCode.NOT_FOUND);
    const counts = await this.repo.memberCounts([orgId]);
    return {
      id: org.id,
      name: org.name,
      type: org.type,
      country: org.country,
      city: org.city,
      myRole,
      memberCount: counts.get(orgId) ?? 0,
      createdAt: org.createdAt.toISOString(),
    };
  }
}

function memberItem(member: MemberRow, callerId: string): OrgMemberItem {
  return {
    userId: member.userId,
    name: member.name,
    role: member.role,
    joinedAt: member.joinedAt.toISOString(),
    isMe: member.userId === callerId,
  };
}
