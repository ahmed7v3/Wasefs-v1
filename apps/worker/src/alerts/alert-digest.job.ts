import { adminAlertPrefs, adminAlerts, alertDeliveries, users } from "@wasfa/db";
import { assertSafeAlertSummary } from "@wasfa/shared/alert-safety";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { DeferJob } from "../defer.js";
import { renderEmail } from "../notifications/templates/index.js";

import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

export async function alertDigestJob(
  input: JobPayload<"notifications", "alerts.digest">,
  { db, redis, email, env, logger }: JobContext,
): Promise<void> {
  const windowStart = new Date(input.windowStart);
  const windowEnd = new Date(windowStart.getTime() + 10 * 60_000);
  const pending = await db
    .select({ delivery: alertDeliveries, alert: adminAlerts })
    .from(alertDeliveries)
    .innerJoin(adminAlerts, eq(adminAlerts.id, alertDeliveries.alertId))
    .where(
      and(
        eq(alertDeliveries.adminUserId, input.adminUserId),
        eq(alertDeliveries.channel, input.channel),
        eq(alertDeliveries.status, "pending"),
        eq(alertDeliveries.error, "digest_pending"),
        gte(alertDeliveries.createdAt, windowStart),
        lt(alertDeliveries.createdAt, windowEnd),
      ),
    );
  if (pending.length === 0) return;
  const deliveryIds = pending.map(({ delivery }) => delivery.id);
  const [recipient] = await db
    .select({ user: users, prefs: adminAlertPrefs })
    .from(users)
    .leftJoin(adminAlertPrefs, eq(adminAlertPrefs.userId, users.id))
    .where(eq(users.id, input.adminUserId));
  if (!recipient || recipient.user.status !== "active") {
    await db
      .update(alertDeliveries)
      .set({ status: "skipped", error: "user_inactive" })
      .where(inArray(alertDeliveries.id, deliveryIds));
    return;
  }

  const summaries = pending.slice(0, 5).map(({ alert }) => assertSafeAlertSummary(alert.summary));
  const text = `Admin alert digest (${pending.length})\n${summaries.join("\n")}`;
  try {
    if (input.channel === "email") {
      const reservation = await email.cap.reserve(false);
      if (!reservation.allowed) throw new DeferJob(reservation.retryAt, "mail daily cap");
      try {
        const rendered = renderEmail({
          template: "alert_digest",
          locale: recipient.user.locale,
          name: recipient.user.name,
          count: pending.length,
          summaries,
          link: new URL("/admin/alerts", env?.WEB_ORIGIN ?? "http://localhost:3000").toString(),
        });
        await email.transport.send({
          from: email.from,
          to: recipient.user.email,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
        });
      } catch (error) {
        await email.cap.release(reservation);
        throw error;
      }
    } else if (input.channel === "telegram") {
      const token = env?.ALERT_TELEGRAM_BOT_TOKEN;
      const chatId = recipient.prefs?.telegramChatId;
      if (!token || !chatId) {
        await db
          .update(alertDeliveries)
          .set({ status: "skipped", error: token ? "no_chat_id" : "not_configured" })
          .where(inArray(alertDeliveries.id, deliveryIds));
        return;
      }
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("telegram_http");
    } else {
      const settings = await import("../settings.js").then(({ readSetting }) =>
        readSetting(db, "alerts"),
      );
      const jid = recipient.prefs?.whatsappJid;
      if (
        !settings.whatsapp.enabled ||
        !recipient.prefs?.whatsappEnabled ||
        !jid ||
        (await redis.sismember("wa:alert_optin_jids", jid)) !== 1
      ) {
        await db
          .update(alertDeliveries)
          .set({ status: "skipped", error: "not_opted_in" })
          .where(inArray(alertDeliveries.id, deliveryIds));
        return;
      }
      const dayStart = new Date();
      dayStart.setUTCHours(0, 0, 0, 0);
      const sentToday = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(alertDeliveries)
        .where(
          and(
            eq(alertDeliveries.channel, "whatsapp"),
            eq(alertDeliveries.status, "sent"),
            gte(alertDeliveries.sentAt, dayStart),
          ),
        );
      if ((sentToday[0]?.count ?? 0) >= settings.whatsapp.dailyCap) {
        await db
          .update(alertDeliveries)
          .set({ status: "skipped", error: "cap_reached" })
          .where(inArray(alertDeliveries.id, deliveryIds));
        return;
      }
      const waText = text.slice(0, 300);
      if (/https?:\/\/|www\./i.test(waText)) throw new Error("unsafe_text");
      await redis.rpush(
        "wa:alerts",
        JSON.stringify({ jid, text: waText, dailyCap: settings.whatsapp.dailyCap }),
      );
    }
    await db
      .update(alertDeliveries)
      .set({ status: "sent", sentAt: new Date(), error: null })
      .where(and(inArray(alertDeliveries.id, deliveryIds), eq(alertDeliveries.status, "pending")));
  } catch (error) {
    const code =
      error instanceof Error && error.message === "telegram_http" ? "telegram_http" : "send_failed";
    for (const { delivery } of pending) {
      const attempts = delivery.attempts + 1;
      await db
        .update(alertDeliveries)
        .set({
          attempts,
          ...(attempts >= 3 ? { status: "failed" as const, error: code } : {}),
        })
        .where(eq(alertDeliveries.id, delivery.id));
    }
    logger.warn(
      { channel: input.channel, count: pending.length, code },
      "Admin alert digest failed",
    );
    throw error instanceof Error ? error : new Error("alert_digest_failed");
  }
}
