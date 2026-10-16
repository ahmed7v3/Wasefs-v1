import { Inject, Injectable } from "@nestjs/common";
import {
  adminAlerts,
  isUniqueViolation,
  paymentGatewayTests,
  paymentGateways,
  paymentMethods,
  type PaymentGateway,
  type PaymentGatewayTest,
} from "@wasfa/db";
import { and, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

@Injectable()
export class AdminBillingGatewaysRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async list(): Promise<
    Array<{ gateway: PaymentGateway; methods: (typeof paymentMethods.$inferSelect)[] }>
  > {
    const gateways = await this.handle.db
      .select()
      .from(paymentGateways)
      .orderBy(paymentGateways.key);
    const methods =
      gateways.length === 0
        ? []
        : await this.handle.db
            .select()
            .from(paymentMethods)
            .where(
              and(
                eq(paymentMethods.kind, "gateway"),
                inArray(
                  paymentMethods.provider,
                  gateways.map((row) => row.key),
                ),
              ),
            );
    return gateways.map((gateway) => ({
      gateway,
      methods: methods.filter((method) => method.provider === gateway.key),
    }));
  }

  async find(key: string): Promise<PaymentGateway | undefined> {
    const [row] = await this.handle.db
      .select()
      .from(paymentGateways)
      .where(eq(paymentGateways.key, key));
    return row;
  }

  async methods(key: string): Promise<(typeof paymentMethods.$inferSelect)[]> {
    return this.handle.db
      .select()
      .from(paymentMethods)
      .where(and(eq(paymentMethods.kind, "gateway"), eq(paymentMethods.provider, key)));
  }

  async create(
    input: typeof paymentGateways.$inferInsert,
    summary: string,
  ): Promise<PaymentGateway | undefined> {
    try {
      return await this.handle.db.transaction(async (tx) => {
        const [row] = await tx.insert(paymentGateways).values(input).returning();
        if (!row) return undefined;
        await tx.insert(adminAlerts).values({
          kind: "payment.review_needed",
          severity: "critical",
          refType: "payment_gateway",
          refId: row.id,
          summary,
          link: "/admin/billing/gateways",
        });
        return row;
      });
    } catch (error) {
      if (isUniqueViolation(error, "payment_gateways_key_key")) return undefined;
      throw error;
    }
  }

  async reset(
    key: string,
    patch: Partial<typeof paymentGateways.$inferInsert>,
    summary: string,
  ): Promise<PaymentGateway | undefined> {
    return this.handle.db.transaction(async (tx) => {
      const [row] = await tx
        .update(paymentGateways)
        .set({
          ...patch,
          enabled: false,
          lastTestAt: null,
          lastTestOk: null,
          lastTestError: null,
          verifiedAt: null,
        })
        .where(eq(paymentGateways.key, key))
        .returning();
      if (!row) return undefined;
      await tx
        .update(paymentMethods)
        .set({ enabled: false, updatedAt: new Date() })
        .where(and(eq(paymentMethods.kind, "gateway"), eq(paymentMethods.provider, key)));
      await tx.insert(adminAlerts).values({
        kind: "payment.review_needed",
        severity: "critical",
        refType: "payment_gateway",
        refId: row.id,
        summary,
        link: "/admin/billing/gateways",
      });
      return row;
    });
  }

  async update(
    key: string,
    patch: Partial<typeof paymentGateways.$inferInsert>,
  ): Promise<PaymentGateway | undefined> {
    const [row] = await this.handle.db
      .update(paymentGateways)
      .set(patch)
      .where(eq(paymentGateways.key, key))
      .returning();
    return row;
  }

  async setEnabled(key: string, enabled: boolean): Promise<PaymentGateway | undefined> {
    if (enabled) {
      const [row] = await this.handle.db
        .update(paymentGateways)
        .set({ enabled: true })
        .where(
          and(
            eq(paymentGateways.key, key),
            isNotNull(paymentGateways.credentialsEnc),
            isNotNull(paymentGateways.verifiedAt),
            eq(paymentGateways.lastTestOk, true),
            isNotNull(paymentGateways.credentialsUpdatedAt),
            sql`${paymentGateways.lastTestAt} >= ${paymentGateways.credentialsUpdatedAt}`,
            sql`${paymentGateways.credentialsUpdatedAt} <= now() - interval '10 minutes'`,
          ),
        )
        .returning();
      return row;
    }
    return this.handle.db.transaction(async (tx) => {
      const [row] = await tx
        .update(paymentGateways)
        .set({ enabled })
        .where(eq(paymentGateways.key, key))
        .returning();
      if (!row) return undefined;
      if (!enabled)
        await tx
          .update(paymentMethods)
          .set({ enabled: false, updatedAt: new Date() })
          .where(and(eq(paymentMethods.kind, "gateway"), eq(paymentMethods.provider, key)));
      return row;
    });
  }

  async enableMethod(
    key: string,
    methodKey: string,
    enabled: boolean,
  ): Promise<typeof paymentMethods.$inferSelect | undefined> {
    const [row] = await this.handle.db
      .update(paymentMethods)
      .set({ enabled, updatedAt: new Date() })
      .where(
        and(
          eq(paymentMethods.key, methodKey),
          eq(paymentMethods.kind, "gateway"),
          eq(paymentMethods.provider, key),
          ...(enabled
            ? [
                sql`exists (
                select 1 from ${paymentGateways}
                where ${paymentGateways.key} = ${key}
                  and ${paymentGateways.enabled} = true
              )`,
              ]
            : []),
        ),
      )
      .returning();
    return row;
  }

  async methodExists(key: string, methodKey: string): Promise<boolean> {
    const [row] = await this.handle.db
      .select({ id: paymentMethods.id })
      .from(paymentMethods)
      .where(
        and(
          eq(paymentMethods.key, methodKey),
          eq(paymentMethods.kind, "gateway"),
          eq(paymentMethods.provider, key),
        ),
      );
    return row !== undefined;
  }

  async pendingTests(key: string, since: Date): Promise<number> {
    const [row] = await this.handle.db
      .select({ count: sql<number>`count(*)::int` })
      .from(paymentGatewayTests)
      .where(
        and(
          eq(paymentGatewayTests.gatewayKey, key),
          eq(paymentGatewayTests.status, "pending"),
          gte(paymentGatewayTests.createdAt, since),
        ),
      );
    return row?.count ?? 0;
  }

  async createTest(input: typeof paymentGatewayTests.$inferInsert): Promise<PaymentGatewayTest> {
    const [row] = await this.handle.db.insert(paymentGatewayTests).values(input).returning();
    if (!row) throw new Error("Gateway test was not stored");
    return row;
  }

  async test(key: string, id: string): Promise<PaymentGatewayTest | undefined> {
    const [row] = await this.handle.db
      .select()
      .from(paymentGatewayTests)
      .where(and(eq(paymentGatewayTests.gatewayKey, key), eq(paymentGatewayTests.id, id)));
    return row;
  }

  async recordTestCheck(
    id: string,
    input: {
      checkedAt: Date;
      statusState: string;
      statusAmountMinor: number | null;
      statusCurrency: string | null;
      status: "pending" | "succeeded" | "failed" | "mismatch";
    },
  ): Promise<void> {
    await this.handle.db
      .update(paymentGatewayTests)
      .set({
        statusCheckedAt: input.checkedAt,
        statusState: input.statusState,
        statusAmountMinor: input.statusAmountMinor,
        statusCurrency: input.statusCurrency,
        status: input.status,
      })
      .where(eq(paymentGatewayTests.id, id));
  }

  async verifyGateway(key: string, mode: "test" | "live", testCreatedAt: Date): Promise<boolean> {
    const [row] = await this.handle.db
      .update(paymentGateways)
      .set({ verifiedAt: sql`now()` })
      .where(
        and(
          eq(paymentGateways.key, key),
          eq(paymentGateways.mode, mode),
          isNotNull(paymentGateways.credentialsUpdatedAt),
          lte(paymentGateways.credentialsUpdatedAt, testCreatedAt),
        ),
      )
      .returning({ id: paymentGateways.id });
    return row !== undefined;
  }
}
