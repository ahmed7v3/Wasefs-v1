import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { encryptSecret, maskSecret } from "@wasfa/shared/crypto";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { gatewayCredentialsContext, GATEWAY_TEST_ORDER_PREFIX } from "@wasfa/shared/gateways";
import {
  gatewayListSchema,
  gatewayTestViewSchema,
  gatewayViewSchema,
  type GatewayCreateInput,
  type GatewayTestView,
  type GatewayView,
} from "@wasfa/shared/schemas/admin-billing-gateways";

import { API_ENV } from "../../config/config.module.js";
import { encryptionKey, type ApiEnv } from "../../config/env.js";
import { GatewayRegistry } from "../../payments/gateway-registry.js";

import { AdminBillingGatewaysRepo } from "./admin-billing-gateways.repo.js";

import type { AuditScope } from "../../audit/audited.decorator.js";

const conflict = (reason: string) => new AppError(ErrorCode.CONFLICT, { details: { reason } });
const testUrl = (origin: string) => `${origin}/admin/billing/gateways`;

export const GATEWAY_AUDIT_FIELDS = [
  "key",
  "mode",
  "merchantRef",
  "hasCredentials",
  "keyHint",
  "enabled",
  "verifiedAt",
  "reason",
] as const;
export const GATEWAY_TEST_AUDIT_FIELDS = ["ok", "errorCode"] as const;

