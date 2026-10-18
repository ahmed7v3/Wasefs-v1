import { adminAlertPrefs, adminAlerts, alertDeliveries, users } from "@wasfa/db";
import { assertSafeAlertSummary } from "@wasfa/shared/alert-safety";
import { and, eq, gte, sql } from "drizzle-orm";

import { DeferJob } from "../defer.js";
import { renderEmail } from "../notifications/templates/index.js";
import { readSetting } from "../settings.js";

import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

const dayStart = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export async function alertDeliveryJob(
  { deliveryId }: JobPayload<"notifications", "alerts.deliver">,
  { db, redis, email, env, logger }: JobContext,
): Promise<void> {
  const [row] = await db
    .select({ delivery: alertDeliveries, alert: adminAlerts, user: users, prefs: adminAlertPrefs })
    .from(alertDeliveries)
    .innerJoin(adminAlerts, eq(adminAlerts.id, alertDeliveries.alertId))
    .innerJoin(users, eq(users.id, alertDeliveries.adminUserId))
    .leftJoin(adminAlertPrefs, eq(adminAlertPrefs.userId, users.id))
    .where(eq(alertDeliveries.id, deliveryId));
  if (!row) throw new Error("alert_delivery_not_found");
  if (row.delivery.status === "sent" || row.delivery.status === "skipped") return;
  if (row.user.status !== "active") {
    await db
      .update(alertDeliveries)
      .set({ status: "skipped", error: "user_inactive" })
      .where(eq(alertDeliveries.id, deliveryId));
    return;
  }
  const summary = assertSafeAlertSummary(row.alert.summary);
  const critical = row.alert.severity === "critical";
  const link = row.alert.link
    ? new URL(row.alert.link, env?.WEB_ORIGIN ?? "http://localhost:3000").toString()
    : "";
  const text = `${summary}${link ? `\n${link}` : ""}`;
  const attempt = row.delivery.attempts + 1;
  await db
    .update(alertDeliveries)
    .set({ attempts: attempt })
    .where(eq(alertDeliveries.id, deliveryId));

  try {
    if (row.delivery.channel === "email") {
      const reservation = await email.cap.reserve(critical);
      if (!reservation.allowed) throw new DeferJob(reservation.retryAt, "mail daily cap");
      const rendered = renderEmail({
        template: "admin_alert",
        locale: row.user.locale,
        name: row.user.name,
        summary,
        link,
      });
      try {
        await email.transport.send({
          from: email.from,
          to: row.user.email,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
        });
      } catch (error) {
        await email.cap.release(reservation);
        throw error;
      }
    } else if (row.delivery.channel === "telegram") {
      const token = env?.ALERT_TELEGRAM_BOT_TOKEN;
      const chatId = row.prefs?.telegramChatId;
      if (!token) return await skipped(db, deliveryId, "not_configured", attempt);
      if (!chatId) return await skipped(db, deliveryId, "no_chat_id", attempt);
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("telegram_http");
    } else if (row.delivery.channel === "whatsapp") {
      const alertSettings = await readSetting(db, "alerts");
      if (!alertSettings.whatsapp.enabled)
        return await skipped(db, deliveryId, "disabled", attempt);
      const jid = row.prefs?.whatsappJid;
      if (!row.prefs?.whatsappEnabled || !jid)
        return await skipped(db, deliveryId, "not_opted_in", attempt);
      if ((await redis.sismember("wa:alert_optin_jids", jid)) !== 1)
        return await skipped(db, deliveryId, "not_opted_in", attempt);
      const today = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(alertDeliveries)
        .where(
          and(
            eq(alertDeliveries.channel, "whatsapp"),
            eq(alertDeliveries.status, "sent"),
            gte(alertDeliveries.sentAt, dayStart(new Date())),
          ),
        );
      if ((today[0]?.total ?? 0) >= alertSettings.whatsapp.dailyCap)
        return await skipped(db, deliveryId, "cap_reached", attempt);
      const waText = summary.slice(0, 300);
      if (/https?:\/\/|www\./i.test(waText))
        return await skipped(db, deliveryId, "unsafe_text", attempt);
      await redis.rpush(
        "wa:alerts",
        JSON.stringify({ jid, text: waText, dailyCap: alertSettings.whatsapp.dailyCap }),
      );
    }
    await db
      .update(alertDeliveries)
      .set({ status: "sent", sentAt: new Date(), error: null })
      .where(eq(alertDeliveries.id, deliveryId));
  } catch (error) {
    if (error instanceof DeferJob) throw error;
    const code =
      error instanceof Error && /^(telegram_http|mail daily cap)$/.test(error.message)
        ? error.message.replaceAll(" ", "_")
        : "send_failed";
    if (attempt >= 3)
      await db
        .update(alertDeliveries)
        .set({ status: "failed", error: code })
        .where(eq(alertDeliveries.id, deliveryId));
    logger.warn(
      { deliveryId, channel: row.delivery.channel, code, attempt },
      "Admin alert delivery failed",
    );
    throw error instanceof Error ? error : new Error("alert_delivery_failed");
  }
}

async function skipped(db: JobContext["db"], id: string, error: string, attempts: number) {
  await db
    .update(alertDeliveries)
    .set({ status: "skipped", error, attempts })
    .where(eq(alertDeliveries.id, id));
}
