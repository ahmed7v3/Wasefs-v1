import { Inject, Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { maskInviteTarget, type OrgDashboard } from "@wasfa/shared/schemas/org";

import { csvRow } from "../../admin/ai/usage-csv.js";
import { PlansService } from "../../plans/plans.service.js";
import { SubscriptionsService } from "../../subscriptions/subscriptions.service.js";
import { JoinLinksRepo } from "../join-links/join-links.repo.js";
import { OrgsRepo } from "../orgs.repo.js";
import { OrgsService } from "../orgs.service.js";
import { SEAT_LIMIT_SOURCE, type SeatLimitSource } from "../seats/seat-limit.js";
import { OrgWalletRepo, monthWindow } from "../wallet/wallet.repo.js";

import type { AuthenticatedUser } from "../../common/current-user.js";

const RECENT_ORDERS = 5;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

const CSV_HEADER = ["member", "email", "credits_used", "analyses"] as const;

/** `YYYY-MM` (UTC); the current month when absent. */
function windowOf(month: string | undefined, now: Date): { label: string; start: Date; end: Date } {
  const match = month === undefined ? null : MONTH.exec(month);
  const at = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)) : now;
  return { label: at.toISOString().slice(0, 7), ...monthWindow(at) };
}

/** The organization dashboard (BILLING §8) and its usage export, for org admins only. */
@Injectable()
export class OrgDashboardService {
  constructor(
    private readonly orgs: OrgsService,
    private readonly orgsRepo: OrgsRepo,
    private readonly wallets: OrgWalletRepo,
    private readonly links: JoinLinksRepo,
    private readonly plans: PlansService,
    private readonly subscriptions: SubscriptionsService,
    @Inject(SEAT_LIMIT_SOURCE) private readonly seats: SeatLimitSource,
  ) {}

  async dashboard(user: AuthenticatedUser, orgId: string, now = new Date()): Promise<OrgDashboard> {
    await this.orgs.authorize(user.id, orgId, "org_admin");
    const org = await this.orgsRepo.findOrg(orgId);
    if (!org) throw new AppError(ErrorCode.NOT_FOUND);
    const window = windowOf(undefined, now);

    const [
      balance,
      plan,
      subscription,
      seatLimit,
      members,
      pendingMembers,
      invites,
      links,
      recent,
    ] = await Promise.all([
      this.wallets.balance(orgId),
      this.plans.effectivePlan({ type: "org", id: orgId }, now),
      this.subscriptions.ofOrg(orgId, now),
      this.seats.limitFor(orgId, now),
      this.wallets.membersWithUsage(orgId, window),
      this.orgsRepo.pendingRequests(orgId),
      this.orgsRepo.pendingInvites(orgId),
      this.links.summary(orgId),
      this.subscriptions.ordersOfOrg(orgId, RECENT_ORDERS),
    ]);

    return {
      org: { id: org.id, name: org.name },
      month: window.label,
      wallet: { balance, allowPersonalFallback: org.allowPersonalFallback },
      plan: { key: plan.key, nameAr: plan.nameAr, nameEn: plan.nameEn },
      subscription: subscription.subscription,
      seats: { used: members.length, pendingInvites: invites.length, limit: seatLimit },
      members: members.map((member) => ({
        userId: member.userId,
        name: member.name,
        role: member.role,
        creditsUsed: member.creditsUsed,
        monthlyCap: member.monthlyCap,
      })),
      pendingMembers: pendingMembers.map((request) => ({
        userId: request.userId,
        name: request.name,
        requestedAt: request.requestedAt.toISOString(),
      })),
      joinLinks: links,
      recentOrders: recent.items.map((order) => ({
        id: order.id,
        number: order.number,
        kind: order.kind,
        totalMinor: order.totalMinor,
        currency: order.currency,
        status: order.status,
        createdAt: order.createdAt,
        paidAt: order.paidAt,
        receiptAvailable: order.receiptAvailable,
      })),
    };
  }

  /**
   * One month of usage per member as CSV. Cells that start like a formula are defused by `csvRow`;
   * the email is masked (an admin sees who it is, not a harvestable address).
   */
  async usageCsv(
    user: AuthenticatedUser,
    orgId: string,
    month: string | undefined,
    now = new Date(),
  ) {
    await this.orgs.authorize(user.id, orgId, "org_admin");
    const window = windowOf(month, now);
    const members = await this.wallets.membersWithUsage(orgId, window);
    return [
      csvRow(CSV_HEADER),
      ...members.map((member) =>
        csvRow([member.name, maskInviteTarget(member.email), member.creditsUsed, member.calls]),
      ),
    ].join("");
  }
}
