import { Injectable } from "@nestjs/common";
import { PointsLedgerError } from "@wasfa/db";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { redactText } from "@wasfa/shared/redact";

import { AuditService } from "../../audit/audit.service.js";

import { AdminUsersRepo } from "./admin-users.repo.js";
import { AdminUserActionsRepo } from "./user-actions.repo.js";

import type { AuthenticatedUser } from "../../common/current-user.js";
import type { FastifyRequest } from "fastify";

const HOUR_MS = 3_600_000;

type ReferralAction = "release" | "void" | "block_referrer";

const conflict = (reason: string, details: Record<string, unknown> = {}) =>
  new AppError(ErrorCode.CONFLICT, { details: { reason, ...details } });

/**
 * The quick actions of the user 360 header (ADMIN-CONSOLE-SPEC §8.4): a coupon or a personal
 * offer for this user, a points correction and the referral fraud actions. The money logic lives in
 * `@wasfa/db`; this layer checks the target, maps refusals and writes the audit row. Audit values
 * here are ids (stored verbatim, see `RecordOptions.verbatim`); free text is scrubbed first.
 */
@Injectable()
export class AdminUserActionsService {
  constructor(
    private readonly users: AdminUsersRepo,
    private readonly audit: AuditService,
    private readonly repo: AdminUserActionsRepo,
  ) {}

  private async requireUser(userId: string): Promise<void> {
    if (!(await this.users.find(userId))) throw new AppError(ErrorCode.NOT_FOUND);
  }

  /** Assigns an existing coupon to this user. A coupon already aimed at someone else stays theirs. */
  async grantCoupon(userId: string, couponId: string, request: FastifyRequest) {
    await this.requireUser(userId);
    const coupon = await this.repo.coupon(couponId);
    if (!coupon) throw new AppError(ErrorCode.NOT_FOUND);
    if (coupon.targetOrgId !== null || (coupon.targetUserId !== null && coupon.targetUserId !== userId)) {
      throw conflict("coupon_targeted");
    }
    if (coupon.status === "ended" || coupon.status === "paused") {
      throw conflict("coupon_unavailable", { status: coupon.status });
    }
    if (coupon.targetUserId === null) {
      // Guarded again in the statement: two admins cannot both claim an untargeted coupon.
      if (!(await this.repo.claimCoupon(couponId, userId))) throw conflict("coupon_targeted");
    }
    await this.audit.recordFor(
      request,
      {
        action: "user.coupon_granted",
        targetType: "user",
        targetId: userId,
        after: { couponId },
      },
      { verbatim: true },
    );
    return { couponId, userId, code: coupon.code };
  }

  /** A personal offer with a server-side deadline (BILLING §9), built from an existing promotion. */
  async grantOffer(
    userId: string,
    input: { promotionId: string; validHours: number },
    request: FastifyRequest,
  ) {
    await this.requireUser(userId);
    const promotion = await this.repo.promotion(input.promotionId);
    if (!promotion) throw new AppError(ErrorCode.NOT_FOUND);
    if (promotion.status === "ended" || promotion.status === "paused") {
      throw conflict("promotion_unavailable", { status: promotion.status });
    }
    const expiresAt = new Date(Date.now() + input.validHours * HOUR_MS);
    const offer = await this.repo.insertOffer({
      userId,
      promotionId: input.promotionId,
      expiresAt,
    });
    if (!offer) throw new Error("Offer was not stored");
    await this.audit.recordFor(
      request,
      {
        action: "user.offer_granted",
        targetType: "user",
        targetId: userId,
        after: {
          offerId: offer.id,
          promotionId: input.promotionId,
          validHours: input.validHours,
        },
      },
      { verbatim: true },
    );
    return { id: offer.id, expiresAt: expiresAt.toISOString() };
  }

  /** A signed correction of the spendable points; a bucket never goes below zero. */
  async adjustPoints(
    actor: AuthenticatedUser,
    userId: string,
    input: { amount: number; bucket: "cash" | "credit_only"; reason: string; requestId: string },
    request: FastifyRequest,
  ) {
    await this.requireUser(userId);
    try {
      const result = await this.repo.movePoints({
        userId,
        kind: "admin_adjust",
        rows: [
          {
            bucket: input.bucket,
            amount: input.amount,
            idempotencyKey: `admin_adjust:${input.requestId}`,
          },
        ],
        actorId: actor.id,
        reason: input.reason,
      });
      await this.audit.recordFor(request, {
        action: "user.points_adjusted",
        targetType: "user",
        targetId: userId,
        after: {
          bucket: input.bucket,
          amount: input.amount,
          cash: result.wallet.cash,
          creditOnly: result.wallet.creditOnly,
          replayed: result.replayed,
          reason: redactText(input.reason),
        },
      });
      return {
        replayed: result.replayed,
        wallet: {
          pending: result.wallet.pending,
          cash: result.wallet.cash,
          creditOnly: result.wallet.creditOnly,
        },
      };
    } catch (error) {
      if (error instanceof PointsLedgerError) {
        throw conflict(error.reason === "insufficient_points" ? "insufficient_points" : error.reason);
      }
      throw error;
    }
  }

  /** Release, void or block a referral (the three actions of the fraud queue, from the user page). */
  async referralAction(
    actor: AuthenticatedUser,
    referralId: string,
    action: ReferralAction,
    reason: string,
    request: FastifyRequest,
  ) {
    const now = new Date();
    const result = await this.repo.referralAction(action, referralId, actor.id, reason, now);
    if (result.kind === "not_found") throw new AppError(ErrorCode.NOT_FOUND);
    if (result.kind === "no_referrer") throw conflict("no_referrer");
    if (result.kind === "conflict") throw conflict("referral_status", { status: result.status });
    await this.audit.recordFor(request, {
      action: `referral.${action}`,
      targetType: "referral",
      targetId: referralId,
      after: {
        reversedRows: result.reversedRows,
        reversedPoints: result.reversedPoints,
        settledDecisions: result.settledDecisions,
        reason: redactText(reason),
      },
    });
    return {
      referralIds: result.referralIds,
      reversedPoints: result.reversedPoints,
      settledDecisions: result.settledDecisions,
    };
  }
}
