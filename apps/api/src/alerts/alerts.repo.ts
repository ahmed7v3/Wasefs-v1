import { Inject, Injectable } from "@nestjs/common";
import { adminAlertPrefs, alertDeliveries, adminAlerts, raiseAdminAlert } from "@wasfa/db";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";

import { DB, type DbHandle } from "../common/database.js";

@Injectable()
export class AlertsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async list(userId: string, limit: number, cursor?: string) {
    const [createdAt, id] = cursor?.split("|") ?? [];
    const before =
      createdAt && id && !Number.isNaN(Date.parse(createdAt))
        ? or(
            lt(adminAlerts.createdAt, new Date(createdAt)),
            and(eq(adminAlerts.createdAt, new Date(createdAt)), lt(adminAlerts.id, id)),
          )
        : undefined;
    const rows = await this.handle.db
      .select({ delivery: alertDeliveries, alert: adminAlerts })
      .from(alertDeliveries)
      .innerJoin(adminAlerts, eq(alertDeliveries.alertId, adminAlerts.id))
      .where(
        and(
          eq(alertDeliveries.adminUserId, userId),
          eq(alertDeliveries.channel, "in_app"),
          ...(before ? [before] : []),
        ),
      )
      .orderBy(desc(adminAlerts.createdAt), desc(adminAlerts.id))
      .limit(limit + 1);
    const unread = await this.handle.db
      .select({ id: alertDeliveries.id })
      .from(alertDeliveries)
      .where(
        and(
          eq(alertDeliveries.adminUserId, userId),
          eq(alertDeliveries.channel, "in_app"),
          isNull(alertDeliveries.readAt),
        ),
      );
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page,
      unreadCount: unread.length,
      nextCursor: more && last ? `${last.alert.createdAt.toISOString()}|${last.alert.id}` : null,
    };
  }

  async markRead(userId: string, deliveryId: string): Promise<boolean> {
    const rows = await this.handle.db
      .update(alertDeliveries)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(alertDeliveries.id, deliveryId),
          eq(alertDeliveries.adminUserId, userId),
          eq(alertDeliveries.channel, "in_app"),
          isNull(alertDeliveries.readAt),
        ),
      )
      .returning({ id: alertDeliveries.id });
    return rows.length > 0;
  }

  async readAll(userId: string): Promise<void> {
    await this.handle.db
      .update(alertDeliveries)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(alertDeliveries.adminUserId, userId),
          eq(alertDeliveries.channel, "in_app"),
          isNull(alertDeliveries.readAt),
        ),
      );
  }

  async prefs(userId: string) {
    const [row] = await this.handle.db
      .select()
      .from(adminAlertPrefs)
      .where(eq(adminAlertPrefs.userId, userId));
    return (
      row ?? {
        userId,
        inAppEnabled: true,
        emailEnabled: true,
        telegramEnabled: true,
        whatsappEnabled: false,
        telegramChatId: null,
        whatsappJid: null,
        mutedKinds: [],
        createdAt: new Date(0),
        updatedAt: new Date(0),
      }
    );
  }

  async updatePrefs(
    userId: string,
    input: {
      inAppEnabled: boolean;
      emailEnabled: boolean;
      telegramEnabled: boolean;
      whatsappEnabled: boolean;
      telegramChatId: string | null;
      mutedKinds: string[];
    },
  ) {
    const existing = await this.prefs(userId);
    if (input.whatsappEnabled && !existing.whatsappJid)
      return { error: "whatsapp_not_linked" as const };
    const [row] = await this.handle.db
      .insert(adminAlertPrefs)
      .values({ userId, ...input })
      .onConflictDoUpdate({
        target: adminAlertPrefs.userId,
        set: { ...input, updatedAt: new Date() },
      })
      .returning();
    return { row };
  }

  createAlert(input: Parameters<typeof raiseAdminAlert>[1]) {
    return raiseAdminAlert(this.handle.db, input);
  }
  findAlert(id: string) {
    return this.handle.db.select().from(adminAlerts).where(eq(adminAlerts.id, id));
  }
  resolve(id: string, userId: string) {
    return this.handle.db
      .update(adminAlerts)
      .set({ resolvedAt: new Date(), resolvedBy: userId })
      .where(eq(adminAlerts.id, id));
  }
}
