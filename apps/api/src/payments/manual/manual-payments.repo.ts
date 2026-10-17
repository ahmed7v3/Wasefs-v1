import { Inject, Injectable } from "@nestjs/common";
import { files, orders, paymentMethods, payments, submitManualProof } from "@wasfa/db";
import { and, eq } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

@Injectable()
export class ManualPaymentsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async instructions(userId: string, orderId: string) {
    const [row] = await this.handle.db
      .select({ order: orders, payment: payments, method: paymentMethods })
      .from(orders)
      .innerJoin(payments, eq(payments.orderId, orders.id))
      .innerJoin(paymentMethods, eq(paymentMethods.key, payments.methodKey))
      .where(and(eq(orders.id, orderId), eq(orders.ownerUserId, userId)));
    if (!row || row.method.kind !== "manual" || !row.method.requiresProof) return null;
    return row;
  }

  async proofFile(userId: string, fileId: string) {
    const [file] = await this.handle.db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.ownerUserId, userId)));
    return file;
  }

  async paymentStatus(userId: string, paymentId: string) {
    const [row] = await this.handle.db
      .select({ payment: payments, ownerUserId: orders.ownerUserId })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .where(eq(payments.id, paymentId));
    return row?.ownerUserId === userId ? row.payment : null;
  }

  submit(input: Parameters<typeof submitManualProof>[1]) {
    return submitManualProof(this.handle.db, input);
  }
}
