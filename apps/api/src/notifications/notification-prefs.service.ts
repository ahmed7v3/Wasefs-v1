import { Inject, Injectable } from "@nestjs/common";
import { WA_CUSTOMER_OPTOUT_SET, jidForPhone } from "@wasfa/shared/customer-messages";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { Redis } from "ioredis";

import { REDIS } from "../common/redis.js";
import { SettingsService } from "../settings/settings.service.js";

import { NotificationPrefsRepo } from "./notification-prefs.repo.js";

import type { NotificationPrefsResponse } from "@wasfa/shared/schemas/notification-prefs";

/** Whether the caller gets their notifications on WhatsApp (verified phone) or by email only. */
@Injectable()
export class NotificationPrefsService {
  constructor(
    private readonly repo: NotificationPrefsRepo,
    private readonly settings: SettingsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async mine(userId: string): Promise<NotificationPrefsResponse> {
    const contact = await this.repo.contact(userId);
    if (!contact) throw new AppError(ErrorCode.NOT_FOUND);
    const { customerMessages } = await this.settings.get("whatsapp");
    const available = contact.whatsappJid !== null || contact.whatsappOptedOut;
    return {
      whatsapp: {
        available,
        enabled: available && !contact.whatsappOptedOut,
        active: customerMessages.enabled,
      },
    };
  }

  async update(userId: string, whatsapp: boolean): Promise<NotificationPrefsResponse> {
    const phone = await this.repo.verifiedPhone(userId);
    if (!phone) {
      // Nothing to switch: WhatsApp needs a phone verified through our number first.
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "phone_not_verified" } });
    }
    await this.repo.setWhatsappOptOut(userId, !whatsapp);
    const jid = jidForPhone(phone);
    // The bridge checks this set before every send, so the change holds for queued messages too.
    if (whatsapp) await this.redis.srem(WA_CUSTOMER_OPTOUT_SET, jid);
    else await this.redis.sadd(WA_CUSTOMER_OPTOUT_SET, jid);
    return this.mine(userId);
  }
}
