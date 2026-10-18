import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { CreditsService } from "../../credits/credits.service.js";
import { OrgsRepo } from "../orgs.repo.js";

import type { QuotaOwner } from "../../quota/quota.service.js";
import type { CreditReservation, WalletOwner } from "@wasfa/db";

/** Who acts and for whom: the plan/entitlement/quota owner and which wallet pays first. */
export interface PayerContext {
  userId: string;
  /** The organization the request acts for; null = the user's personal account. */
  orgId: string | null;
  /** The owner whose plan, entitlements and quota apply: the organization in org context. */
  planOwner: WalletOwner;
  payer: "org" | "personal";
  /** Org context only: may the member fall back to personal credits when the org wallet cannot pay? */
  allowFallback: boolean;
}

export interface ReservedPayment {
  reservation: CreditReservation;
  /** The wallet that was charged (the personal one when the fallback was used). */
  walletOwner: WalletOwner;
  usedFallback: boolean;
}

const FALLBACK_REASONS = new Set(["insufficient_credits", "member_cap_reached"]);

/**
 * Wallet selection (BILLING §8). In an organization context the organization's plan and quota
 * apply and its wallet pays first, after the member's monthly cap. A short org wallet (or a reached
 * cap) falls back to the member's personal wallet only when the organization allows it; one
 * reservation is never split across two wallets.
 */
@Injectable()
export class PayerService {
  constructor(
    private readonly orgs: OrgsRepo,
    private readonly credits: CreditsService,
  ) {}

  /** An org context needs an ACTIVE membership; anything else is `NOT_FOUND`, as for any foreign organization. */
  async resolve(userId: string, orgId?: string | null): Promise<PayerContext> {
    if (!orgId) {
      return {
        userId,
        orgId: null,
        planOwner: { type: "user", id: userId },
        payer: "personal",
        allowFallback: false,
      };
    }
    const [membership, org] = await Promise.all([
      this.orgs.membership(orgId, userId),
      this.orgs.findOrg(orgId),
    ]);
    if (!membership || !org) throw new AppError(ErrorCode.NOT_FOUND);
    return {
      userId,
      orgId,
      planOwner: { type: "org", id: orgId },
      payer: "org",
      allowFallback: org.allowPersonalFallback,
    };
  }

  /** The `QuotaService` owner for this context. */
  quotaOwner(ctx: PayerContext): QuotaOwner {
    return ctx.orgId ? { ownerOrgId: ctx.orgId } : { ownerUserId: ctx.userId };
  }

  /**
   * `QUOTA_EXCEEDED` with `details.reason`: `insufficient_credits` (personal), `org_credits_exhausted`
   * or `member_cap_reached` (org wallet, fallback off), or the personal wallet's own refusal after a fallback.
   */
  async reserve(
    ctx: PayerContext,
    amount: number,
    options: { idempotencyKey: string; purpose: string; ttlSeconds?: number },
  ): Promise<ReservedPayment> {
    const personal: WalletOwner = { type: "user", id: ctx.userId };
    if (ctx.orgId === null) {
      const { reservation } = await this.credits.reserve(personal, amount, options);
      return { reservation, walletOwner: personal, usedFallback: false };
    }

    const org: WalletOwner = { type: "org", id: ctx.orgId };
    try {
      const { reservation } = await this.credits.reserve(org, amount, {
        ...options,
        member: { userId: ctx.userId },
      });
      return { reservation, walletOwner: org, usedFallback: false };
    } catch (error) {
      const reason = refusalReason(error);
      if (reason === null || !FALLBACK_REASONS.has(reason)) throw error;
      if (ctx.allowFallback) {
        const { reservation } = await this.credits.reserve(personal, amount, options);
        return { reservation, walletOwner: personal, usedFallback: true };
      }
      throw new AppError(ErrorCode.QUOTA_EXCEEDED, {
        details: {
          reason: reason === "member_cap_reached" ? "member_cap_reached" : "org_credits_exhausted",
        },
      });
    }
  }
}

/** The `details.reason` of a quota refusal; null for anything else (errors that must propagate untouched). */
function refusalReason(error: unknown): string | null {
  if (!(error instanceof AppError) || error.code !== ErrorCode.QUOTA_EXCEEDED) return null;
  const reason = error.details?.["reason"];
  return typeof reason === "string" ? reason : null;
}
