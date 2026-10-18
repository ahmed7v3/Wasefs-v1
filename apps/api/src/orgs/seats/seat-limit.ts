import { Inject, Injectable } from "@nestjs/common";
import { dealSeatLimit } from "@wasfa/db";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { DB, type DbHandle } from "../../common/database.js";
import { PlansService } from "../../plans/plans.service.js";

export const SEAT_LIMIT_SOURCE = Symbol("SEAT_LIMIT_SOURCE");

/**
 * How many members an organization may have (active members plus pending invitations); `null` is
 * unlimited. Behind an interface: the bound source (`DealSeatLimitSource`) reads the active deal's
 * `terms.seats.maxMembers` first and falls back to the plan's.
 */
export interface SeatLimitSource {
  limitFor(orgId: string, now?: Date): Promise<number | null>;
}

/** The organization's effective plan: `plans.max_members`. */
@Injectable()
export class PlanSeatLimitSource implements SeatLimitSource {
  constructor(private readonly plans: PlansService) {}

  async limitFor(orgId: string, now = new Date()): Promise<number | null> {
    const plan = await this.plans.effectivePlan({ type: "org", id: orgId }, now);
    return plan.maxMembers;
  }
}

/** An active deal on the organization (not member-only) with `terms.seats.maxMembers` wins; else the plan's. */
@Injectable()
export class DealSeatLimitSource implements SeatLimitSource {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly plan: PlanSeatLimitSource,
  ) {}

  async limitFor(orgId: string, now = new Date()): Promise<number | null> {
    const fromDeal = await dealSeatLimit(this.handle.db, orgId, now);
    return fromDeal ?? this.plan.limitFor(orgId, now);
  }
}

/** Refusal when a seat is needed and none is left, with the way out. */
export function seatLimitError(orgId: string): AppError {
  return new AppError(ErrorCode.CONFLICT, {
    details: { reason: "seat_limit", upgradePath: `/pricing?org=${orgId}` },
  });
}