@Injectable()
export class AdminBillingGatewaysService {
  constructor(
    private readonly repo: AdminBillingGatewaysRepo,
    private readonly registry: GatewayRegistry,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async list(): Promise<{ items: GatewayView[] }> {
    const items = await Promise.all(
      (await this.repo.list()).map(({ gateway, methods }) => this.view(gateway, methods)),
    );
    return gatewayListSchema.parse({ items });
  }

  async create(
    input: GatewayCreateInput,
    adminId: string,
    audit: AuditScope,
  ): Promise<GatewayView> {
    const credentialsEnc = encryptSecret(
      JSON.stringify(input.credentials),
      encryptionKey(this.env),
      gatewayCredentialsContext(input.key),
    );
    const row = await this.repo.create(
      {
        key: input.key,
        provider: input.provider,
        mode: input.mode,
        credentialsEnc,
        keyHint: maskSecret(input.credentials.paymentApiKey),
        merchantRef: input.credentials.merchantId,
        credentialsUpdatedAt: new Date(),
        enabled: false,
      },
      `Payment gateway ${input.key} was created by admin ${adminId}; review its merchant and credentials before enabling.`,
    );
    if (!row) throw conflict("key_taken");
    this.registry.invalidate();
    audit.targetId = row.key;
    audit.after = { ...this.auditFields(row), reason: input.reason };
    return this.view(row, await this.repo.methods(row.key));
  }

  async updateCredentials(
    key: string,
    input: { credentials: GatewayCreateInput["credentials"]; reason: string },
    adminId: string,
    audit: AuditScope,
  ): Promise<GatewayView> {
    const current = await this.repo.find(key);
    if (!current) throw new AppError(ErrorCode.NOT_FOUND);
    audit.targetId = key;
    audit.before = this.auditFields(current);
    const now = new Date();
    const row = await this.repo.reset(
      key,
      {
        credentialsEnc: encryptSecret(
          JSON.stringify(input.credentials),
          encryptionKey(this.env),
          gatewayCredentialsContext(key),
        ),
        keyHint: maskSecret(input.credentials.paymentApiKey),
        merchantRef: input.credentials.merchantId,
        credentialsUpdatedAt: now,
      },
      `Payment gateway ${key} credentials were changed by admin ${adminId}; the gateway is disabled until it is re-verified.`,
    );
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    this.registry.invalidate();
    audit.after = { ...this.auditFields(row), reason: input.reason };
    return this.view(row, await this.repo.methods(key));
  }

  async changeMode(
    key: string,
    input: { mode: "test" | "live"; confirm?: string | undefined; reason: string },
    adminId: string,
    audit: AuditScope,
  ): Promise<GatewayView> {
    const current = await this.repo.find(key);
    if (!current) throw new AppError(ErrorCode.NOT_FOUND);
    if (input.mode === current.mode) {
      audit.targetId = key;
      audit.before = this.auditFields(current);
      audit.after = { ...this.auditFields(current), reason: input.reason };
      return this.view(current, await this.repo.methods(key));
    }
    if (input.mode === "live" && current.mode !== "live" && input.confirm !== "LIVE")
      throw new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: ["confirm"] } });
    audit.targetId = key;
    audit.before = this.auditFields(current);
    const now = new Date();
    const row = await this.repo.reset(
      key,
      { mode: input.mode, credentialsUpdatedAt: now },
      `Payment gateway ${key} mode changed by admin ${adminId}; the gateway is disabled until it is re-verified.`,
    );
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    this.registry.invalidate();
    audit.after = { ...this.auditFields(row), reason: input.reason };
    return this.view(row, await this.repo.methods(key));
  }

  async testConnection(
    key: string,
    audit: AuditScope,
  ): Promise<{ ok: boolean; errorCode: string | null }> {
    const row = await this.repo.find(key);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    let result: { ok: boolean; errorCode: string | null };
    if (!row.credentialsEnc) result = { ok: false, errorCode: "no_credentials" };
    else {
      const adapter = await this.registry.forAdmin(key);
      result = adapter ? await adapter.testConnection() : { ok: false, errorCode: "auth" };
    }
    await this.repo.update(key, {
      lastTestAt: new Date(),
      lastTestOk: result.ok,
      lastTestError: result.errorCode,
    });
    audit.targetId = key;
    audit.after = result;
    return result;
  }

  async startTest(
    key: string,
    input: { amountMinor?: number | undefined; confirm?: string | undefined },
    userId: string,
  ): Promise<{ id: string; redirectUrl: string; status: string }> {
    const row = await this.repo.find(key);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    if (!row.credentialsEnc) throw conflict("no_credentials");
    if (
      row.lastTestOk !== true ||
      !row.lastTestAt ||
      !row.credentialsUpdatedAt ||
      row.lastTestAt < row.credentialsUpdatedAt
    )
      throw conflict("connection_untested");
    if (row.mode === "live" && input.confirm !== "LIVE")
      throw new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: ["confirm"] } });
    if ((await this.repo.pendingTests(key, new Date(Date.now() - 60 * 60_000))) >= 3)
      throw conflict("too_many_pending_tests");
    const adapter = await this.registry.forAdmin(key);
    if (!adapter) throw conflict("no_credentials");
    const test = await this.repo.createTest({
      gatewayKey: key,
      mode: row.mode,
      providerOrderId: `${GATEWAY_TEST_ORDER_PREFIX}${randomUUID()}`,
      amountMinor: input.amountMinor ?? 100,
      currency: "EGP",
      createdBy: userId,
    });
    try {
      const webOrigin = this.env.WEB_ORIGIN[0];
      if (!webOrigin) throw new AppError(ErrorCode.INTERNAL);
      const checkout = await adapter.createCheckout({
        paymentId: test.providerOrderId,
        orderNumber: test.providerOrderId,
        amountMinor: test.amountMinor,
        currency: test.currency,
        locale: "ar",
        returnUrl: `${testUrl(webOrigin)}?test=${test.id}`,
        webhookUrl: `${this.env.API_PUBLIC_URL}/webhooks/${key}`,
      });
      return { id: test.id, redirectUrl: checkout.redirectUrl, status: test.status };
    } catch {
      await this.repo.recordTestCheck(test.id, {
        checkedAt: new Date(),
        statusState: "checkout_failed",
        statusAmountMinor: null,
        statusCurrency: null,
        status: "failed",
      });
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE);
    }
  }

  async getTest(key: string, id: string): Promise<GatewayTestView> {
    const test = await this.repo.test(key, id);
    if (!test) throw new AppError(ErrorCode.NOT_FOUND);
    return gatewayTestViewSchema.parse({
      ...test,
      gatewayKey: test.gatewayKey,
      createdAt: test.createdAt.toISOString(),
      webhookReceivedAt: test.webhookReceivedAt?.toISOString() ?? null,
      statusCheckedAt: test.statusCheckedAt?.toISOString() ?? null,
      checklist: {
        checkoutCreated: true,
        paid: test.statusState === "succeeded",
        webhookReceived: test.webhookReceivedAt !== null,
        signatureValid: test.webhookReceivedAt !== null,
        amountMatches:
          test.statusAmountMinor === test.amountMinor &&
          test.webhookAmountMinor === test.amountMinor &&
          test.statusCurrency === test.currency &&
          test.webhookCurrency === test.currency,
      },
    });
  }

  async checkTest(key: string, id: string): Promise<GatewayTestView> {
    const row = await this.repo.find(key);
    const test = await this.repo.test(key, id);
    if (!row || !test) throw new AppError(ErrorCode.NOT_FOUND);
    const adapter = await this.registry.forAdmin(key);
    if (!adapter) throw conflict("no_credentials");
    const status = await adapter.getStatus(test.providerOrderId, null).catch(() => {
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE);
    });
    const mismatch =
      (status.amountMinor !== null && status.amountMinor !== test.amountMinor) ||
      (status.currency !== null && status.currency !== test.currency) ||
      (status.state === "succeeded" && (status.amountMinor === null || status.currency === null)) ||
      (test.webhookAmountMinor !== null && test.webhookAmountMinor !== test.amountMinor) ||
      (test.webhookCurrency !== null && test.webhookCurrency !== test.currency) ||
      (test.webhookState === "succeeded" &&
        (test.webhookAmountMinor === null || test.webhookCurrency === null));
    const succeeded =
      status.state === "succeeded" &&
      test.webhookState === "succeeded" &&
      status.amountMinor === test.amountMinor &&
      test.webhookAmountMinor === test.amountMinor &&
      status.currency === test.currency &&
      test.webhookCurrency === test.currency;
    const nextStatus = mismatch
      ? "mismatch"
      : succeeded
        ? "succeeded"
        : status.state === "failed"
          ? "failed"
          : "pending";
    const now = new Date();
    await this.repo.recordTestCheck(id, {
      checkedAt: now,
      statusState: status.state,
      statusAmountMinor: status.amountMinor,
      statusCurrency: status.currency,
      status: nextStatus,
    });
    if (
      succeeded &&
      test.mode === row.mode &&
      row.credentialsUpdatedAt &&
      test.createdAt >= row.credentialsUpdatedAt
    )
      await this.repo.verifyGateway(key, test.mode, test.createdAt);
    return this.getTest(key, id);
  }

  async setEnabled(
    key: string,
    enabled: boolean,
    reason: string,
    audit: AuditScope,
  ): Promise<GatewayView> {
    const row = await this.repo.find(key);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    audit.targetId = key;
    audit.before = this.auditFields(row);
    if (enabled) {
      const blocker = this.blockers(row)[0];
      if (blocker) throw conflict(blocker);
    }
    const updated = await this.repo.setEnabled(key, enabled);
    if (enabled && !updated) {
      const current = await this.repo.find(key);
      if (!current) throw new AppError(ErrorCode.NOT_FOUND);
      throw conflict(this.blockers(current)[0] ?? "cooldown");
    }
    this.registry.invalidate();
    if (!updated) throw new AppError(ErrorCode.NOT_FOUND);
    audit.after = { ...this.auditFields(updated), reason };
    return this.view(updated, await this.repo.methods(key));
  }

  async setMethod(
    key: string,
    methodKey: string,
    enabled: boolean,
    reason: string,
    audit: AuditScope,
  ): Promise<GatewayView> {
    const row = await this.repo.find(key);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    if (enabled && !row.enabled) throw conflict("gateway_disabled");
    const method = await this.repo.enableMethod(key, methodKey, enabled);
    if (!method) {
      if (enabled && (await this.repo.methodExists(key, methodKey)))
        throw conflict("gateway_disabled");
      throw new AppError(ErrorCode.NOT_FOUND);
    }
    audit.targetId = methodKey;
    audit.after = { key: method.key, enabled: method.enabled, reason };
    return this.view(row, await this.repo.methods(key));
  }

  private blockers(
    row: NonNullable<Awaited<ReturnType<AdminBillingGatewaysRepo["find"]>>>,
  ): string[] {
    const blockers: string[] = [];
    if (!row.credentialsEnc) blockers.push("no_credentials");
    if (!row.lastTestAt || !row.credentialsUpdatedAt || row.lastTestAt < row.credentialsUpdatedAt)
      blockers.push("connection_untested");
    else if (row.lastTestOk !== true) blockers.push("connection_failed");
    if (!row.verifiedAt) blockers.push("not_verified");
    if (row.credentialsUpdatedAt && Date.now() < row.credentialsUpdatedAt.getTime() + 10 * 60_000)
      blockers.push("cooldown");
    return blockers;
  }

  private async view(
    row: NonNullable<Awaited<ReturnType<AdminBillingGatewaysRepo["find"]>>>,
    methods: Awaited<ReturnType<AdminBillingGatewaysRepo["methods"]>>,
  ): Promise<GatewayView> {
    const blockers = this.blockers(row);
    return gatewayViewSchema.parse({
      key: row.key,
      provider: row.provider,
      mode: row.mode,
      merchantRef: row.merchantRef,
      hasCredentials: row.credentialsEnc !== null,
      keyHint: row.keyHint,
      enabled: row.enabled,
      credentialsUpdatedAt: row.credentialsUpdatedAt?.toISOString() ?? null,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      lastTestAt: row.lastTestAt?.toISOString() ?? null,
      lastTestOk: row.lastTestOk,
      lastTestError: row.lastTestError,
      lastWebhookAt: row.lastWebhookAt?.toISOString() ?? null,
      lastWebhookOk: row.lastWebhookOk,
      lastWebhookError: row.lastWebhookError,
      webhookUrl: `${this.env.API_PUBLIC_URL}/webhooks/${row.key}`,
      cooldownEndsAt: row.credentialsUpdatedAt
        ? new Date(row.credentialsUpdatedAt.getTime() + 10 * 60_000).toISOString()
        : null,
      canEnable: blockers.length === 0,
      blockers,
      methods: methods.map(({ key, nameAr, nameEn, enabled }) => ({
        key,
        nameAr,
        nameEn,
        enabled,
      })),
    });
  }

  private auditFields(row: NonNullable<Awaited<ReturnType<AdminBillingGatewaysRepo["find"]>>>) {
    return {
      key: row.key,
      mode: row.mode,
      merchantRef: row.merchantRef,
      hasCredentials: row.credentialsEnc !== null,
      keyHint: row.keyHint,
      enabled: row.enabled,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
    };
  }
}
