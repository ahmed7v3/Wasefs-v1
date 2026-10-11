import { Injectable } from "@nestjs/common";
import {
  LedgerError,
  type CreditWallet,
  type LedgerWrite,
  type ReleaseResult,
  type ReservationResult,
  type SettleResult,
  type SweepResult,
  type WalletOwner,
} from "@wasfa/db";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { PinoLogger } from "nestjs-pino";

import { PlansService } from "../plans/plans.service.js";

import { CreditsRepo } from "./credits.repo.js";

import type { MeCreditsResponse } from "@wasfa/shared/schemas/credits";

/** Ledger refusals as the API's errors; `details.reason` is what the web app switches on. */
function toAppError(error: LedgerError): AppError {
  switch (error.reason) {
    case "insufficient_credits":
      return new AppError(ErrorCode.QUOTA_EXCEEDED, {
        details: { reason: "insufficient_credits" },
      });
    case "insufficient_balance":
      return new AppError(ErrorCode.CONFLICT, { details: { reason: "insufficient_balance" } });
    case "idempotency_key_reused":
      return new AppError(ErrorCode.CONFLICT, { details: { reason: "idempotency_key_reused" } });
    case "reservation_not_found":
      return new AppError(ErrorCode.NOT_FOUND);
    case "invalid_amount":
      return new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: ["amount"] } });
  }
}

async function refusals<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    throw error instanceof LedgerError ? toAppError(error) : error;
  }
}

/** First moment of the next UTC month: when the monthly grant job next gives credits. */
export function nextGrantAt(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/**
 * Credits for the AI features: reserve the worst case, settle the actual cost, release the rest
 * (phase2.md, Decision 4). The state machine and its locking live in `@wasfa/db` (`credits-ledger`),
 * which the worker shares; this service turns its refusals into API errors and adds the read models.
 */
@Injectable()
export class CreditsService {
  constructor(
    private readonly repo: CreditsRepo,
    private readonly plans: PlansService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("Credits");
  }

  ensureWallet(owner: WalletOwner): Promise<CreditWallet> {
    return this.repo.ensureWallet(owner);
  }

  /** `QUOTA_EXCEEDED` (`insufficient_credits`) when the balance is lower than `amount`. Idempotent by key. */
  reserve(
    owner: WalletOwner,
    amount: number,
    options: { idempotencyKey: string; purpose: string; ttlSeconds?: number },
  ): Promise<ReservationResult> {
    return refusals(this.repo.reserve(owner, amount, options));
  }

  /** Charges `min(actual, reserved)` and returns the rest. A second call changes nothing. */
  async settle(
    reservationId: string,
    actual: number,
    options: { aiUsageId?: string } = {},
  ): Promise<SettleResult> {
    const result = await refusals(this.repo.settle(reservationId, actual, options));
    if (result.overage > 0) {
      // Ids and numbers only: never the prompt or the answer.
      this.logger.warn(
        { reservationId, reserved: result.reservation.amount, actual, charged: result.charged },
        "Call used more credits than it reserved; the overage is not charged",
      );
    }
    return result;
  }

  /** Returns an open reservation's whole hold (the call failed). A closed reservation is left alone. */
  release(reservationId: string, reason?: string): Promise<ReleaseResult> {
    return refusals(this.repo.release(reservationId, reason));
  }

  /** Releases reservations past their expiry (a crashed job never settled them). */
  sweepExpired(now = new Date(), limit?: number): Promise<SweepResult> {
    return this.repo.sweepExpired(now, limit);
  }

  /** Whether the owner is a live user or an existing organization. */
  ownerExists(owner: WalletOwner): Promise<boolean> {
    return this.repo.ownerExists(owner);
  }

  /** `NOT_FOUND` when the owner does not exist; `CONFLICT` (`insufficient_balance`) when it would go below zero. */
  async adjust(
    owner: WalletOwner,
    delta: number,
    options: { reason: string; actorId: string; idempotencyKey: string },
  ): Promise<LedgerWrite> {
    if (!(await this.repo.ownerExists(owner))) throw new AppError(ErrorCode.NOT_FOUND);
    return refusals(this.repo.adjust(owner, delta, options));
  }

  grant(owner: WalletOwner, amount: number, period: string): Promise<LedgerWrite> {
    return refusals(this.repo.grant(owner, amount, period));
  }

  refund(
    owner: WalletOwner,
    amount: number,
    options: { reason: string; idempotencyKey: string },
  ): Promise<LedgerWrite> {
    return refusals(this.repo.refund(owner, amount, options));
  }

  /** `GET /me/credits`: the caller's personal wallet and plan. No wallet yet reads as a zero balance. */
  async forUser(userId: string, now = new Date()): Promise<MeCreditsResponse> {
    const [wallet, plan] = await Promise.all([
      this.repo.personalWallet(userId),
      this.plans.effectivePlan({ type: "user", id: userId }, now),
    ]);
    return {
      wallet: { ownerType: "user", balance: wallet?.balance ?? 0 },
      plan: { key: plan.key, nameAr: plan.nameAr, nameEn: plan.nameEn },
      monthlyCredits: plan.monthlyCredits,
      nextGrantAt: nextGrantAt(now).toISOString(),
    };
  }
}
