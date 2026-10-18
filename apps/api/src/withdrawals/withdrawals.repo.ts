import { Inject, Injectable } from "@nestjs/common";
import {
  addPayoutDestination,
  cancelWithdrawal,
  destinationByHash,
  payoutDestinations,
  payoutMethods,
  removePayoutDestination,
  requestWithdrawal,
  withdrawalEligibility,
  withdrawalRequests,
  type AddDestinationInput,
  type PayoutDestination,
  type PayoutMethod,
  type RequestWithdrawalInput,
  type WithdrawalEligibilityFacts,
  type WithdrawalRequest,
  type WithdrawalResult,
} from "@wasfa/db";
import { asc, eq, isNull } from "drizzle-orm";

import { DB, type DbHandle } from "../common/database.js";
import { scopedRepo, type ScopedRepo } from "../common/scoped-repo.js";

/**
 * Every query of the caller's payout destinations and withdrawals. Both tables are the caller's own
 * (`scopedRepo`); the state changes are `@wasfa/db`'s transactions, shared with the tests.
 */
@Injectable()
export class WithdrawalsRepo {
  private readonly destinations: ScopedRepo<typeof payoutDestinations>;
  private readonly requests: ScopedRepo<typeof withdrawalRequests>;

  constructor(@Inject(DB) private readonly handle: DbHandle) {
    this.destinations = scopedRepo(handle.db, {
      table: payoutDestinations,
      scope: payoutDestinations.userId,
      id: payoutDestinations.id,
    });
    this.requests = scopedRepo(handle.db, {
      table: withdrawalRequests,
      scope: withdrawalRequests.userId,
      id: withdrawalRequests.id,
    });
  }

  enabledMethods(): Promise<PayoutMethod[]> {
    return this.handle.db
      .select()
      .from(payoutMethods)
      .where(eq(payoutMethods.enabled, true))
      .orderBy(asc(payoutMethods.sort), asc(payoutMethods.key));
  }

  async methodByKey(key: string): Promise<PayoutMethod | null> {
    const [row] = await this.handle.db.select().from(payoutMethods).where(eq(payoutMethods.key, key));
    return row ?? null;
  }

  allMethods(): Promise<PayoutMethod[]> {
    return this.handle.db.select().from(payoutMethods);
  }

  /** The caller's saved destinations that were not removed. */
  liveDestinations(userId: string): Promise<PayoutDestination[]> {
    return this.destinations.list(userId, isNull(payoutDestinations.removedAt));
  }

  /** All of the caller's destinations, removed ones included (a past request still points at one). */
  allDestinations(userId: string): Promise<PayoutDestination[]> {
    return this.destinations.list(userId);
  }

  byHash(hash: string): Promise<PayoutDestination | null> {
    return destinationByHash(this.handle.db, hash);
  }

  addDestination(input: AddDestinationInput) {
    return addPayoutDestination(this.handle.db, input);
  }

  removeDestination(userId: string, id: string, now: Date): Promise<void> {
    return removePayoutDestination(this.handle.db, userId, id, now);
  }

  eligibility(userId: string, now: Date): Promise<WithdrawalEligibilityFacts> {
    return withdrawalEligibility(this.handle.db, userId, now);
  }

  request(input: RequestWithdrawalInput): Promise<WithdrawalResult> {
    return requestWithdrawal(this.handle.db, input);
  }

  cancel(userId: string, id: string): Promise<WithdrawalResult> {
    return cancelWithdrawal(this.handle.db, { userId, id });
  }

  /** The caller's requests, newest first. */
  async list(userId: string, limit = 50): Promise<WithdrawalRequest[]> {
    const rows = await this.requests.list(userId);
    return rows
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
      .slice(0, limit);
  }

  find(userId: string, id: string): Promise<WithdrawalRequest | null> {
    return this.requests.find(userId, id);
  }
}
