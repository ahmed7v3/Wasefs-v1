import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { waCustomerDay, waCustomerSentKey } from "@wasfa/shared/customer-messages";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  WA_COMMANDS_KEY,
  WA_COMMANDS_MAXLEN,
  WA_COMMANDS_TTL_SECONDS,
  WA_HEARTBEAT_KEY,
  WA_PAIRING_KEY,
  WA_PAIRING_TTL_SECONDS,
  waHeartbeatSchema,
  waPairingSchema,
  type WaCommand,
  type WaPairing,
} from "@wasfa/shared/schemas/phone";
import { Redis } from "ioredis";

import { REDIS } from "../../common/redis.js";
import { PhoneService } from "../../phone/phone.service.js";
import { SettingsService } from "../../settings/settings.service.js";

import type {
  AdminWhatsappPairing,
  AdminWhatsappStatus,
  CustomerMessagesSettingsInput,
} from "@wasfa/shared/schemas/admin";
import type { FastifyRequest } from "fastify";

/**
 * Owner controls for the WhatsApp verification number. The api never talks to WhatsApp: it records
 * the wish in settings and hands the bridge a command through Redis (`wa:commands`); the bridge's
 * answer comes back in `wa:pairing`.
 */
@Injectable()
export class AdminWhatsappService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly settings: SettingsService,
    private readonly phone: PhoneService,
  ) {}

  async status(): Promise<AdminWhatsappStatus> {
    const [availability, number, auth, lastBeatAt, pairing, whatsapp, sentToday] =
      await Promise.all([
        this.phone.availability(),
        this.phone.whatsappNumber(),
        this.settings.get("auth"),
        this.lastBeatAt(),
        this.pairing(),
        this.settings.get("whatsapp"),
        this.customerSentToday(),
      ]);
    return {
      number: number ? `+${number.digits}` : null,
      numberSource: number?.source ?? null,
      bridge: { status: availability.bridge, lastBeatAt },
      pairing,
      phoneVerification: auth.phoneVerification,
      available: availability.available,
      ...(availability.unavailableReason
        ? { unavailableReason: availability.unavailableReason }
        : {}),
      customerMessages: { ...whatsapp.customerMessages, sentToday },
    };
  }

  /**
   * Customer notifications from the linked number (owner decision, 2026-10-17). Written as part of
   * the `whatsapp` setting, so `SettingsService.set` audits it; the bridge rereads it within 30 s.
   */
  async setCustomerMessages(
    actorId: string,
    request: FastifyRequest,
    input: CustomerMessagesSettingsInput,
  ): Promise<AdminWhatsappStatus> {
    const current = await this.settings.get("whatsapp");
    await this.settings.set(
      "whatsapp",
      { ...current, customerMessages: { ...current.customerMessages, ...input } },
      { actorId, request },
    );
    return this.status();
  }

  /**
   * Saves the number (audited by `SettingsService.set`) and asks the bridge to pair it. Refused
   * unless the bridge is idle and logged out: a bridge that is connected (or reconnecting) already
   * holds a linked number, and the setting must never name a different one than the one linked.
   */
  async link(actorId: string, request: FastifyRequest, number: string): Promise<{ id: string }> {
    const { bridge } = await this.phone.availability();
    if (bridge === "down") {
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, { details: { reason: "bridge_down" } });
    }
    if (bridge !== "logged_out") {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "whatsapp_already_linked" } });
    }
    const current = await this.settings.get("whatsapp");
    await this.settings.set("whatsapp", { ...current, number }, { actorId, request });
    return this.push({ id: randomUUID(), cmd: "link", number: number.replace(/^\+/, "") });
  }

  async unlink(): Promise<{ id: string }> {
    return this.push({ id: randomUUID(), cmd: "unlink" });
  }

  /** The phone-verification kill switch (`auth.phoneVerification`). */
  async setVerification(
    actorId: string,
    request: FastifyRequest,
    enabled: boolean,
  ): Promise<AdminWhatsappStatus> {
    const current = await this.settings.get("auth");
    await this.settings.set(
      "auth",
      { ...current, phoneVerification: enabled ? "whatsapp_inbound" : "disabled" },
      { actorId, request },
    );
    return this.status();
  }

  /**
   * Queues a command and, in the same transaction, replaces `wa:pairing` with "requested" so the
   * page never shows the previous command's answer. The list is capped and expires: a command
   * issued while the bridge is down must not fire minutes later.
   */
  private async push(command: WaCommand): Promise<{ id: string }> {
    const requested: WaPairing = { id: command.id, cmd: command.cmd, state: "requested" };
    try {
      await this.redis
        .multi()
        .set(WA_PAIRING_KEY, JSON.stringify(requested), "EX", WA_PAIRING_TTL_SECONDS)
        .lpush(WA_COMMANDS_KEY, JSON.stringify(command))
        .ltrim(WA_COMMANDS_KEY, 0, WA_COMMANDS_MAXLEN - 1)
        .expire(WA_COMMANDS_KEY, WA_COMMANDS_TTL_SECONDS)
        .exec();
    } catch {
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, {
        details: { reason: "queue_unavailable" },
      });
    }
    return { id: command.id };
  }

  private async customerSentToday(): Promise<number> {
    try {
      return Number((await this.redis.get(waCustomerSentKey(waCustomerDay(Date.now())))) ?? 0);
    } catch {
      return 0;
    }
  }

  private async lastBeatAt(): Promise<string | null> {
    try {
      const raw = await this.redis.get(WA_HEARTBEAT_KEY);
      const beat = waHeartbeatSchema.safeParse(raw === null ? null : JSON.parse(raw));
      return beat.success ? new Date(beat.data.at).toISOString() : null;
    } catch {
      return null;
    }
  }

  private async pairing(): Promise<AdminWhatsappPairing | null> {
    try {
      const raw = await this.redis.get(WA_PAIRING_KEY);
      const parsed = waPairingSchema.safeParse(raw === null ? null : JSON.parse(raw));
      if (!parsed.success) return null;
      const { expiresAt, ...rest } = parsed.data;
      return { ...rest, ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}) };
    } catch {
      return null;
    }
  }
}
