import { Inject, Injectable } from "@nestjs/common";
import { PaymentsError } from "@wasfa/db";
import { decryptSecret, decodeEncryptionKey } from "@wasfa/shared/crypto";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { adminManualPaymentDetailSchema } from "@wasfa/shared/schemas/admin-manual-payments";

import { OutboxQueue } from "../../common/outbox-queue.js";
import { REDIS } from "../../common/redis.js";
import { API_ENV } from "../../config/config.module.js";
import { FilesService } from "../../files/files.service.js";
import { PAYMENT_HOOKS } from "../../payments/payments.service.js";
import { SettingsService } from "../../settings/settings.service.js";

import { AdminBillingPaymentsRepo } from "./admin-billing-payments.repo.js";

import type { AuthenticatedUser } from "../../common/current-user.js";
import type { ApiEnv } from "../../config/env.js";
import type { PaymentHooks } from "@wasfa/db";
import type { Redis } from "ioredis";

const LOCK_MS = 5 * 60_000;
const lockKey = (id: string) => `payments:review-lock:${id}`;

@Injectable()
export class AdminBillingPaymentsService {
  constructor(
    private readonly repo: AdminBillingPaymentsRepo,
    private readonly files: FilesService,
    private readonly settings: SettingsService,
    private readonly outbox: OutboxQueue,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PAYMENT_HOOKS) private readonly hooks: PaymentHooks,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async queue(limit = 30, cursor?: string) {
    const { reviewSlaMinutes } = await this.settings.get("billing");
    const rows = await this.repo.queue(limit, reviewSlaMinutes, cursor);
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const items = await Promise.all(
      page.map(async ({ payment, order, method, user, reviewEnteredAt }) => ({
        id: payment.id,
        number: order.number,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        method: method.nameEn,
        maskedUser: payment.senderPhoneMasked ?? user?.name ?? "",
        ageSeconds: Math.max(
          0,
          Math.floor((Date.now() - new Date(reviewEnteredAt).getTime()) / 1000),
        ),
        flags: payment.flags,
        status: payment.status,
        lockHolder: await this.lockHolder(payment.id),
      })),
    );
    const lastRow = page.at(-1);
    const last = lastRow?.payment;
    const lastMethodSla = lastRow?.method.reviewSlaMinutes ?? reviewSlaMinutes;
    const lastPriority =
      lastRow && Date.now() - new Date(lastRow.reviewEnteredAt).getTime() > lastMethodSla * 60_000
        ? 0
        : 1;
    return {
      items,
      nextCursor:
        more && lastRow && last
          ? `${lastPriority}|${new Date(lastRow.reviewEnteredAt).toISOString()}|${last.id}`
          : null,
    };
  }

  async detail(id: string) {
    const row = await this.repo.detail(id);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    const senderPhone = row.payment.senderPhoneEnc
      ? decryptSecret(
          row.payment.senderPhoneEnc,
          decodeEncryptionKey(this.env.ENCRYPTION_KEY),
          `payment.sender_phone:${id}`,
        )
      : null;
    const proof = row.file ? await this.proofUrl(row.file.id) : null;
    return adminManualPaymentDetailSchema.parse({
      id,
      payment: {
        id: row.payment.id,
        reference: row.payment.reference,
        status: row.payment.status,
        amountMinor: row.payment.amountMinor,
        currency: row.payment.currency,
        methodKey: row.payment.methodKey,
        txnId: row.payment.txnId,
        senderPhoneMasked: row.payment.senderPhoneMasked,
        flags: row.payment.flags ?? [],
        proofSubmissions: row.payment.proofSubmissions,
        reviewedBy: row.payment.reviewedBy,
        reviewedAt: row.payment.reviewedAt,
        secondApprovedBy: row.payment.secondApprovedBy,
        secondApprovedAt: row.payment.secondApprovedAt,
        reviewNote: row.payment.reviewNote,
        rejectReason: row.payment.rejectReason,
        createdAt: row.payment.createdAt,
      },
      order: {
        id: row.order.id,
        number: row.order.number,
        kind: row.order.kind,
        planKey: row.plan?.key ?? null,
        months: row.order.months,
        totalMinor: row.order.totalMinor,
        currency: row.order.currency,
        status: row.order.status,
        expiresAt: row.order.expiresAt,
      },
      method: { key: row.method.key, name: row.method.nameEn },
      user: {
        name: row.user?.name ?? null,
        phoneMasked: row.payment.senderPhoneMasked,
        phone: senderPhone,
      },
      proofUrl: proof?.url ?? null,
      proofUrlExpiresInSeconds: proof?.expiresInSeconds ?? null,
      proofUnavailable: Boolean(row.file) && proof === null,
      paidOrdersCount: row.user ? await this.repo.paidOrderCount(row.user.id) : 0,
      earlierRejected: row.user ? await this.repo.earlierRejected(row.user.id) : [],
      lockHolder: await this.lockHolder(id),
    });
  }

