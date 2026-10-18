import { Inject, Injectable } from "@nestjs/common";
import { maskedUserLabel, needsSecondApproval } from "@wasfa/db";
import { decodeEncryptionKey, decryptSecret } from "@wasfa/shared/crypto";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { initialsOf, rewardEventOfReason } from "@wasfa/shared/rewards";
import {
  adminWithdrawalDetailSchema,
  type WithdrawalStepResult,
} from "@wasfa/shared/schemas/withdrawals";
import { destinationSealContext, parseCanonicalDestination } from "@wasfa/shared/withdrawals";

import { OutboxQueue } from "../../common/outbox-queue.js";
import { REDIS } from "../../common/redis.js";
import { API_ENV } from "../../config/config.module.js";
import { mapWithdrawalError } from "../../withdrawals/withdrawal-errors.js";
import { csvRow } from "../ai/usage-csv.js";
import { decodeCursor, toPage } from "../common/keyset.js";

import { AdminWithdrawalsRepo } from "./withdrawals.repo.js";

import type { AuthenticatedUser } from "../../common/current-user.js";
import type { ApiEnv } from "../../config/env.js";
import type { WithdrawalStatus } from "@wasfa/shared/rewards";
import type { Redis } from "ioredis";

const LOCK_MS = 5 * 60_000;
const lockKey = (id: string) => `withdrawals:review-lock:${id}`;
const DAY_MS = 86_400_000;

/** Monday 00:00 UTC of ISO week `YYYY-Www`. */
export function isoWeekStart(week: string): Date {
  const [yearText = "", weekText = ""] = week.split("-W");
  const year = Number(yearText);
  const jan4 = Date.UTC(year, 0, 4);
  const mondayOfWeek1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY_MS;
  return new Date(mondayOfWeek1 + (Number(weekText) - 1) * 7 * DAY_MS);
}

