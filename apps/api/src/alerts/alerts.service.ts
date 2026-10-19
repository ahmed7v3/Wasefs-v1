import { Inject, Injectable } from "@nestjs/common";
import { ALERT_CHANNELS } from "@wasfa/shared/billing";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { ALERT_KIND_PERMISSION } from "@wasfa/shared/permissions";
import { Redis } from "ioredis";

import { OutboxQueue } from "../common/outbox-queue.js";
import { REDIS } from "../common/redis.js";
import { SettingsService } from "../settings/settings.service.js";

import { AlertsRepo } from "./alerts.repo.js";

import type { AuthenticatedUser } from "../common/current-user.js";
import type { AlertKind, AlertSeverity } from "@wasfa/shared/billing";
import type { AlertHealth } from "@wasfa/shared/schemas/admin-alerts";

/** How far back the health view counts deliveries. */
const HEALTH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Admin WhatsApp numbers that have messaged the platform number to accept alerts (worker-kept). */
const WA_ALERT_OPTINS_KEY = "wa:alert_optin_jids";

@Injectable()
export class AdminAlertService {
  constructor(
    private readonly repo: AlertsRepo,
    private readonly outbox: OutboxQueue,
    private readonly settings: SettingsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /**
   * Why alerts do or do not arrive: the last 7 days of deliveries per channel with their recorded
   * reasons, the WhatsApp switches and how many admins accepted WhatsApp alerts, and the caller's
   * own channel setup. Counts and flags only: no alert text, chat id or phone number.
   */
  async health(userId: string, now = new Date()): Promise<AlertHealth> {
    const since = new Date(now.getTime() - HEALTH_WINDOW_MS);
    const [rows, alerts, whatsapp, prefs, optedIn] = await Promise.all([
      this.repo.deliveryStats(since),
      this.settings.get("alerts"),
      this.settings.get("whatsapp"),
      this.repo.prefs(userId),
      this.redis.scard(WA_ALERT_OPTINS_KEY).catch(() => 0),
    ]);
    const channels = ALERT_CHANNELS.map((channel) => {
      const mine = rows.filter((row) => row.channel === channel);
      const total = (status: string) =>
        mine.filter((row) => row.status === status).reduce((sum, row) => sum + row.count, 0);
      const last = mine
        .map((row) => row.lastSentAt)
        .filter((value): value is Date => value instanceof Date)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      return {
        channel,
        sent: total("sent"),
        pending: total("pending"),
        skipped: total("skipped"),
        failed: total("failed"),
        lastSentAt: last?.toISOString() ?? null,
        reasons: mine
          .filter((row) => row.reason !== null && row.status !== "sent")
          .map((row) => ({ status: row.status, reason: row.reason ?? "", count: row.count }))
          .sort((a, b) => b.count - a.count),
      };
    });
    return {
      since: since.toISOString(),
      channels,
      whatsapp: {
        alertsEnabled: alerts.whatsapp.enabled,
        customerMessagesEnabled: whatsapp.customerMessages.enabled,
        optedInAdmins: optedIn,
      },
      me: {
        emailEnabled: prefs.emailEnabled,
        telegramEnabled: prefs.telegramEnabled,
        telegramChatIdSet: prefs.telegramChatId !== null,
        whatsappEnabled: prefs.whatsappEnabled,
        whatsappLinked: prefs.whatsappJid !== null,
      },
    };
  }

  async notify(input: {
    kind: AlertKind;
    severity: AlertSeverity;
    refType: string;
    refId: string;
    summary: string;
    link: string;
  }) {
    const id = await this.repo.createAlert(input);
    await this.outbox.kick(`alert:${id}`);
    return id;
  }

  /**
   * A test alert for the caller alone (the fan-out sends `system.test` only to `refId`). It goes
   * through the real pipeline, so /admin/notifications then shows what happened on each channel.
   */
  async sendTest(userId: string) {
    const id = await this.notify({
      kind: "system.test",
      severity: "info",
      refType: "user",
      refId: userId,
      summary: "تنبيه تجريبي: إذا وصلك هذا فقناة التنبيهات تعمل.",
      link: "/admin/notifications",
    });
    return { alertId: id };
  }

  list(userId: string, limit: number, cursor?: string) {
    return this.repo.list(userId, limit, cursor);
  }
  markRead(userId: string, id: string) {
    return this.repo.markRead(userId, id);
  }
  readAll(userId: string) {
    return this.repo.readAll(userId);
  }
  prefs(userId: string) {
    return this.repo.prefs(userId);
  }
  updatePrefs(userId: string, input: Parameters<AlertsRepo["updatePrefs"]>[1]) {
    return this.repo.updatePrefs(userId, input);
  }

  async resolve(alertId: string, actor: AuthenticatedUser) {
    const [alert] = await this.repo.findAlert(alertId);
    if (!alert) throw new AppError(ErrorCode.NOT_FOUND);
    const required = ALERT_KIND_PERMISSION[alert.kind];
    const elevated = actor.roles.includes("super_admin");
    if (
      (!elevated && !actor.permissions.includes(required)) ||
      (!elevated &&
        !actor.permissions.includes("payments.review") &&
        !actor.permissions.includes("billing.write"))
    ) {
      throw new AppError(ErrorCode.FORBIDDEN);
    }
    await this.repo.resolve(alertId, actor.id);
    return { resolved: true };
  }
}
