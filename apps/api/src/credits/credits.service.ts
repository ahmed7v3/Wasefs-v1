import { Injectable } from "@nestjs/common";
import {
  LedgerError,
  type CreditWallet,
  type PlanEntitlement,
  type LedgerWrite,
  type ReleaseResult,
  type ReservationResult,
  type SettleResult,
  type SweepResult,
  type WalletOwner,
} from "@wasfa/db";
import { AI_MODES, type AiMode } from "@wasfa/shared/ai";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { anniversaries } from "@wasfa/shared/subscriptions";
import { PinoLogger } from "nestjs-pino";

import { decodeCursor, toPage } from "../admin/common/keyset.js";
import { PlansService } from "../plans/plans.service.js";
import { QuotaService } from "../quota/quota.service.js";

import { CreditsRepo, type LedgerRow } from "./credits.repo.js";

import type { CursorQuery } from "@wasfa/shared/schemas/admin";
import type { MeCreditsResponse, MeUsageEntry, MeUsagePage } from "@wasfa/shared/schemas/credits";

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
    case "member_cap_reached":
      return new AppError(ErrorCode.QUOTA_EXCEEDED, { details: { reason: "member_cap_reached" } });
  }
}

async function refusals<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    throw error instanceof LedgerError ? toAppError(error) : error;
  }
}

/** Short machine codes only (`monthly:2026-10`, `expired`): free text never reaches the user. */
const SAFE_REASON = /^[a-z0-9_.:-]{1,64}$/i;

function usageEntry(row: LedgerRow): MeUsageEntry {
  return {
    id: row.id,
    kind: row.kind,
    amount: row.amount,
    balanceAfter: row.balanceAfter,
    // An admin's reason is a private note for the audit trail, not for the account holder.
    reason:
      row.kind !== "admin_adjust" && row.reason !== null && SAFE_REASON.test(row.reason)
        ? row.reason
        : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * What the assistant may offer this plan: `fast`/`balanced` come from the `chat` allowance, `deep`
 * from `deep_think`; search is the `web_search` allowance (the same rule `ChatService` enforces).
 */
export function chatFeatures(allowed: readonly PlanEntitlement[]): MeCreditsResponse["chat"] {
  const modes = new Set<AiMode>();
  for (const item of allowed) {
    if (item.task === "chat") {
      for (const mode of item.modes) if (mode !== "deep") modes.add(mode);
    } else if (item.task === "deep_think" && item.modes.includes("deep")) {
      modes.add("deep");
    }
  }
  return {
    modes: AI_MODES.filter((mode) => modes.has(mode)),
    webSearch: allowed.some((item) => item.task === "web_search"),
  };
}

/** First moment of the next UTC month: when the monthly grant job next gives credits. */
export function nextGrantAt(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/**
 * A subscriber is paid on the period's anniversaries; past the last one, the calendar grant takes
 * over again when the period ends, so that is the next date shown.
 */
export function nextGrantFor(
  now: Date,
  period: { start: Date; end: Date; source: string } | undefined,
): Date {
  if (!period || period.source === "trial") return nextGrantAt(now);
  const next = anniversaries(period.start, period.end).find((at) => at.getTime() > now.getTime());
  return next ?? (period.end > now ? period.end : nextGrantAt(now));
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
    private readonly quota: QuotaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("Credits");
  }

  ensureWallet(owner: WalletOwner): Promise<CreditWallet> {
    return this.repo.ensureWallet(owner);
  }

  /**
   * `QUOTA_EXCEEDED` (`insufficient_credits`) when the balance is lower than `amount`. Idempotent by key.
   * `member` (org wallets): the organization member this hold is for; their monthly cap applies
   * (`QUOTA_EXCEEDED` `member_cap_reached`) and settling attributes the charge to them.
   */
  async reserve(
    owner: WalletOwner,
    amount: number,
    options: {
      idempotencyKey: string;
      purpose: string;
      ttlSeconds?: number;
      member?: { userId: string };
    },
  ): Promise<ReservationResult> {
    if (owner.type === "user") await this.ensureMonthlyGrant(owner.id);
    return refusals(this.repo.reserve(owner, amount, options));
  }

  /**
   * Pays this month's plan grant (the free plan's credits) the moment it is needed instead of after
   * the worker's next daily run: a new account could otherwise not use its free credits on day one.
   * Same rule and ledger key as the daily run, so never twice. Never blocks the caller: a failure is
   * logged and the daily run pays later.
   */
  private async ensureMonthlyGrant(userId: string, now = new Date()): Promise<void> {
    try {
      await this.repo.ensureMonthlyGrant(userId, now);
    } catch (error) {
      this.logger.warn(
        { reason: error instanceof Error ? error.name : "unknown" },
        "Paying the monthly grant on demand failed",
      );
    }
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

  /**
   * `GET /me/credits`: the caller's personal wallet and plan. No wallet yet reads as a zero balance.
   * Always the personal context (`wallets` lists only the personal wallet); `WalletViewService`
   * adds the organization wallets and the payer of an organization context on top of this.
   */
  async forUser(userId: string, now = new Date()): Promise<MeCreditsResponse> {
    const owner = { type: "user", id: userId } as const;
    // The balance shown is the one the next analysis will see.
    await this.ensureMonthlyGrant(userId, now);
    const [wallet, plan, period] = await Promise.all([
      this.repo.personalWallet(userId),
      this.plans.effectivePlan(owner, now),
      this.repo.activeSubscriptionPeriod(userId),
    ]);
    const allowed = (await this.plans.entitlementsOf(plan)).filter((item) => item.allowed);
    const tasks = allowed.map((item) => item.task);
    const [used, usedMonth] = await Promise.all([
      this.quota.usedToday(owner, tasks, now),
      this.quota.usedThisMonth(owner, tasks, now),
    ]);
    const balance = wallet?.balance ?? 0;
    return {
      wallet: { ownerType: "user", balance },
      plan: { key: plan.key, nameAr: plan.nameAr, nameEn: plan.nameEn },
      monthlyCredits: plan.monthlyCredits,
      nextGrantAt: nextGrantFor(now, period).toISOString(),
      today: allowed.map((item) => ({
        task: item.task,
        used: used.get(item.task) ?? 0,
        dailyCap: item.dailyCap,
      })),
      thisMonth: allowed.map((item) => ({
        task: item.task,
        used: usedMonth.get(item.task) ?? 0,
        monthlyCap: item.monthlyCap,
      })),
      chat: chatFeatures(allowed),
      wallets: [{ kind: "personal", balance }],
      payer: { kind: "personal", fallback: false },
    };
  }

  /** `GET /me/usage`: the caller's credit history, newest first. No wallet yet reads as an empty page. */
  async usageFor(userId: string, query: CursorQuery): Promise<MeUsagePage> {
    // Decoded first so a malformed cursor is refused for everyone, wallet or not.
    const cursor = decodeCursor(query.cursor, "uuid");
    const wallet = await this.repo.personalWallet(userId);
    if (!wallet) return { items: [], nextCursor: null };
    const rows = await this.repo.ledgerPage(wallet.id, cursor, query.limit);
    const page = toPage(rows, query.limit, (row) => ({ at: row.cursorAt, key: row.id }));
    return { items: page.items.map(usageEntry), nextCursor: page.nextCursor };
  }
}
