import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { encryptSecret, decodeEncryptionKey } from "@wasfa/shared/crypto";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { newId } from "@wasfa/shared/ids";
import {
  MAX_PAYOUT_DESTINATIONS,
  MAX_WITHDRAWAL_REQUESTS_PER_DAY,
  canonicalDestination,
  destinationSealContext,
  maskDestination,
  parsePayoutFields,
  validateDestinationValues,
} from "@wasfa/shared/withdrawals";

import { AuthRateLimiter } from "../auth/rate-limiter.js";
import { OutboxQueue } from "../common/outbox-queue.js";
import { API_ENV } from "../config/config.module.js";

import { mapWithdrawalError } from "./withdrawal-errors.js";
import { WithdrawalsRepo } from "./withdrawals.repo.js";

import type { AuthenticatedUser } from "../common/current-user.js";
import type { ApiEnv } from "../config/env.js";
import type { PayoutDestination, PayoutMethod, WithdrawalRequest } from "@wasfa/db";
import type {
  PayoutDestinationView,
  WithdrawalEligibility,
  WithdrawalView,
} from "@wasfa/shared/schemas/withdrawals";

const iso = (date: Date) => date.toISOString();

/** The caller's payout destinations and withdrawals (REFERRALS §8.2, Task 3.12). */
@Injectable()
export class WithdrawalsService {
  constructor(
    private readonly repo: WithdrawalsRepo,
    private readonly limiter: AuthRateLimiter,
    private readonly outbox: OutboxQueue,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  // --- Destinations ---------------------------------------------------------------------------------

  /** `GET /me/payout-destinations`: enabled methods with their fields, and the caller's saved ones. */
  async destinations(userId: string, now = new Date()) {
    const [methods, live, all] = await Promise.all([
      this.repo.enabledMethods(),
      this.repo.liveDestinations(userId),
      this.repo.allMethods(),
    ]);
    const byId = new Map(all.map((method) => [method.id, method]));
    return {
      max: MAX_PAYOUT_DESTINATIONS,
      methods: methods.flatMap((method) => {
        const fields = parsePayoutFields(method.fieldSchema);
        return fields === null
          ? []
          : [
              {
                key: method.key,
                nameAr: method.nameAr,
                nameEn: method.nameEn,
                fields,
                feeMinor: method.feeMinor,
                minAmountMinor: method.minAmountMinor,
                maxAmountMinor: method.maxAmountMinor,
                noteAr: method.noteAr,
                noteEn: method.noteEn,
              },
            ];
      }),
      destinations: live
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .flatMap((row) => {
          const method = byId.get(row.methodId);
          return method ? [destinationView(row, method, now)] : [];
        }),
    };
  }

  /** `POST /me/payout-destinations`: sealed, hashed, masked; starts the cooldown and notifies. */
  async addDestination(
    userId: string,
    input: { methodKey: string; values: Record<string, string> },
    now = new Date(),
  ): Promise<PayoutDestinationView> {
    await this.limiter.hit(`payout-destination:user:${userId}`, 10, 3600);
    const method = await this.repo.methodByKey(input.methodKey);
    const fields = method?.enabled ? parsePayoutFields(method.fieldSchema) : null;
    if (!method || fields === null) {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "method_disabled" } });
    }
    const checked = validateDestinationValues(fields, input.values);
    if (!checked.ok) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: checked.fields } });
    }
    const canonical = canonicalDestination(method.key, checked.values);
    const destinationHash = createHash("sha256").update(canonical).digest("hex");
    // The sealed text is bound to the row id, so a re-added removed destination keeps its own id.
    const earlier = await this.repo.byHash(destinationHash);
    const id = earlier?.userId === userId ? earlier.id : newId();
    try {
      const { destination } = await this.repo.addDestination({
        id,
        userId,
        methodId: method.id,
        valueEnc: encryptSecret(
          canonical,
          decodeEncryptionKey(this.env.ENCRYPTION_KEY),
          destinationSealContext(id),
        ),
        masked: maskDestination(fields, checked.values),
        destinationHash,
        now,
      });
      await this.outbox.kick(`destination:${destination.id}`);
      return destinationView(destination, method, now);
    } catch (error) {
      throw mapWithdrawalError(error);
    }
  }

  /** `DELETE /me/payout-destinations/:id`. */
  async removeDestination(userId: string, id: string, now = new Date()): Promise<void> {
    try {
      await this.repo.removeDestination(userId, id, now);
    } catch (error) {
      throw mapWithdrawalError(error);
    }
  }

  // --- Withdrawals ----------------------------------------------------------------------------------

  /** `GET /me/withdrawals/eligibility`. */
  async eligibility(userId: string, now = new Date()): Promise<WithdrawalEligibility> {
    const facts = await this.repo.eligibility(userId, now);
    const { settings } = facts;
    const pointsToMinimum = Math.max(0, settings.minWithdrawalPoints - facts.cash);
    return {
      available: !facts.reasons.includes("cash_out_off"),
      eligible: facts.reasons.length === 0 && facts.usableDestinations > 0,
      reasons: facts.reasons,
      pointValueMinor: settings.pointValueMinor,
      currency: settings.currency,
      cash: facts.cash,
      cashValueMinor: facts.cash * settings.pointValueMinor,
      minWithdrawalPoints: settings.minWithdrawalPoints,
      minWithdrawalMinor: settings.minWithdrawalPoints * settings.pointValueMinor,
      pointsToMinimum,
      phoneVerified: facts.phoneVerified,
      accountAgeDays: facts.accountAgeDays,
      minAccountAgeDays: settings.minAccountAgeDays,
      openRequestId: facts.openRequestId,
      monthly: {
        used: facts.monthUsed,
        cap: settings.maxWithdrawalPointsPerMonth,
        remaining: Math.max(0, settings.maxWithdrawalPointsPerMonth - facts.monthUsed),
      },
      debt: facts.debt,
      nextDestinationUsableAt: facts.nextDestinationUsableAt?.toISOString() ?? null,
      usableDestinations: facts.usableDestinations,
      slaHours: settings.payoutSlaHours,
      maxRequestsPerDay: MAX_WITHDRAWAL_REQUESTS_PER_DAY,
    };
  }

  /**
   * `POST /me/withdrawals`. The route demands fresh auth; an account with two-factor must also have
   * a session that passed the challenge (the same rule the admin routes apply). 3 a day per user.
   */
  async request(
    user: AuthenticatedUser,
    input: { points: number; destinationId: string; requestId: string },
    now = new Date(),
  ): Promise<WithdrawalView & { replayed: boolean }> {
    if (user.twoFactorEnabled && user.session.mfaVerifiedAt === null) {
      throw new AppError(ErrorCode.AUTH_REQUIRED, { details: { reason: "two_factor_session" } });
    }
    await this.limiter.hit(`withdraw-request:user:${user.id}`, MAX_WITHDRAWAL_REQUESTS_PER_DAY, 86_400);
    try {
      const { request, replayed } = await this.repo.request({ userId: user.id, ...input, now });
      if (!replayed) await this.outbox.kick(`withdrawal:${request.id}`);
      return { ...(await this.view(user.id, request)), replayed };
    } catch (error) {
      throw mapWithdrawalError(error);
    }
  }

  /** `GET /me/withdrawals`. */
  async list(userId: string): Promise<{ items: WithdrawalView[] }> {
    const rows = await this.repo.list(userId);
    const [destinations, methods] = await Promise.all([
      this.repo.allDestinations(userId),
      this.repo.allMethods(),
    ]);
    return { items: rows.map((row) => viewOf(row, destinations, methods)) };
  }

  /** `POST /me/withdrawals/:id/cancel`: only while `requested`. */
  async cancel(userId: string, id: string): Promise<WithdrawalView> {
    try {
      const { request } = await this.repo.cancel(userId, id);
      await this.outbox.kick(`withdrawal:${request.id}`);
      return await this.view(userId, request);
    } catch (error) {
      throw mapWithdrawalError(error);
    }
  }

  private async view(userId: string, request: WithdrawalRequest): Promise<WithdrawalView> {
    const [destinations, methods] = await Promise.all([
      this.repo.allDestinations(userId),
      this.repo.allMethods(),
    ]);
    return viewOf(request, destinations, methods);
  }
}