  async claim(id: string, actor: AuthenticatedUser) {
    if (!(await this.repo.detail(id))) throw new AppError(ErrorCode.NOT_FOUND);
    const current = await this.redis.get(lockKey(id));
    if (current && current !== actor.id)
      throw new AppError(ErrorCode.CONFLICT, {
        details: { reason: "review_locked", holder: await this.repo.userName(current) },
      });
    await this.redis.set(lockKey(id), actor.id, "PX", LOCK_MS);
    return { claimed: true, expiresInSeconds: LOCK_MS / 1000 };
  }

  async approve(id: string, actor: AuthenticatedUser, override: boolean, note?: string) {
    await this.assertNotOwnPayment(id, actor);
    await this.assertLockOverride(id, actor.id, override);
    try {
      const { fourEyesThresholdMinor } = await this.settings.get("billing");
      const result = await this.repo.approve(
        id,
        actor.id,
        fourEyesThresholdMinor,
        this.hooks,
        note,
      );
      await this.outbox.kick(`manual-review:${id}`);
      if (result.activation === "amount_mismatch") {
        throw new AppError(ErrorCode.CONFLICT, { details: { reason: "amount_mismatch" } });
      }
      return result;
    } catch (error) {
      throw this.mapError(error);
    } finally {
      await this.redis.del(lockKey(id));
    }
  }

  async reject(
    id: string,
    actor: AuthenticatedUser,
    input: { reason: string; note: string | undefined; override: boolean },
  ) {
    await this.assertNotOwnPayment(id, actor);
    await this.assertLockOverride(id, actor.id, input.override);
    try {
      const result = await this.repo.reject(id, actor.id, input.reason, input.note);
      await this.outbox.kick(`manual-review:${id}`);
      return { status: result.status };
    } catch (error) {
      throw this.mapError(error);
    } finally {
      await this.redis.del(lockKey(id));
    }
  }

  async requestProof(
    id: string,
    actor: AuthenticatedUser,
    note: string | undefined,
    override: boolean,
  ) {
    await this.assertNotOwnPayment(id, actor);
    await this.assertLockOverride(id, actor.id, override);
    try {
      const result = await this.repo.requestProof(id, note);
      await this.outbox.kick(`manual-review:${id}`);
      return { status: result.status };
    } catch (error) {
      throw this.mapError(error);
    } finally {
      await this.redis.del(lockKey(id));
    }
  }

  /**
   * The proof image link, or null when storage cannot sign one (outage, file still processing):
   * the reviewer still sees the reference, sender and flags instead of an error page.
   */
  private async proofUrl(fileId: string) {
    try {
      return await this.files.adminViewUrl(fileId);
    } catch (error) {
      if (error instanceof AppError) return null;
      throw error;
    }
  }

  private async assertNotOwnPayment(id: string, actor: AuthenticatedUser) {
    if (await this.repo.isOwnPayment(id, actor.id, actor.orgIds))
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: "own_payment" } });
  }

  private async assertLockOverride(id: string, actorId: string, override: boolean) {
    const holder = await this.redis.get(lockKey(id));
    if (holder && holder !== actorId && !override)
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "review_locked" } });
  }

  private async lockHolder(id: string) {
    const holder = await this.redis.get(lockKey(id));
    return holder ? { id: holder, displayName: await this.repo.userName(holder) } : null;
  }
  private mapError(error: unknown): Error {
    if (error instanceof PaymentsError) {
      if (error.reason === "not_found") return new AppError(ErrorCode.NOT_FOUND, { cause: error });
      if (error.reason === "same_reviewer")
        return new AppError(ErrorCode.FORBIDDEN, {
          cause: error,
          details: { reason: "same_reviewer" },
        });
      return new AppError(ErrorCode.CONFLICT, { cause: error, details: { reason: error.reason } });
    }
    return error instanceof Error ? error : new Error("Payment review failed");
  }
}
