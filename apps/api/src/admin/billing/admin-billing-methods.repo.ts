import { Inject, Injectable } from "@nestjs/common";
import {
  isUniqueViolation,
  paymentMethodAccountChanges,
  paymentMethods,
  raiseAdminAlert,
  users,
} from "@wasfa/db";
import { and, eq } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

const mask = (value: string | null) => {
  if (!value) return "(empty)";
  const at = value.indexOf("@");
  return at >= 0
    ? `${value.slice(0, 2)}***${value.slice(at)}`
    : `${value.slice(0, 3)}*****${value.slice(-3)}`;
};

@Injectable()
export class AdminBillingMethodsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async pending(key: string) {
    const [row] = await this.handle.db
      .select({ change: paymentMethodAccountChanges, method: paymentMethods })
      .from(paymentMethodAccountChanges)
      .innerJoin(paymentMethods, eq(paymentMethods.id, paymentMethodAccountChanges.methodId))
      .where(and(eq(paymentMethods.key, key), eq(paymentMethodAccountChanges.status, "pending")));
    return row ?? null;
  }

  async request(
    key: string,
    actorId: string,
    input: { accountDisplay: string; accountHolder?: string | null; reason: string },
  ) {
    try {
      return await this.handle.db.transaction(async (tx) => {
        const [method] = await tx
          .select()
          .from(paymentMethods)
          .where(eq(paymentMethods.key, key))
          .for("update");
        if (!method || method.kind !== "manual") return null;
        const [actor] = await tx.select().from(users).where(eq(users.id, actorId));
        const effectiveAt = new Date(Date.now() + 10 * 60_000);
        const [change] = await tx
          .insert(paymentMethodAccountChanges)
          .values({
            methodId: method.id,
            oldAccountDisplay: method.accountDisplay ?? "",
            newAccountDisplay: input.accountDisplay,
            oldAccountHolder: method.accountHolder,
            newAccountHolder: input.accountHolder ?? null,
            requestedBy: actorId,
            reason: input.reason,
            effectiveAt,
          })
          .returning();
        if (!change) throw new Error("Account change was not stored");
        const alertId = await raiseAdminAlert(tx, {
          kind: "payment_method.account_change_requested",
          severity: "critical",
          refType: "payment_method_account_change",
          refId: change.id,
          summary: `${method.nameEn}: ${mask(method.accountDisplay)} → ${mask(input.accountDisplay)}; requested by ${actor?.name ?? "admin"}; effective ${effectiveAt.toISOString()}.`,
          link: `/admin/billing/methods/${key}/account-change`,
        });
        return { change, alertId };
      });
    } catch (error) {
      if (isUniqueViolation(error, "payment_method_account_changes_one_pending_key"))
        return { conflict: true as const };
      throw error;
    }
  }

  async cancel(key: string, actorId: string) {
    return this.handle.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ change: paymentMethodAccountChanges, method: paymentMethods })
        .from(paymentMethodAccountChanges)
        .innerJoin(paymentMethods, eq(paymentMethods.id, paymentMethodAccountChanges.methodId))
        .where(and(eq(paymentMethods.key, key), eq(paymentMethodAccountChanges.status, "pending")))
        .for("update");
      if (!row) return null;
      if (row.change.requestedBy === actorId) return { ownRequest: true as const };
      await tx
        .update(paymentMethodAccountChanges)
        .set({ status: "canceled", canceledBy: actorId, updatedAt: new Date() })
        .where(eq(paymentMethodAccountChanges.id, row.change.id));
      const alertId = await raiseAdminAlert(tx, {
        kind: "payment_method.account_change_canceled",
        severity: "critical",
        refType: "payment_method_account_change",
        refId: row.change.id,
        summary: `${row.method.nameEn}: scheduled account change canceled by an administrator.`,
        link: `/admin/billing/methods/${key}/account-change`,
      });
      return { change: row.change, alertId };
    });
  }
}