/** The admin console of withdrawals (ADMIN-CONSOLE-SPEC §6.3; REFERRALS §8.2). */
@Injectable()
export class AdminWithdrawalsService {
  constructor(
    private readonly repo: AdminWithdrawalsRepo,
    private readonly outbox: OutboxQueue,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async list(
    query: {
      status?: WithdrawalStatus | undefined;
      flag?: string | undefined;
      cursor?: string | undefined;
      limit: number;
    },
    now = new Date(),
  ) {
    const rewards = await this.repo.rewardsSettings();
    const cursor = decodeCursor(query.cursor, "uuid");
    const rows = await this.repo.queue(
      { ...(query.status ? { status: query.status } : {}), ...(query.flag ? { flag: query.flag } : {}) },
      cursor,
      query.limit,
    );
    const page = toPage(rows, query.limit, (row) => ({ at: row.cursorAt, key: row.request.id }));
    const items = await Promise.all(
      page.items.map(async ({ request, user }) => {
        const ageMs = now.getTime() - request.createdAt.getTime();
        const open = request.status === "requested" || request.status === "approved";
        return {
          id: request.id,
          status: request.status,
          points: request.points,
          amountMinor: request.amountMinor,
          currency: request.currency,
          maskedUser: maskedUserLabel(user.name, user.id),
          accountAgeDays: Math.max(0, Math.floor((now.getTime() - user.createdAt.getTime()) / DAY_MS)),
          flags: request.flags,
          awaitingSecondApproval: request.status === "requested" && request.approvedBy !== null,
          ageSeconds: Math.max(0, Math.floor(ageMs / 1000)),
          overdue: open && ageMs > rewards.payoutSlaHours * 3_600_000,
          lockHolder: await this.lockHolder(request.id),
          createdAt: request.createdAt.toISOString(),
        };
      }),
    );
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const totalRows = await this.repo.totals(monthStart);
    const strip = (statuses: readonly WithdrawalStatus[]) =>
      totalRows
        .filter((row) => statuses.includes(row.status))
        .map(({ currency, count, points, amountMinor }) => ({ currency, count, points, amountMinor }));
    return {
      items,
      nextCursor: page.nextCursor,
      totals: {
        waiting: strip(["requested"]),
        approvedNotPaid: strip(["approved"]),
        paidThisMonth: strip(["paid"]),
      },
    };
  }

  /** The detail; the controller audits each open. The destination is masked here, never plain. */
  async detail(id: string, now = new Date()) {
    const row = await this.repo.detail(id);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    const { request, user, destination, method } = row;
    const [wallet, debt, funding, previous, rewards] = await Promise.all([
      this.repo.wallet(user.id),
      this.repo.openDebt(user.id),
      this.repo.funding(user.id),
      this.repo.previous(user.id, id),
      this.repo.rewardsSettings(),
    ]);
    const requiresSecondApproval = needsSecondApproval(request.points, rewards);
    return adminWithdrawalDetailSchema.parse({
      id: request.id,
      status: request.status,
      points: request.points,
      amountMinor: request.amountMinor,
      feeMinor: request.feeMinor,
      currency: request.currency,
      rateMinorPerPoint: request.rateMinorPerPoint,
      flags: request.flags,
      user: {
        maskedUser: maskedUserLabel(user.name, user.id),
        accountAgeDays: Math.max(0, Math.floor((now.getTime() - user.createdAt.getTime()) / DAY_MS)),
        lifetimeEarned: wallet?.lifetimeEarned ?? 0,
        cash: wallet?.cash ?? 0,
        openDebt: debt,
        phoneVerified: user.phoneVerified,
      },
      destination: {
        id: destination.id,
        methodKey: method.key,
        methodNameAr: method.nameAr,
        masked: destination.masked,
        usableAfter: destination.usableAfter.toISOString(),
      },
      approvedBy: request.approvedBy,
      approvedAt: request.approvedAt?.toISOString() ?? null,
      secondApprovedBy: request.secondApprovedBy,
      secondApprovedAt: request.secondApprovedAt?.toISOString() ?? null,
      fourEyesThresholdPoints: rewards.fourEyesThresholdPoints,
      requiresSecondApproval,
      awaitingSecondApproval: request.status === "requested" && request.approvedBy !== null,
      paidBy: request.paidBy,
      paidAt: request.paidAt?.toISOString() ?? null,
      transferReference: request.transferReference,
      proofFileId: request.proofFileId,
      rejectReason: request.rejectReason,
      createdAt: request.createdAt.toISOString(),
      funding: funding.map((item) => ({
        at: item.at.toISOString(),
        points: item.points,
        event: rewardEventOfReason(item.reason),
        referralId: item.referralId,
        orderId: item.orderId,
        refereeInitials:
          item.refereeName === null ? null : initialsOf(item.refereeName) || null,
      })),
      previous: previous.map((item) => ({
        id: item.id,
        status: item.status,
        points: item.points,
        amountMinor: item.amountMinor,
        currency: item.currency,
        createdAt: item.createdAt.toISOString(),
      })),
      lockHolder: await this.lockHolder(id),
    });
  }

  async claim(id: string, actor: AuthenticatedUser) {
    if (!(await this.repo.detail(id))) throw new AppError(ErrorCode.NOT_FOUND);
    const current = await this.redis.get(lockKey(id));
    if (current && current !== actor.id) {
      throw new AppError(ErrorCode.CONFLICT, {
        details: { reason: "review_locked", holder: await this.repo.userName(current) },
      });
    }
    await this.redis.set(lockKey(id), actor.id, "PX", LOCK_MS);
    return { claimed: true, expiresInSeconds: LOCK_MS / 1000 };
  }

  async approve(
    id: string,
    actor: AuthenticatedUser,
    override: boolean,
  ): Promise<WithdrawalStepResult> {
    await this.assertLockOverride(id, actor.id, override);
    try {
      const { request, replayed, stage } = await this.repo.approve(id, actor.id, new Date());
      await this.outbox.kick(`withdrawal:${id}`);
      // A first approval keeps the lock out of the way: the second admin must be able to act at once.
      await this.redis.del(lockKey(id));
      return { id, status: request.status, stage, replayed };
    } catch (error) {
      throw mapWithdrawalError(error);
    }
  }

  async reject(
    id: string,
    actor: AuthenticatedUser,
    input: { reasonKey: string; note?: string | undefined; override: boolean },
  ): Promise<WithdrawalStepResult> {
    await this.assertLockOverride(id, actor.id, input.override);
    try {
      const { request, replayed } = await this.repo.reject(id, actor.id, input.reasonKey, input.note);
      await this.outbox.kick(`withdrawal:${id}`);
      await this.redis.del(lockKey(id));
      return { id, status: request.status, stage: "rejected", replayed };
    } catch (error) {
      throw mapWithdrawalError(error);
    }
  }

  async markPaid(
    id: string,
    actor: AuthenticatedUser,
    input: { transferReference: string; proofFileId?: string | undefined; override: boolean },
  ): Promise<WithdrawalStepResult> {
    await this.assertLockOverride(id, actor.id, input.override);
    try {
      const { request, replayed } = await this.repo.markPaid(
        id,
        actor.id,
        input.transferReference,
        input.proofFileId,
        new Date(),
      );
      await this.outbox.kick(`withdrawal:${id}`);
      await this.redis.del(lockKey(id));
      return { id, status: request.status, stage: "paid", replayed };
    } catch (error) {
      throw mapWithdrawalError(error);
    }
  }

  /**
   * Opens the sealed destination for the admin about to pay it: only an approved request, never the
   * admin's own, and only through the audited route. The only response that carries the plain value.
   */
  async reveal(id: string, actor: AuthenticatedUser, override: boolean) {
    await this.assertLockOverride(id, actor.id, override);
    const row = await this.repo.detail(id);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    if (row.request.userId === actor.id) {
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: "own_request" } });
    }
    if (row.request.status !== "approved") {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "illegal_state" } });
    }
    const canonical = decryptSecret(
      row.destination.valueEnc,
      decodeEncryptionKey(this.env.ENCRYPTION_KEY),
      destinationSealContext(row.destination.id),
    );
    return { methodKey: row.method.key, values: parseCanonicalDestination(canonical) };
  }

  /** `finance.export`: requests created or paid in the ISO week, formula-safe. */
  async *csv(week: string): AsyncGenerator<string> {
    const from = isoWeekStart(week);
    const to = new Date(from.getTime() + 7 * DAY_MS);
    yield csvRow([
      "id",
      "created_at",
      "status",
      "user",
      "method",
      "points",
      "amount_minor",
      "fee_minor",
      "currency",
      "flags",
      "approved_at",
      "paid_at",
      "transfer_reference",
    ]);
    for (const { request, user, methodKey } of await this.repo.exportRows(from, to)) {
      yield csvRow([
        request.id,
        request.createdAt.toISOString(),
        request.status,
        maskedUserLabel(user.name, user.id),
        methodKey,
        request.points,
        request.amountMinor,
        request.feeMinor,
        request.currency,
        request.flags.join(" "),
        (request.secondApprovedAt ?? request.approvedAt)?.toISOString(),
        request.paidAt?.toISOString(),
        request.transferReference,
      ]);
    }
  }

  private async assertLockOverride(id: string, actorId: string, override: boolean) {
    const holder = await this.redis.get(lockKey(id));
    if (holder && holder !== actorId && !override) {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "review_locked" } });
    }
  }

  private async lockHolder(id: string) {
    const holder = await this.redis.get(lockKey(id));
    return holder ? { id: holder, displayName: await this.repo.userName(holder) } : null;
  }
}
