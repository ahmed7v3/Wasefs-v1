import { Inject, Injectable } from "@nestjs/common";
import {
  deals,
  isUniqueViolation,
  organizationInvites,
  organizationJoinLinks,
  organizationMembers,
  organizations,
  outbox,
  type Database,
  type OrganizationJoinLink,
} from "@wasfa/db";
import { and, count, eq, gt, isNull, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";
import { scopedRepo, type ScopedRepo } from "../../common/scoped-repo.js";

import type { CreateJoinLinkInput } from "@wasfa/shared/schemas/deals";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type CreateLinkResult =
  | { outcome: "created"; link: OrganizationJoinLink }
  | { outcome: "slug_taken" }
  | { outcome: "deal_not_found" };

export interface PublicLink {
  link: OrganizationJoinLink;
  orgName: string;
  dealName: string | null;
  dealActive: boolean;
}

export type JoinOutcome =
  | { outcome: "invalid" }
  | { outcome: "seat_limit"; orgId: string }
  | { outcome: "already_member" | "pending" | "joined" | "requested"; orgId: string };

export type ApproveOutcome = "approved" | "not_found" | "seat_limit";

const SLUG_CONSTRAINT = "organization_join_links_slug_key";

/** A link that can still be used: enabled, not expired, not used up. The same rule for the landing page and for joining. */
export function linkUsable(link: OrganizationJoinLink, now: Date): boolean {
  return (
    link.active &&
    (link.expiresAt === null || link.expiresAt.getTime() > now.getTime()) &&
    (link.maxUses === null || link.usedCount < link.maxUses)
  );
}

/**
 * The only place join links and join requests touch the database. Joining runs in one transaction
 * that locks the organization row (the very lock invites take, so seats cannot be oversold between
 * the two) and then the link row, so parallel accepts of a link's last use admit exactly one person.
 */
@Injectable()
export class JoinLinksRepo {
  private readonly links: ScopedRepo<typeof organizationJoinLinks>;

  constructor(@Inject(DB) private readonly handle: DbHandle) {
    this.links = scopedRepo(handle.db, {
      table: organizationJoinLinks,
      scope: organizationJoinLinks.orgId,
      id: organizationJoinLinks.id,
    });
  }

  async list(orgId: string): Promise<OrganizationJoinLink[]> {
    const rows = await this.links.list(orgId);
    return rows.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
    );
  }

  async create(
    orgId: string,
    input: CreateJoinLinkInput,
    createdBy: string,
  ): Promise<CreateLinkResult> {
    if (input.dealId !== null) {
      const [deal] = await this.handle.db
        .select({ id: deals.id })
        .from(deals)
        .where(eq(deals.id, input.dealId));
      if (!deal) return { outcome: "deal_not_found" };
    }
    try {
      const [link] = await this.handle.db
        .insert(organizationJoinLinks)
        .values({
          orgId,
          slug: input.slug,
          role: input.role,
          dealId: input.dealId,
          maxUses: input.maxUses,
          expiresAt: input.expiresAt === null ? null : new Date(input.expiresAt),
          approval: input.approval,
          createdBy,
        })
        .returning();
      if (!link) throw new Error("join link insert returned no row");
      return { outcome: "created", link };
    } catch (error) {
      if (isUniqueViolation(error, SLUG_CONSTRAINT)) return { outcome: "slug_taken" };
      throw error;
    }
  }

  /** Disables a link of this organization (idempotent); `null` when the organization has no such link. */
  disable(orgId: string, linkId: string): Promise<OrganizationJoinLink | null> {
    return this.links.update(orgId, linkId, { active: false, updatedAt: new Date() });
  }

  /** The link with its organization and deal, for the public landing page and for joining. */
  async findBySlug(slug: string): Promise<PublicLink | null> {
    const [row] = await this.handle.db
      .select({
        link: organizationJoinLinks,
        orgName: organizations.name,
        dealName: deals.name,
        dealStatus: deals.status,
      })
      .from(organizationJoinLinks)
      .innerJoin(organizations, eq(organizations.id, organizationJoinLinks.orgId))
      .leftJoin(deals, eq(deals.id, organizationJoinLinks.dealId))
      .where(eq(organizationJoinLinks.slug, slug));
    if (!row) return null;
    return {
      link: row.link,
      orgName: row.orgName,
      dealName: row.dealName,
      dealActive: row.dealStatus === "active",
    };
  }

  /** Active members plus invitations that can still be accepted: the seats taken. */
  private async seatsTaken(tx: Tx, orgId: string, now: Date): Promise<number> {
    const [members] = await tx
      .select({ total: count() })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.status, "active")));
    const [invites] = await tx
      .select({ total: count() })
      .from(organizationInvites)
      .where(
        and(
          eq(organizationInvites.orgId, orgId),
          isNull(organizationInvites.acceptedAt),
          gt(organizationInvites.expiresAt, now),
        ),
      );
    return (members?.total ?? 0) + (invites?.total ?? 0);
  }

  private async lockOrg(tx: Tx, orgId: string): Promise<boolean> {
    const [locked] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .for("update");
    return locked !== undefined;
  }

  private memberJoined(tx: Tx, orgId: string, userId: string, linkId: string | null) {
    return tx
      .insert(outbox)
      .values({
        topic: "orgs.member_joined",
        payload: { orgId, userId, linkId },
        // One event per person and organization: a member who leaves and returns is not a new referral.
        idempotencyKey: `orgs.member_joined:${orgId}:${userId}`,
      })
      .onConflictDoNothing();
  }

  /**
   * Joins `userId` through the link (`auto_approve`) or files a pending request (`requires_approval`).
   * Already a member or already requested is an idempotent success that spends no use. `seatLimit`
   * is resolved by the caller (`null` = unlimited).
   */
  async join(
    slug: string,
    userId: string,
    seatLimit: number | null,
    now = new Date(),
  ): Promise<JoinOutcome> {
    const head = await this.findBySlug(slug);
    if (!head) return { outcome: "invalid" };
    const orgId = head.link.orgId;

    return this.handle.db.transaction(async (tx): Promise<JoinOutcome> => {
      if (!(await this.lockOrg(tx, orgId))) return { outcome: "invalid" };
      const [link] = await tx
        .select()
        .from(organizationJoinLinks)
        .where(eq(organizationJoinLinks.id, head.link.id))
        .for("update");

      const [existing] = await tx
        .select({ status: organizationMembers.status })
        .from(organizationMembers)
        .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId)));
      if (existing?.status === "active") return { outcome: "already_member", orgId };
      if (existing?.status === "pending") return { outcome: "pending", orgId };

      if (!link || !linkUsable(link, now)) return { outcome: "invalid" };

      const autoApprove = link.approval === "auto_approve";
      if (
        autoApprove &&
        seatLimit !== null &&
        (await this.seatsTaken(tx, orgId, now)) >= seatLimit
      ) {
        return { outcome: "seat_limit", orgId };
      }
      await tx.insert(organizationMembers).values({
        orgId,
        userId,
        role: link.role,
        joinedViaLinkId: link.id,
        status: autoApprove ? "active" : "pending",
      });
      await tx
        .update(organizationJoinLinks)
        .set({ usedCount: sql`${organizationJoinLinks.usedCount} + 1`, updatedAt: sql`now()` })
        .where(eq(organizationJoinLinks.id, link.id));
      if (autoApprove) await this.memberJoined(tx, orgId, userId, link.id);
      return { outcome: autoApprove ? "joined" : "requested", orgId };
    });
  }

  /** Turns a pending request into a membership if a seat is free. */
  async approve(
    orgId: string,
    userId: string,
    seatLimit: number | null,
    now = new Date(),
  ): Promise<ApproveOutcome> {
    return this.handle.db.transaction(async (tx): Promise<ApproveOutcome> => {
      if (!(await this.lockOrg(tx, orgId))) return "not_found";
      const [request] = await tx
        .select({ linkId: organizationMembers.joinedViaLinkId })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.orgId, orgId),
            eq(organizationMembers.userId, userId),
            eq(organizationMembers.status, "pending"),
          ),
        )
        .for("update");
      if (!request) return "not_found";
      if (seatLimit !== null && (await this.seatsTaken(tx, orgId, now)) >= seatLimit) {
        return "seat_limit";
      }
      await tx
        .update(organizationMembers)
        .set({ status: "active", joinedAt: now })
        .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId)));
      await this.memberJoined(tx, orgId, userId, request.linkId);
      return "approved";
    });
  }

  /** Deletes a pending request; `false` when there was none (an active member is never touched). */
  async reject(orgId: string, userId: string): Promise<boolean> {
    const rows = await this.handle.db
      .delete(organizationMembers)
      .where(
        and(
          eq(organizationMembers.orgId, orgId),
          eq(organizationMembers.userId, userId),
          eq(organizationMembers.status, "pending"),
        ),
      )
      .returning({ userId: organizationMembers.userId });
    return rows.length > 0;
  }

  /** Link counters for the dashboard. */
  async summary(orgId: string): Promise<{ total: number; active: number; uses: number }> {
    const rows = await this.links.list(orgId);
    const now = new Date();
    return {
      total: rows.length,
      active: rows.filter((row) => linkUsable(row, now)).length,
      uses: rows.reduce((sum, row) => sum + row.usedCount, 0),
    };
  }
}