function destinationView(
  row: PayoutDestination,
  method: PayoutMethod,
  now: Date,
): PayoutDestinationView {
  return {
    id: row.id,
    methodKey: method.key,
    methodNameAr: method.nameAr,
    methodNameEn: method.nameEn,
    masked: row.masked,
    usableAfter: iso(row.usableAfter),
    usable: method.enabled && row.usableAfter.getTime() <= now.getTime(),
    createdAt: iso(row.createdAt),
  };
}

function viewOf(
  request: WithdrawalRequest,
  destinations: readonly PayoutDestination[],
  methods: readonly PayoutMethod[],
): WithdrawalView {
  const destination = destinations.find((row) => row.id === request.destinationId);
  const method = methods.find((row) => row.id === destination?.methodId);
  const timeline: WithdrawalView["timeline"] = [
    { status: "requested", at: iso(request.createdAt) },
  ];
  const approvedAt = request.secondApprovedAt ?? request.approvedAt;
  if ((request.status === "approved" || request.status === "paid") && approvedAt) {
    timeline.push({ status: "approved", at: iso(approvedAt) });
  }
  if (request.status === "paid" && request.paidAt) timeline.push({ status: "paid", at: iso(request.paidAt) });
  if (request.status === "rejected" || request.status === "canceled") {
    timeline.push({ status: request.status, at: iso(request.updatedAt) });
  }
  return {
    id: request.id,
    status: request.status,
    points: request.points,
    amountMinor: request.amountMinor,
    feeMinor: request.feeMinor,
    currency: request.currency,
    destination: {
      id: request.destinationId,
      methodKey: method?.key ?? "",
      masked: destination?.masked ?? "",
    },
    transferReference: request.transferReference,
    rejectReason: request.rejectReason,
    createdAt: iso(request.createdAt),
    timeline,
  };
}
