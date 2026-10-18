import { Inject, Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { isPlaceholderEmail } from "@wasfa/shared/identity";

import { RbacService } from "../../rbac/rbac.service.js";
import { OrgsRepo } from "../orgs.repo.js";
import { OrgsService } from "../orgs.service.js";
import { SEAT_LIMIT_SOURCE, seatLimitError, type SeatLimitSource } from "../seats/seat-limit.js";

import { JoinLinksRepo, linkUsable } from "./join-links.repo.js";

import type { AuditScope } from "../../audit/audited.decorator.js";
import type { AuthenticatedUser } from "../../common/current-user.js";
import type { OrganizationJoinLink } from "@wasfa/db";
import type { CreateJoinLinkInput } from "@wasfa/shared/schemas/deals";
import type { JoinAcceptResponse, JoinLanding, JoinLinkItem } from "@wasfa/shared/schemas/org";

const INVALID: JoinLanding = { valid: false };

function linkItem(link: OrganizationJoinLink): JoinLinkItem {
  return {
    id: link.id,
    slug: link.slug,
    role: link.role,
    approval: link.approval,
    dealId: link.dealId,
    maxUses: link.maxUses,
    usedCount: link.usedCount,
    expiresAt: link.expiresAt?.toISOString() ?? null,
    active: link.active,
    createdAt: link.createdAt.toISOString(),
  };
}

/**
 * Join links (BILLING §8, REFERRALS §7.4): created and disabled by an org admin or a platform admin,
 * shown on a public landing page, and accepted by a signed-in user whose email and phone are verified.
 */
@Injectable()
export class JoinLinksService {
  constructor(
    private readonly repo: JoinLinksRepo,
    private readonly orgs: OrgsService,
    private readonly orgsRepo: OrgsRepo,
    private readonly rbac: RbacService,
    @Inject(SEAT_LIMIT_SOURCE) private readonly seats: SeatLimitSource,
  ) {}

  // --- organization admins ---

  async listForOrg(user: AuthenticatedUser, orgId: string): Promise<{ items: JoinLinkItem[] }> {
    await this.orgs.authorize(user.id, orgId, "org_admin");
    return { items: (await this.repo.list(orgId)).map(linkItem) };
  }

  async createForOrg(
    user: AuthenticatedUser,
    orgId: string,
    input: CreateJoinLinkInput,
    audit: AuditScope,
  ): Promise<JoinLinkItem> {
    await this.orgs.authorize(user.id, orgId, "org_admin");
    return this.create(user.id, orgId, input, audit);
  }

  async disableForOrg(
    user: AuthenticatedUser,
    orgId: string,
    linkId: string,
    audit: AuditScope,
  ): Promise<JoinLinkItem> {
    await this.orgs.authorize(user.id, orgId, "org_admin");
    return this.disable(orgId, linkId, audit);
  }

  // --- platform admins (the routes carry `orgs.read` / `orgs.write`) ---

  async listForAdmin(orgId: string): Promise<{ items: JoinLinkItem[] }> {
    await this.requireOrg(orgId);
    return { items: (await this.repo.list(orgId)).map(linkItem) };
  }

  async createForAdmin(
    adminId: string,
    orgId: string,
    input: CreateJoinLinkInput,
    audit: AuditScope,
  ): Promise<JoinLinkItem> {
    await this.requireOrg(orgId);
    return this.create(adminId, orgId, input, audit);
  }

  async disableForAdmin(orgId: string, linkId: string, audit: AuditScope): Promise<JoinLinkItem> {
    await this.requireOrg(orgId);
    return this.disable(orgId, linkId, audit);
  }

  // --- the visitor ---

  /** An unknown, disabled, expired or used-up link all answer `{ valid: false }`: nothing to enumerate. */
  async landing(slug: string, now = new Date()): Promise<JoinLanding> {
    const found = await this.repo.findBySlug(slug);
    if (!found || !linkUsable(found.link, now)) return INVALID;
    return {
      valid: true,
      org: { name: found.orgName },
      benefit: found.dealActive && found.dealName !== null ? { dealName: found.dealName } : null,
      approval: found.link.approval,
    };
  }

  /**
   * The signed-in user joins (or requests to join) through the link. Both the email and the phone must
   * be verified first: the web calls this right after verification, carrying the slug itself.
   */
  async accept(
    user: AuthenticatedUser,
    slug: string,
    audit: AuditScope,
  ): Promise<JoinAcceptResponse> {
    const contact = await this.orgsRepo.findContact(user.id);
    if (!contact) throw new AppError(ErrorCode.AUTH_REQUIRED);
    // A phone-only account has a placeholder address that can never be verified: its verified phone
    // is the whole condition (the same rule as the referral sign-up check).
    const emailOk = contact.emailVerified || isPlaceholderEmail(contact.email);
    if (!emailOk || !contact.phoneVerified) {
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: "verification_required" } });
    }

    const found = await this.repo.findBySlug(slug);
    if (!found) throw new AppError(ErrorCode.NOT_FOUND);
    const seatLimit = await this.seats.limitFor(found.link.orgId);
    const result = await this.repo.join(slug, user.id, seatLimit);
    if (result.outcome === "invalid") throw new AppError(ErrorCode.NOT_FOUND);
    if (result.outcome === "seat_limit") throw seatLimitError(result.orgId);

    audit.targetId = result.orgId;
    audit.after = { outcome: result.outcome };
    if (result.outcome === "joined") {
      // The cached list of the caller's organizations is stale from this moment.
      await this.rbac.bustUser(user.id);
    }
    const outcome =
      result.outcome === "joined"
        ? "joined"
        : result.outcome === "already_member"
          ? "already_member"
          : "pending";
    return { outcome, orgId: result.orgId };
  }

  // --- approvals (org admins) ---

  async approve(
    user: AuthenticatedUser,
    orgId: string,
    targetId: string,
    audit: AuditScope,
  ): Promise<{ userId: string; status: "active" }> {
    await this.orgs.authorize(user.id, orgId, "org_admin");
    const result = await this.repo.approve(orgId, targetId, await this.seats.limitFor(orgId));
    if (result === "not_found") throw new AppError(ErrorCode.NOT_FOUND);
    if (result === "seat_limit") throw seatLimitError(orgId);
    await this.rbac.bustUser(targetId);
    audit.after = { status: "active" };
    return { userId: targetId, status: "active" };
  }

  async reject(
    user: AuthenticatedUser,
    orgId: string,
    targetId: string,
    audit: AuditScope,
  ): Promise<void> {
    await this.orgs.authorize(user.id, orgId, "org_admin");
    if (!(await this.repo.reject(orgId, targetId))) throw new AppError(ErrorCode.NOT_FOUND);
    audit.after = { status: "rejected" };
  }

  // --- shared ---

  private async requireOrg(orgId: string): Promise<void> {
    if (!(await this.orgsRepo.findOrg(orgId))) throw new AppError(ErrorCode.NOT_FOUND);
  }

  private async create(
    actorId: string,
    orgId: string,
    input: CreateJoinLinkInput,
    audit: AuditScope,
  ): Promise<JoinLinkItem> {
    const result = await this.repo.create(orgId, input, actorId);
    if (result.outcome === "slug_taken") {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "slug_taken" } });
    }
    if (result.outcome === "deal_not_found") {
      throw new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: ["dealId"] } });
    }
    audit.targetId = result.link.id;
    audit.after = {
      slug: result.link.slug,
      role: result.link.role,
      approval: result.link.approval,
      maxUses: result.link.maxUses,
    };
    return linkItem(result.link);
  }

  private async disable(orgId: string, linkId: string, audit: AuditScope): Promise<JoinLinkItem> {
    const link = await this.repo.disable(orgId, linkId);
    if (!link) throw new AppError(ErrorCode.NOT_FOUND);
    audit.targetId = link.id;
    audit.after = { active: false };
    return linkItem(link);
  }
}
