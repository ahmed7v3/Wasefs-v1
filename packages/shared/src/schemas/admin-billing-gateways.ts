import { z } from "zod";

const isoDate = z.iso.datetime({ offset: true });
const credentialsSchema = z.object({
  merchantId: z.string().regex(/^MID-\d+-\d+$/),
  paymentApiKey: z.string().min(8).max(200).regex(/^\S+$/),
  secretKey: z.string().min(8).max(300).regex(/^\S+$/),
});

export const gatewayParamSchema = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/) });
export const gatewayTestParamSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  id: z.uuid(),
});
export const gatewayMethodParamSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  methodKey: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
});
export const gatewayCreateSchema = z.object({
  key: z.literal("kashier"),
  provider: z.literal("kashier"),
  mode: z.enum(["test", "live"]),
  credentials: credentialsSchema,
  reason: z.string().trim().min(3).max(500),
});
export const gatewayCredentialsSchema = z.object({
  credentials: credentialsSchema,
  reason: z.string().trim().min(3).max(500),
});
export const gatewayModeSchema = z.object({
  mode: z.enum(["test", "live"]),
  confirm: z.string().optional(),
  reason: z.string().trim().min(3).max(500),
});
export const gatewayEnabledSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().trim().min(3).max(500),
});
export const gatewayMethodSchema = gatewayEnabledSchema;
export const gatewayTestStartSchema = z.object({
  amountMinor: z.number().int().min(100).max(5000).optional(),
  confirm: z.string().optional(),
});

export const linkedGatewayMethodSchema = z.object({
  key: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  enabled: z.boolean(),
});
export const gatewayViewSchema = z.object({
  key: z.string(),
  provider: z.string(),
  mode: z.enum(["test", "live"]),
  merchantRef: z.string().nullable(),
  hasCredentials: z.boolean(),
  keyHint: z.string().nullable(),
  enabled: z.boolean(),
  credentialsUpdatedAt: isoDate.nullable(),
  verifiedAt: isoDate.nullable(),
  lastTestAt: isoDate.nullable(),
  lastTestOk: z.boolean().nullable(),
  lastTestError: z.string().nullable(),
  lastWebhookAt: isoDate.nullable(),
  lastWebhookOk: z.boolean().nullable(),
  lastWebhookError: z.string().nullable(),
  webhookUrl: z.string(),
  cooldownEndsAt: isoDate.nullable(),
  canEnable: z.boolean(),
  blockers: z.array(
    z.enum([
      "no_credentials",
      "connection_untested",
      "connection_failed",
      "not_verified",
      "cooldown",
    ]),
  ),
  methods: z.array(linkedGatewayMethodSchema),
});
export type GatewayView = z.output<typeof gatewayViewSchema>;
export const gatewayListSchema = z.object({ items: z.array(gatewayViewSchema) });
export const gatewayConnectionResultSchema = z.object({
  ok: z.boolean(),
  errorCode: z.string().nullable(),
});
export const gatewayTestStartResponseSchema = z.object({
  id: z.uuid(),
  redirectUrl: z.url(),
  status: z.string(),
});
export const gatewayTestViewSchema = z.object({
  id: z.uuid(),
  gatewayKey: z.string(),
  mode: z.enum(["test", "live"]),
  providerOrderId: z.string(),
  amountMinor: z.number().int(),
  currency: z.string(),
  status: z.enum(["pending", "succeeded", "failed", "mismatch"]),
  webhookReceivedAt: isoDate.nullable(),
  webhookState: z.string().nullable(),
  webhookAmountMinor: z.number().int().nullable(),
  statusCheckedAt: isoDate.nullable(),
  statusState: z.string().nullable(),
  statusAmountMinor: z.number().int().nullable(),
  createdAt: isoDate,
  checklist: z.object({
    checkoutCreated: z.boolean(),
    paid: z.boolean(),
    webhookReceived: z.boolean(),
    signatureValid: z.boolean(),
    amountMatches: z.boolean(),
  }),
});
export type GatewayTestView = z.output<typeof gatewayTestViewSchema>;
export type GatewayCreateInput = z.output<typeof gatewayCreateSchema>;
