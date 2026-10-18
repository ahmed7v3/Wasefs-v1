import { Injectable } from "@nestjs/common";
import { initialsOf } from "@wasfa/shared/rewards";
import {
  bulkFraudResultSchema,
  fraudListSchema,
  type BulkFraudInput,
  type FraudListQuery,
} from "@wasfa/shared/schemas/admin-growth";

import { decodeCursor, toPage } from "../common/keyset.js";

import { AdminFraudRepo } from "./admin-fraud.repo.js";

import type { AuditScope } from "../../audit/audited.decorator.js";
import type { AuthenticatedUser } from "../../common/current-user.js";

const person = (userId: string, names: Map<string, string>) => ({
  userId,
  initials: initialsOf(names.get(userId) ?? ""),
});

@Injectable()
export class AdminFraudService {
  constructor(private readonly repo: AdminFraudRepo) {}

  async list(query: FraudListQuery) {
    const rows = await this.repo.page(query, decodeCursor(query.cursor, "uuid"));
    const page = toPage(rows, query.limit, (row) => ({ at: row.cursorAt, key: row.referral.id }));
    const referralsOnPage = page.items.map((row) => row.referral);
    const referrerIds = referralsOnPage.flatMap((row) =>
      row.referrerUserId ? [row.referrerUserId] : [],
    );
    const inviters = await this.repo.invitersOf(referrerIds);
    const [names, decisions, pending] = await Promise.all([
      this.repo.names([
        ...new Set([
          ...referrerIds,
          ...inviters.values(),
          ...referralsOnPage.map((row) => row.refereeUserId),
        ]),
      ]),
      this.repo.heldDecisions(referralsOnPage.map((row) => row.id)),
      this.repo.pendingPoints(referralsOnPage.map((row) => row.id)),
    ]);
    return fraudListSchema.parse({
      items: referralsOnPage.map((row) => {
        const inviter = row.referrerUserId ? inviters.get(row.referrerUserId) : undefined;
        return {
          referralId: row.id,
          status: row.status,
          flags: row.flags,
          fraudScore: row.fraudScore,
          referrer: row.referrerUserId ? person(row.referrerUserId, names) : null,
          referee: person(row.refereeUserId, names),
          referrerInvitedBy: inviter ? person(inviter, names) : null,
          pendingPoints: pending.get(row.id) ?? 0,
          heldDecisions: decisions
            .filter((decision) => decision.referralId === row.id)
            .map((decision) => ({
              id: decision.id,
              event: decision.event,
              beneficiary: decision.beneficiary,
              outcome: decision.outcome,
              reason: decision.reason,
              points: decision.points,
              createdAt: decision.createdAt.toISOString(),
            })),
          createdAt: row.createdAt.toISOString(),
        };
      }),
      nextCursor: page.nextCursor,
    });
  }

  /**
   * The same db functions as the single-referral actions, one transaction per referral. The audit
   * row carries every outcome, so a partial run is visible and can be repeated for the rest.
   */
  async bulk(input: BulkFraudInput, actor: AuthenticatedUser, audit: AuditScope) {
    const now = new Date();
    const results: Array<{ referralId: string; outcome: string; reversedPoints: number }> = [];
    for (const referralId of new Set(input.referralIds)) {
      const result = await this.repo.act(input.action, referralId, actor.id, input.reason, now);
      results.push({
        referralId,
        outcome: result.kind === "ok" ? "done" : result.kind,
        reversedPoints: result.kind === "ok" ? result.reversedPoints : 0,
      });
    }
    const first = input.referralIds[0];
    if (first !== undefined) audit.targetId = first;
    audit.after = { action: input.action, reason: input.reason, results };
    return bulkFraudResultSchema.parse({ action: input.action, results });
  }
}
