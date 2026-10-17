import { Inject, Injectable } from "@nestjs/common";
import { decodeEncryptionKey, encryptSecret } from "@wasfa/shared/crypto";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { formatMoney } from "@wasfa/shared/money";

import { AuthRateLimiter } from "../../auth/rate-limiter.js";
import { OutboxQueue } from "../../common/outbox-queue.js";
import { API_ENV } from "../../config/config.module.js";
import { SettingsService } from "../../settings/settings.service.js";

import { ManualPaymentsRepo } from "./manual-payments.repo.js";

import type { ApiEnv } from "../../config/env.js";
import type { SubmitPaymentProofInput } from "@wasfa/shared/schemas/manual-payment";

@Injectable()
export class ManualPaymentsService {
  constructor(
    private readonly repo: ManualPaymentsRepo,
    private readonly limiter: AuthRateLimiter,
    private readonly outbox: OutboxQueue,
    private readonly settings: SettingsService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async instructions(userId: string, orderId: string) {
    const row = await this.repo.instructions(userId, orderId);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    const billing = await this.settings.get("billing");
    const reference = row.payment.reference;
    const fill = (value: string | null, locale: "ar" | "en") =>
      (value ?? "")
        .replaceAll("{amount}", formatMoney(row.payment.amountMinor, row.payment.currency, locale))
        .replaceAll("{reference}", reference)
        .replaceAll("{account}", row.method.accountDisplay ?? "");
    return {
      method: { key: row.method.key, nameAr: row.method.nameAr, nameEn: row.method.nameEn },
      instructionsAr: fill(row.method.instructionsAr, "ar"),
      instructionsEn: fill(row.method.instructionsEn, "en"),
      accountDisplay: row.method.accountDisplay ?? "",
      accountHolder: row.method.accountHolder,
      reference,
      amountMinor: row.payment.amountMinor,
      currency: row.payment.currency,
      expiresAt: row.order.expiresAt.toISOString(),
      reviewSlaMinutes: row.method.reviewSlaMinutes ?? billing.reviewSlaMinutes,
      submissionsLeft: Math.max(0, 3 - row.payment.proofSubmissions),
      status: row.payment.status,
      rejectReason: row.payment.rejectReason,
    };
  }

  async submit(userId: string, paymentId: string, input: SubmitPaymentProofInput) {
    await this.limiter.hit(`payment-proof:user:${userId}`, 10, 3600);
    const file = await this.repo.proofFile(userId, input.fileId);
    if (!file || file.purpose !== "payment_proof") throw new AppError(ErrorCode.NOT_FOUND);
    if (file.status !== "processed") throw new AppError(ErrorCode.PROOF_PROCESSING);
    const senderPhoneMasked = `${input.senderPhone.slice(0, 3)}*****${input.senderPhone.slice(-3)}`;
    const senderPhoneEnc = encryptSecret(
      input.senderPhone,
      decodeEncryptionKey(this.env.ENCRYPTION_KEY),
      `payment.sender_phone:${paymentId}`,
    );
    try {
      const result = await this.repo.submit({
        userId,
        paymentId,
        txnId: input.txnId,
        senderPhoneMasked,
        senderPhoneEnc,
        fileId: input.fileId,
      });
      if (result.alertId) await this.outbox.kick(result.alertId);
      return {
        status: result.status,
        submissionsLeft: Math.max(
          0,
          3 - ((await this.repo.paymentStatus(userId, paymentId))?.proofSubmissions ?? 3),
        ),
      };
    } catch (error) {
      const reason = (error as { reason?: string }).reason;
      if (reason === "not_found") throw new AppError(ErrorCode.NOT_FOUND, { cause: error });
      if (reason === "duplicate_txn") throw new AppError(ErrorCode.DUPLICATE_TXN, { cause: error });
      if (reason === "proof_limit") throw new AppError(ErrorCode.PROOF_LIMIT, { cause: error });
      if (reason === "proof_processing")
        throw new AppError(ErrorCode.PROOF_PROCESSING, { cause: error });
      if (reason === "proof_not_allowed") {
        throw new AppError(ErrorCode.PROOF_NOT_ALLOWED, { cause: error });
      }
      throw error;
    }
  }
}
