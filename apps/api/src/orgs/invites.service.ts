import { createHash, randomBytes } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { isPlaceholderEmail } from "@wasfa/shared/identity";
import {
  INVITE_TTL_DAYS,
  MAX_INVITES_PER_USER_PER_DAY,
  MAX_PENDING_INVITES_PER_ORG,
  maskInviteTarget,
  type OrgResponse,
} from "@wasfa/shared/schemas/org";

import { AuthRateLimiter } from "../auth/rate-limiter.js";
import { API_ENV } from "../config/config.module.js";
import { EmailQueue } from "../notifications/email-queue.js";
import { RbacService } from "../rbac/rbac.service.js";

import { OrgsRepo, type InviteTarget, type VerifiedIdentity } from "./orgs.repo.js";
import { OrgsService } from "./orgs.service.js";

import type { CreateInviteBody } from "./orgs.schemas.js";
import type { AuditScope } from "../audit/audited.decorator.js";
import type { AuthenticatedUser } from "../common/current-user.js";
import type { ApiEnv } from "../config/env.js";
import type { OrganizationInvite } from "@wasfa/db";
import type { OrgMemberRole, OrgType } from "@wasfa/shared/identity";

const DAY_SECONDS = 24 * 60 * 60;

export interface OrgInviteItem {
  id: string;
  channel: "email" | "phone";
  target: string;
  role: OrgMemberRole;
  expiresAt: string;
  createdAt: string;
}

export interface MyInviteItem {
  id: string;
  orgId: string;
  orgName: string;
  orgType: OrgType;
  role: OrgMemberRole;
  expiresAt: string;
}

/** Only the hash is stored, so a database leak cannot be turned into working invitation links. */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function inviteItem(invite: OrganizationInvite): OrgInviteItem {
  const channel = invite.email === null ? "phone" : "email";
  return {
    id: invite.id,
    channel,
    target: maskInviteTarget(invite.email ?? invite.phone ?? ""),
    role: invite.role,
    expiresAt: invite.expiresAt.toISOString(),
    createdAt: invite.createdAt.toISOString(),
  };
}

@Injectable()
export class InvitesService {
  private readonly webOrigin: string;

  constructor(
    @Inject(API_ENV) env: ApiEnv,
    private readonly repo: OrgsRepo,
    private readonly orgs: OrgsService,
    private readonly limiter: AuthRateLimiter,
    private readonly emails: EmailQueue,
    private readonly rbac: RbacService,
  ) {
    const [origin] = env.WEB_ORIGIN;
    if (!origin) throw new Error("WEB_ORIGIN must list at least one origin");
    this.webOrigin = origin;
  }

  async listForOrg(user: AuthenticatedUser, orgId: string): Promise<{ items: OrgInviteItem[] }> {
    await this.orgs.authorize(user.id, orgId, "org_admin");
    return { items: (await this.repo.pendingInvites(orgId)).map(inviteItem) };
  }

  async create(
    user: AuthenticatedUser,
    orgId: string,
    input: CreateInviteBody,
    audit: AuditScope,
  ): Promise<OrgInviteItem> {
    await this.orgs.authorize(user.id, orgId, "org_admin");
    // Every invitation may send an email: cap per inviter before doing any work (fails closed).
    await this.limiter.hit(`org-invite:user:${user.id}`, MAX_INVITES_PER_USER_PER_DAY, DAY_SECONDS);

    const target: InviteTarget = "email" in input ? { email: input.email } : { phone: input.phone };
    const org = await this.repo.findOrg(orgId);
    if (!org) throw new AppError(ErrorCode.NOT_FOUND);

    const token = randomBytes(32).toString("base64url");
    const invite = await this.repo.withOrgLock(orgId, async (locked) => {
      if ((await locked.pendingInviteCount()) >= MAX_PENDING_INVITES_PER_ORG) {
        throw new AppError(ErrorCode.QUOTA_EXCEEDED, {
          details: { reason: "pending_invites_limit" },
        });
      }
      if (await locked.hasMemberWithContact(target)) {
        throw new AppError(ErrorCode.CONFLICT, { details: { reason: "already_member" } });
      }
      if (await locked.hasPendingInvite(target)) {
        throw new AppError(ErrorCode.CONFLICT, { details: { reason: "invite_pending" } });
      }
      return locked.insertInvite({
        ...target,
        role: input.role,
        tokenHash: hashInviteToken(token),
        invitedBy: user.id,
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * DAY_SECONDS * 1000),
      });
    });

    // Phone invitations send nothing: our WhatsApp number never starts conversations. The invitee
    // finds it in `GET /me/invites` once their phone is verified.
    if ("email" in target) {
      try {
        await this.emails.sendOrgInvite(
          { to: target.email },
          {
            // In the fragment, so the token never reaches a server log or a Referer header.
            link: `${this.webOrigin}/invite#${token}`,
            orgName: org.name,
            inviterName: user.name,
          },
        );
      } catch (error) {
        // An invitation nobody was told about would only block the next attempt as `invite_pending`.
        await this.repo.removeInvite(orgId, invite.id);
        throw error;
      }
    }

    audit.targetId = invite.id;
    audit.after = { role: invite.role, channel: "email" in target ? "email" : "phone" };
    return inviteItem(invite);
  }

  async revoke(user: AuthenticatedUser, orgId: string, inviteId: string): Promise<void> {
    await this.orgs.authorize(user.id, orgId, "org_admin");
    const invite = await this.repo.findInvite(orgId, inviteId);
    if (!invite || invite.acceptedAt !== null || invite.expiresAt.getTime() <= Date.now()) {
      throw new AppError(ErrorCode.NOT_FOUND);
    }
    await this.repo.removeInvite(orgId, inviteId);
  }

  async listMine(user: AuthenticatedUser): Promise<{ items: MyInviteItem[] }> {
    const rows = await this.repo.pendingInvitesFor(await this.identityOf(user.id));
    return {
      items: rows.map((row) => ({
        id: row.id,
        orgId: row.orgId,
        orgName: row.orgName,
        orgType: row.orgType,
        role: row.role,
        expiresAt: row.expiresAt.toISOString(),
      })),
    };
  }

  /** Accept by id (`/me/invites/:id/accept`) or by the token of the email link; both end up here. */
  async accept(
    user: AuthenticatedUser,
    lookup: { id: string } | { token: string },
    audit: AuditScope,
  ): Promise<OrgResponse> {
    const identity = await this.identityOf(user.id);
    const result = await this.repo.acceptInvite(
      "id" in lookup ? lookup : { tokenHash: hashInviteToken(lookup.token) },
      identity,
      user.id,
    );
    if (result.outcome === "not_found") throw new AppError(ErrorCode.NOT_FOUND);
    if (result.outcome === "already_member") {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "already_member" } });
    }
    // The cached list of the caller's organizations is stale from this moment.
    await this.rbac.bustUser(user.id);
    audit.targetId = result.orgId;
    audit.after = { role: result.role };
    return this.orgs.get(user, result.orgId);
  }

  /** Only verified contact data may claim an invitation; a placeholder email is never one. */
  private async identityOf(userId: string): Promise<VerifiedIdentity> {
    const contact = await this.repo.findContact(userId);
    if (!contact) throw new AppError(ErrorCode.AUTH_REQUIRED);
    return {
      email: contact.emailVerified && !isPlaceholderEmail(contact.email) ? contact.email : null,
      phone: contact.phoneVerified ? contact.phone : null,
    };
  }
}
