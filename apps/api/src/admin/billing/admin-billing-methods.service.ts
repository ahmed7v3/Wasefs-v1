import { Inject, Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { AUTH, toHeaders } from "../../auth/auth.service.js";
import { OutboxQueue } from "../../common/outbox-queue.js";

import { AdminBillingMethodsRepo } from "./admin-billing-methods.repo.js";

import type { AuthInstance } from "../../auth/auth.config.js";
import type { IncomingHttpHeaders } from "node:http";

@Injectable()
export class AdminBillingMethodsService {
  constructor(
    private readonly repo: AdminBillingMethodsRepo,
    private readonly outbox: OutboxQueue,
    @Inject(AUTH) private readonly auth: AuthInstance,
  ) {}

  async pending(key: string) {
    return this.repo.pending(key);
  }

  async request(
    key: string,
    actorId: string,
    headers: IncomingHttpHeaders,
    input: {
      accountDisplay: string;
      accountHolder?: string | null;
      reason: string;
      totpCode: string;
    },
  ) {
    try {
      await this.auth.api.verifyTOTP({
        body: { code: input.totpCode, trustDevice: false },
        headers: toHeaders(headers),
      });
    } catch {
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: "totp_invalid" } });
    }
    const result = await this.repo.request(key, actorId, input);
    if (!result) throw new AppError(ErrorCode.NOT_FOUND);
    if ("conflict" in result)
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "account_change_pending" } });
    await this.outbox.kick(`alert:${result.alertId}`);
    return {
      change: result.change,
      effectiveAt: result.change.effectiveAt.toISOString(),
      diff: {
        oldAccountDisplay: result.change.oldAccountDisplay,
        newAccountDisplay: result.change.newAccountDisplay,
        oldAccountHolder: result.change.oldAccountHolder,
        newAccountHolder: result.change.newAccountHolder,
      },
    };
  }

  async cancel(key: string, actorId: string) {
    const result = await this.repo.cancel(key, actorId);
    if (!result) throw new AppError(ErrorCode.NOT_FOUND);
    if ("ownRequest" in result)
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: "different_admin_required" } });
    await this.outbox.kick(`alert:${result.alertId}`);
    return { canceled: true };
  }
}
